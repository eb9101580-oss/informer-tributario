"""Consulta a pesquisa oficial de jurisprudência do STF com o navegador real.

O portal protege a pesquisa com AWS WAF, por isso uma requisição HTTP simples não
recebe os resultados. O Scrapling abre o Chrome instalado, resolve a navegação e
devolve apenas os metadados públicos necessários para a fila do Informer.
"""

import json
import re
import sys
from datetime import datetime, timedelta
from urllib.parse import urlencode, urljoin
from zoneinfo import ZoneInfo

from scrapling.fetchers import StealthyFetcher


BASE_URL = "https://jurisprudencia.stf.jus.br/"


def clean(value: str) -> str:
    return " ".join((value or "").split())


def brazil_date(value: str) -> str:
    match = re.search(r"(\d{2})/(\d{2})/(\d{4})", value or "")
    return f"{match.group(3)}-{match.group(2)}-{match.group(1)}" if match else ""


def date_range(target_date: str, lookback_days: int) -> tuple[str, str]:
    if target_date:
        target = datetime.strptime(target_date, "%Y-%m-%d").date()
        return target.strftime("%d%m%Y"), target.strftime("%d%m%Y")
    end = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    start = end - timedelta(days=max(0, min(lookback_days, 31) - 1))
    return start.strftime("%d%m%Y"), end.strftime("%d%m%Y")


def first_text(node, selector: str) -> str:
    selected = node.css(selector)
    return clean(selected[0].get_all_text()) if selected else ""


def parse_results(page, base: str) -> list[dict]:
    items = []
    for block in page.css(".result-container"):
        details = block.css('a[href^="/pages/search/"]')
        if not details:
            continue
        detail_url = urljoin(BASE_URL, details[0].attrib.get("href", ""))
        title = first_text(details[0], "h4") or clean(details[0].get_all_text())
        block_text = clean(block.get_all_text())
        published = brazil_date(re.search(r"Publica[^:]*:\s*(\d{2}/\d{2}/\d{4})", block_text, re.I).group(1)) if re.search(r"Publica[^:]*:\s*(\d{2}/\d{2}/\d{4})", block_text, re.I) else ""
        paragraphs = block.css("p.jud-text")
        official_text = clean(" ".join(paragraph.get_all_text() for paragraph in paragraphs))
        if not title or not published or not official_text:
            continue
        process_links = [link.attrib.get("href") for link in block.css("a[href]") if "portal.stf.jus.br/processos/" in (link.attrib.get("href") or "")]
        items.append({
            "title": f"{title} — {official_text[:260]}",
            "url": detail_url,
            "processUrl": process_links[0] if process_links else detail_url,
            "publishedAt": published,
            "documentKind": "Acórdão do STF" if base == "acordaos" else "Decisão monocrática do STF",
            "externalId": detail_url.rstrip("/").split("/")[-2] if "/false" in detail_url else detail_url.rstrip("/").split("/")[-1],
            "fingerprintKey": f"stf:{detail_url}",
            "inlineText": official_text[:12000],
        })
    return items


def discover(target_date: str = "", lookback_days: int = 7) -> dict:
    start, end = date_range(target_date, lookback_days)
    items = []
    errors = []
    for base in ("acordaos", "decisoes"):
        query = urlencode({
            "base": base,
            "pesquisa_inteiro_teor": "false",
            "sinonimo": "true",
            "plural": "true",
            "radicais": "true",
            "buscaExata": "false",
            "publicacao_data": f"{start}-{end}",
            "page": 1,
            "pageSize": 100,
            "queryString": "tributario",
            "sort": "date",
            "sortBy": "desc",
        })
        try:
            page = StealthyFetcher.fetch(
                f"{BASE_URL}pages/search?{query}",
                headless=True,
                network_idle=True,
                timeout=60000,
                real_chrome=True,
            )
            items.extend(parse_results(page, base))
        except Exception as error:  # pragma: no cover - depende do portal/browser
            errors.append(f"{base}: {error}")
    unique = {item["url"]: item for item in items}
    if errors and not unique:
        raise RuntimeError("; ".join(errors))
    return {"items": list(unique.values()), "errors": errors}


if __name__ == "__main__":
    try:
        requested_date = sys.argv[1].strip() if len(sys.argv) > 1 else ""
        requested_lookback = int(sys.argv[2]) if len(sys.argv) > 2 else 7
        print(json.dumps(discover(requested_date, requested_lookback), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
