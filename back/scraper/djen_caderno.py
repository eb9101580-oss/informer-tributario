"""Baixa um caderno diario do DJEN e devolve decisoes tributarias.

O endpoint de pesquisa do CNJ tem uma cota compartilhada pequena. O endpoint de
cadernos entrega um ZIP oficial por tribunal/data; filtramos seus JSONs localmente
para cobrir o dia inteiro com uma unica requisicao a API.
"""

import html
import hashlib
import heapq
import json
import os
import re
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile

import ijson


def bounded_environment_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return min(maximum, max(minimum, value))


API = "https://comunicaapi.pje.jus.br/api/v1/caderno"
METADATA_PROXY_URL = os.environ.get("DJEN_METADATA_PROXY_URL", "").strip().rstrip("/")
MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 900 * 1024 * 1024
MAX_ENTRY_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 100
MAX_CANDIDATES = bounded_environment_integer("DJEN_MAX_CANDIDATES_PER_TRIBUNAL_DATE", 60, 1, 1000)
CANDIDATE_POOL_SIZE = min(4000, MAX_CANDIDATES * 4)
DECISION_PATTERN = re.compile(r"acordao|decisao|sentenca|julgamento|voto|liminar|tutela")
TAX_PATTERN = re.compile(
    r"\btribut(?:os?|ar|ad[oa]s?|acao|acoes|ari[oa]s?|avel|aveis)\b|imposto|\bicms\b|\biss\b|\bipi\b|\bpis\b|cofins|irpj|csll|\bcbs\b|\bibs\b|"
    r"irrf|irpf|iptu|ipva|itbi|pasep|cide|funrural|afrmm|itcmd|\bitr\b|\biof\b|"
    r"aduaneir|importacao|exportacao|imunidade|isencao|(?:repeticao (?:de |do )?indebito|indebito) (?:tributario|fiscal)|"
    r"taxa (?:tributaria|fiscal|selic|de fiscalizacao|de servico publico|de poder de policia|municipal|estadual|federal)|"
    r"emprestimo compulsorio|contribuicao social|contribuicao previdenciaria|execucao fiscal|"
    r"divida ativa|credito fiscal|credito tributario|debito fiscal|fazenda nacional|receita federal|"
    r"compensacao tributaria|parcelamento tributario|beneficio fiscal"
)
PRECEDENT_PATTERN = re.compile(
    r"recurso repetitivo|representativo de controversia|repercussao geral|tema \d+|"
    r"incidente de resolucao de demandas repetitivas|\birdr\b|uniformizacao|sumula|"
    r"arguicao de inconstitucionalidade|controle concentrado"
)
MERITS_PATTERN = re.compile(
    r"julgo (?:procedente|improcedente)|procedencia|improcedencia|dou provimento|nego provimento|"
    r"recurso (?:provido|desprovido)|concedo|denego|reconheco|declaro|condeno|anulo|afasto|"
    r"excluo|extingo|homologo|ordem concedida|ordem denegada"
)
NAMED_TAX_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r"\bicms\b", r"\biss\b", r"\bipi\b", r"\bpis\b", r"cofins", r"irpj", r"csll",
    r"irrf", r"irpf", r"iptu", r"ipva", r"itbi", r"pasep", r"cide", r"funrural", r"afrmm",
    r"\bcbs\b", r"\bibs\b", r"itcmd", r"\bitr\b", r"\biof\b", r"aduaneir",
    r"importacao", r"exportacao", r"imunidade", r"isencao", r"(?:repeticao (?:de |do )?indebito|indebito) (?:tributario|fiscal)",
    r"taxa (?:tributaria|fiscal|selic|de fiscalizacao|de servico publico|de poder de policia)",
    r"emprestimo compulsorio", r"contribuicao social", r"contribuicao previdenciaria",
))


def normalized(value: object) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(char for char in text if unicodedata.category(char) != "Mn").lower()


def plain_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(html.unescape(text).split())


def request_json(url: str, retry_offset: int = 0, attempts: int = 3, empty_on_404: bool = True) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "Informer-Tributario/1.0"},
    )
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404 and empty_on_404:
                return {}
            if error.code not in (403, 429) or attempt == attempts - 1:
                raise
            # O GitHub compartilha IPs entre muitos projetos. Esperar a janela
            # oficial evita perder os cadernos quando a cota daquele IP zerou.
            time.sleep(65 + retry_offset)
    return {}


def fetch_metadata(tribunal: str, target_date: str) -> dict:
    if METADATA_PROXY_URL:
        proxy_url = f"{METADATA_PROXY_URL}/{tribunal}/{target_date}"
        try:
            # O proxy já possui cache e fica na região brasileira. Uma falha nele
            # deve cair imediatamente no endpoint oficial, sem repetir a espera.
            return request_json(proxy_url, attempts=1, empty_on_404=False)
        except Exception:
            pass
    return request_json(f"{API}/{tribunal}/{target_date}/D", (int(tribunal[-1]) - 1) * 3)


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
    published = item.get("data_disponibilizacao") or ""
    if published != target_date or not DECISION_PATTERN.search(normalized(kind)):
        return None
    text = plain_text(item.get("texto"))
    if not TAX_PATTERN.search(normalized(text)):
        return None
    content_hash = hashlib.sha256(
        f"{normalized(item.get('tipoDocumento'))}|{normalized(text)}".encode("utf-8")
    ).hexdigest()
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
        "_contentHash": content_hash,
    }


def decision_fingerprint(item: dict) -> bytes:
    process = normalized(item.get("numero_processo") or item.get("numeroprocessocommascara"))
    content_hash = item.get("_contentHash") or hashlib.sha256(
        f"{normalized(item.get('tipoDocumento'))}|{normalized(item.get('texto'))}".encode("utf-8")
    ).hexdigest()
    return hashlib.sha256(f"{process}|{content_hash}".encode("utf-8")).digest()


