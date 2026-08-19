"""Adaptador mínimo do Scrapling para o backend Node.

Recebe uma URL como argumento e devolve conteúdo estruturado em JSON no stdout.
Toda a orquestração, validação e análise permanece no backend JavaScript.
"""

import json
import sys
from io import BytesIO
from pypdf import PdfReader
from scrapling.fetchers import Fetcher

try:
    from markitdown import MarkItDown
except ImportError:  # O fallback pypdf continua funcionando em instalações mínimas.
    MarkItDown = None


def clean_text(value: str) -> str:
    """Normalize text without destroying document paragraphs and headings."""
    lines = []
    for raw_line in str(value or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = " ".join(raw_line.split())
        if line and (not lines or lines[-1] != line):
            lines.append(line)
    return "\n".join(lines)


def collect(url: str) -> dict:
    page = Fetcher.get(url, timeout=30, stealthy_headers=True)
    content_type = (page.headers.get("content-type") or "").lower()
    if "json" in content_type:
        raw = page.body.decode("utf-8", errors="replace") if isinstance(page.body, bytes) else str(page.body)
        text = clean_text(raw)
        return {
            "url": url,
            "title": "Documento oficial em dados estruturados",
            "text": text[:60000],
            "characters": len(text),
            "contentType": content_type,
        }
    if "application/pdf" in content_type or url.lower().split("?")[0].endswith(".pdf"):
        text = ""
        parser = "pypdf"
        if MarkItDown is not None:
            try:
                result = MarkItDown(enable_plugins=False).convert_stream(BytesIO(page.body), file_extension=".pdf", url=url)
                text = clean_text(getattr(result, "text_content", "") or getattr(result, "markdown", ""))
                parser = "MarkItDown"
            except Exception:
                text = ""
        if not text:
            reader = PdfReader(BytesIO(page.body))
            page_texts = [clean_text(pdf_page.extract_text() or "") for pdf_page in reader.pages]
            text = "\n\n".join(value for value in page_texts if value)
        return {
            "url": url,
            "title": url.rsplit("/", 1)[-1] or "Decisão em PDF",
            "text": text[:60000],
            "characters": len(text),
            "contentType": "application/pdf",
            "parser": parser,
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
    text = clean_text("\n".join(text_nodes))

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
