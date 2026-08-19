"""Descobre links em uma página oficial usando Scrapling."""

import json
import re
import sys
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
    return ""


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
        if len(links) >= 300:
            break
    return {"url": url, "links": links}


if __name__ == "__main__":
    try:
        print(json.dumps(discover(sys.argv[1]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
