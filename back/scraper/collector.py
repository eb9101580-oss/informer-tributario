"""Adaptador mínimo do Scrapling para o backend Node.

Recebe uma URL como argumento e devolve conteúdo estruturado em JSON no stdout.
Toda a orquestração, validação e análise permanece no backend JavaScript.
"""

import json
import sys
from io import BytesIO
from pypdf import PdfReader
from scrapling.fetchers import Fetcher


def clean_text(value: str) -> str:
    return " ".join(value.split())


def collect(url: str) -> dict:
    page = Fetcher.get(url, timeout=30, stealthy_headers=True)
    content_type = (page.headers.get("content-type") or "").lower()
    if "application/pdf" in content_type or url.lower().split("?")[0].endswith(".pdf"):
        reader = PdfReader(BytesIO(page.body))
        text = clean_text(" ".join((pdf_page.extract_text() or "") for pdf_page in reader.pages))
        return {
            "url": url,
            "title": url.rsplit("/", 1)[-1] or "Decisão em PDF",
            "text": text[:60000],
            "characters": len(text),
            "contentType": "application/pdf",
        }
    title = page.css("title::text").get() or "Documento sem título"
    text_nodes = page.xpath(
        "//main//*[not(ancestor-or-self::script) and not(ancestor-or-self::style) "
        "and not(ancestor-or-self::noscript)]/text() | "
        "//article//*[not(ancestor-or-self::script) and not(ancestor-or-self::style) "
        "and not(ancestor-or-self::noscript)]/text()"
    ).getall()
    if not text_nodes:
        text_nodes = page.xpath(
            "//body//*[not(self::script) and not(self::style) and "
            "not(self::nav) and not(self::footer) and not(self::header) "
            "and not(self::noscript)]/text()"
        ).getall()
    text = clean_text(" ".join(text_nodes))

    return {
        "url": url,
        "title": clean_text(title),
        "text": text[:60000],
        "characters": len(text),
        "contentType": content_type or "text/html",
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Informe uma URL."}, ensure_ascii=False))
        sys.exit(2)

    try:
        print(json.dumps(collect(sys.argv[1]), ensure_ascii=False))
    except Exception as error:  # O erro precisa atravessar a fronteira do processo.
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
