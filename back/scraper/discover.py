"""Descobre links em uma página oficial usando Scrapling."""

import json
import re
import sys
import unicodedata
from datetime import datetime
from urllib.parse import urljoin
from scrapling.fetchers import Fetcher


def clean(value: str) -> str:
    return " ".join((value or "").split())


def publication_date(value: str) -> str:
    text = clean(value)
    for pattern, parser in (
        (r"\b(\d{2}/\d{2}/\d{4})\b", lambda item: datetime.strptime(item, "%d/%m/%Y")),
        (r"\b(\d{4}-\d{2}-\d{2})\b", lambda item: datetime.strptime(item, "%Y-%m-%d")),
    ):
        match = re.search(pattern, text)
        if match:
            try:
                return parser(match.group(1)).date().isoformat()
            except ValueError:
                pass
    normalized = "".join(
        character for character in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(character) != "Mn"
    )
    month_numbers = {
        "janeiro": 1, "fevereiro": 2, "marco": 3, "abril": 4,
        "maio": 5, "junho": 6, "julho": 7, "agosto": 8,
        "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
    }
    match = re.search(
        r"\b(\d{1,2})\s*(?:de\s+)?(" + "|".join(month_numbers) + r")(?:\s+de|,)?\s+(\d{4})\b",
        normalized,
    )
    if match:
        try:
            return datetime(int(match.group(3)), month_numbers[match.group(2)], int(match.group(1))).date().isoformat()
        except ValueError:
            pass
    return ""


def state_links(page) -> list[dict]:
    """Lê os resultados carregados no estado inicial do novo portal gov.br/sped.

    O portal renderiza os comunicados e manuais via React; eles não aparecem como
    âncoras HTML para um coletor simples, mas ficam disponíveis no JSON
    `window.__data` entregue no primeiro carregamento.
    """
    body = page.body.decode("utf-8", errors="replace") if isinstance(page.body, bytes) else str(page.body)
    marker = "window.__data="
    start = body.find(marker)
    if start < 0:
        return []
    start += len(marker)
    end = body.find("</script>", start)
    if end < 0:
        return []
    raw = body[start:end].rstrip(";\n ")
    raw = re.sub(r":undefined\b", ":null", raw)
    try:
        state = json.loads(raw)
    except (TypeError, ValueError):
        return []

    found = []

    def walk(value):
        if isinstance(value, dict):
            file_data = value.get("file") if isinstance(value.get("file"), dict) else {}
            url = value.get("getURL") or value.get("targetUrl") or file_data.get("download") or value.get("@id")
            title = clean(value.get("title") or value.get("Title") or "")
            if url and title and str(url).startswith("https://") and not str(url).endswith(("/@navigation", "/@breadcrumbs", "/@types", "/@workflow")):
                modified = value.get("modified") or value.get("ModificationDate") or value.get("effective") or value.get("EffectiveDate") or ""
                found.append({"title": title[:300], "url": str(url), "publishedAt": publication_date(str(modified))})
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(state)
    return found


def discover(url: str) -> dict:
    page = Fetcher.get(url, timeout=30, stealthy_headers=True)
    links = []
    seen = set()
    for anchor in page.css("a[href]"):
        href = anchor.attrib.get("href")
        title = clean(" ".join(anchor.xpath(".//text()").getall()))
        if not href or not title:
            continue
        absolute = urljoin(url, href)
        if not absolute.startswith("https://") or absolute in seen:
            continue
        seen.add(absolute)
        context = clean(" ".join(anchor.xpath("ancestor::*[self::tr or self::li or self::article or contains(@class, 'item')][1]//text()").getall()))
        links.append({"title": (context or title)[:300], "url": absolute, "publishedAt": publication_date(f"{context} {title}")})
        if len(links) >= 1000:
            break
    for item in state_links(page):
        if item["url"] not in seen:
            seen.add(item["url"])
            links.append(item)
        if len(links) >= 1000:
            break
    return {"url": url, "links": links}


if __name__ == "__main__":
    try:
        print(json.dumps(discover(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