def process_key(item: dict, fingerprint: bytes) -> str:
    process = re.sub(r"\D", "", str(item.get("numero_processo") or item.get("numeroprocessocommascara") or ""))
    return process or f"sem-processo:{fingerprint.hex()}"


def candidate_rank(item: dict) -> tuple[int, ...]:
    kind = normalized(f"{item.get('tipoDocumento', '')} {item.get('tipoComunicacao', '')}")
    text = normalized(item.get("texto"))
    document_rank = 4 if "acordao" in kind else 3 if "sentenca" in kind else 2 if "terminativa" in kind else 1
    named_tax_signals = sum(1 for pattern in NAMED_TAX_PATTERNS if pattern.search(text))
    routine_execution = bool(re.search(r"execucao fiscal|divida ativa", text)) and named_tax_signals == 0
    return (
        int(bool(PRECEDENT_PATTERN.search(text))),
        int(bool(MERITS_PATTERN.search(text))),
        min(named_tax_signals, 8),
        document_rank,
        int(not routine_execution),
        min(len(text), 14000),
    )


def iter_json_items(stream):
    """Itera o array `items` sem materializar o JSON inteiro na memória."""
    yield from ijson.items(stream, "items.item")


def archive_json_entries(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith(".json")]
    if len(entries) > MAX_ENTRIES:
        raise ValueError("Caderno do DJEN contem arquivos demais.")
    if any(entry.file_size > MAX_ENTRY_BYTES for entry in entries):
        raise ValueError("Caderno do DJEN contem uma entrada grande demais.")
    if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_BYTES:
        raise ValueError("Caderno do DJEN excede o limite seguro descompactado.")
    return entries


def diversify_candidates(ranked_candidates: list[tuple], limit: int) -> list[dict]:
    selected = []
    selected_fingerprints = set()
    selected_processes = set()
    for _rank, fingerprint_hex, candidate in ranked_candidates:
        candidate_process = process_key(candidate, bytes.fromhex(fingerprint_hex))
        if candidate_process in selected_processes:
            continue
        selected.append({key: value for key, value in candidate.items() if not key.startswith("_")})
        selected_fingerprints.add(fingerprint_hex)
        selected_processes.add(candidate_process)
        if len(selected) >= limit:
            return selected
    for _rank, fingerprint_hex, candidate in ranked_candidates:
        if fingerprint_hex in selected_fingerprints:
            continue
        selected.append({key: value for key, value in candidate.items() if not key.startswith("_")})
        if len(selected) >= limit:
            break
    return selected


def select_archive_candidates(archive: zipfile.ZipFile, tribunal: str, target_date: str, total: int = 0) -> tuple[list[dict], dict]:
    entries = archive_json_entries(archive)
    candidate_heap = []
    seen_decisions = set()
    telemetry = {
        "totalCommunications": total,
        "entries": len(entries),
        "processed": 0,
        "dateMatched": 0,
        "decisionMatched": 0,
        "taxMatched": 0,
        "deduplicated": 0,
        "duplicates": 0,
        "selected": 0,
        "cap": MAX_CANDIDATES,
    }
    for entry in entries:
        with archive.open(entry) as stream:
            for raw_item in iter_json_items(stream):
                telemetry["processed"] += 1
                if (raw_item.get("data_disponibilizacao") or "") != target_date:
                    continue
                telemetry["dateMatched"] += 1
                kind = f"{raw_item.get('tipoDocumento', '')} {raw_item.get('tipoComunicacao', '')}"
                if not DECISION_PATTERN.search(normalized(kind)):
                    continue
                telemetry["decisionMatched"] += 1
                item = selected_item(raw_item, tribunal, target_date)
                if not item:
                    continue
                telemetry["taxMatched"] += 1
                decision_key = decision_fingerprint(item)
                if decision_key in seen_decisions:
                    telemetry["duplicates"] += 1
                    continue
                seen_decisions.add(decision_key)
                telemetry["deduplicated"] += 1
                heap_entry = (candidate_rank(item), decision_key.hex(), item)
                if len(candidate_heap) < CANDIDATE_POOL_SIZE:
                    heapq.heappush(candidate_heap, heap_entry)
                elif heap_entry[:2] > candidate_heap[0][:2]:
                    heapq.heapreplace(candidate_heap, heap_entry)
    ranked = sorted(candidate_heap, key=lambda value: value[:2], reverse=True)
    items = diversify_candidates(ranked, MAX_CANDIDATES)
    telemetry["selected"] = len(items)
    return items, telemetry


def discover(tribunal: str, target_date: str) -> dict:
    metadata = fetch_metadata(tribunal, target_date)
    archive_url = metadata.get("url")
    if not archive_url:
        total = metadata.get("total_comunicacoes", 0)
        return {
            "items": [],
            "status": "no-resource",
            "total": total,
            "telemetry": {
                "totalCommunications": total,
                "entries": 0,
                "processed": 0,
                "dateMatched": 0,
                "decisionMatched": 0,
                "taxMatched": 0,
                "deduplicated": 0,
                "duplicates": 0,
                "selected": 0,
                "cap": MAX_CANDIDATES,
            },
        }

    with tempfile.TemporaryFile() as temporary:
        download(archive_url, temporary)
        temporary.seek(0)
        with zipfile.ZipFile(temporary) as archive:
            items, telemetry = select_archive_candidates(
                archive,
                tribunal,
                target_date,
                metadata.get("total_comunicacoes", 0),
            )
            return {
                "items": items,
                "status": "ok",
                "total": metadata.get("total_comunicacoes", 0),
                "telemetry": telemetry,
            }


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
