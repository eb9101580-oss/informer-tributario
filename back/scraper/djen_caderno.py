"""Baixa um caderno diario do DJEN e devolve decisoes tributarias.

O endpoint de pesquisa do CNJ tem uma cota compartilhada pequena. O endpoint de
cadernos entrega um ZIP oficial por tribunal/data; filtramos seus JSONs localmente
para cobrir o dia inteiro com uma unica requisicao a API.
"""

import html
import hashlib
import json
import re
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.request
import zipfile


API = "https://comunicaapi.pje.jus.br/api/v1/caderno"
MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 900 * 1024 * 1024
MAX_ENTRY_BYTES = 120 * 1024 * 1024
MAX_ENTRIES = 100
DECISION_PATTERN = re.compile(r"acordao|decisao|sentenca|julgamento|voto|liminar|tutela")
TAX_PATTERN = re.compile(
    r"tribut|imposto|\bicms\b|\biss\b|\bipi\b|\bpis\b|cofins|irpj|csll|\bcbs\b|\bibs\b|"
    r"itcmd|\bitr\b|\biof\b|contribuicao social|contribuicao previdenciaria|execucao fiscal|"
    r"divida ativa|credito fiscal|credito tributario|debito fiscal|fazenda nacional|receita federal|"
    r"compensacao tributaria|parcelamento tributario|beneficio fiscal"
)


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in text if unicodedata.category(char) != "Mn").lower()


def plain_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(html.unescape(text).split())


def request_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "Informer-Tributario/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {}
        raise


def download(url: str, destination) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Informer-Tributario/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        expected = int(response.headers.get("Content-Length") or 0)
        if expected > MAX_DOWNLOAD_BYTES:
            raise ValueError("Caderno do DJEN excede o limite seguro de download.")
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_DOWNLOAD_BYTES:
                raise ValueError("Caderno do DJEN excede o limite seguro de download.")
            destination.write(chunk)
        destination.flush()


def selected_item(item: dict, tribunal: str, target_date: str) -> dict | None:
    kind = f"{item.get('tipoDocumento', '')} {item.get('tipoComunicacao', '')}"
    text = plain_text(item.get("texto"))
    published = item.get("data_disponibilizacao") or ""
    if published != target_date or not DECISION_PATTERN.search(normalized(kind)):
        return None
    if not TAX_PATTERN.search(normalized(text)):
        return None
    return {
        "id": item.get("id"),
        "numeroComunicacao": item.get("numeroComunicacao"),
        "hash": item.get("hash"),
        "data_disponibilizacao": published,
        "tipoDocumento": item.get("tipoDocumento"),
        "tipoComunicacao": item.get("tipoComunicacao"),
        "nomeOrgao": item.get("nomeOrgao") or tribunal,
        "numeroprocessocommascara": item.get("numeroprocessocommascara"),
        "numero_processo": item.get("numero_processo"),
        "link": item.get("link"),
        "texto": text[:14000],
    }


def discover(tribunal: str, target_date: str) -> dict:
    metadata = request_json(f"{API}/{tribunal}/{target_date}/D")
    archive_url = metadata.get("url")
    if not archive_url:
        return {"items": [], "status": "no-resource"}

    with tempfile.TemporaryFile() as temporary:
        download(archive_url, temporary)
        temporary.seek(0)
        with zipfile.ZipFile(temporary) as archive:
            entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith(".json")]
            if len(entries) > MAX_ENTRIES:
                raise ValueError("Caderno do DJEN contem arquivos demais.")
            if any(entry.file_size > MAX_ENTRY_BYTES for entry in entries):
                raise ValueError("Caderno do DJEN contem uma entrada grande demais.")
            if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("Caderno do DJEN excede o limite seguro descompactado.")

            items = []
            seen_decisions = set()
            for entry in entries:
                with archive.open(entry) as stream:
                    payload = json.load(stream)
                for raw_item in payload.get("items", []):
                    item = selected_item(raw_item, tribunal, target_date)
                    if item:
                        decision_key = hashlib.sha256(
                            f"{item.get('numero_processo')}|{normalized(item.get('tipoDocumento'))}|{normalized(item.get('texto'))}".encode("utf-8")
                        ).digest()
                        if decision_key in seen_decisions:
                            continue
                        seen_decisions.add(decision_key)
                        items.append(item)
            return {"items": items, "status": "ok", "total": metadata.get("total_comunicacoes", 0)}


def main() -> None:
    tribunal = (sys.argv[1] if len(sys.argv) > 1 else "").upper()
    target_date = sys.argv[2] if len(sys.argv) > 2 else ""
    if not re.fullmatch(r"TRF[1-6]", tribunal) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", target_date):
        print(json.dumps({"error": "Tribunal ou data invalida."}))
        raise SystemExit(1)
    try:
        print(json.dumps(discover(tribunal, target_date)))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
