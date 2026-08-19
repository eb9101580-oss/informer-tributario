"""Adaptador mínimo do Scrapling para o backend Node.

Recebe uma URL como argumento e devolve conteúdo estruturado em JSON no stdout.
Toda a orquestração, validação e análise permanece no backend JavaScript.
"""

import json
import re
import sys
from html import unescape
from io import BytesIO
from pypdf import PdfReader
from scrapling.fetchers import Fetcher
from urllib.request import Request, urlopen

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


def pdf_document(url: str, body: bytes) -> dict:
    text = ""
    parser = "pypdf"
    if MarkItDown is not None:
        try:
            result = MarkItDown(enable_plugins=False).convert_stream(BytesIO(body), file_extension=".pdf", url=url)
            text = clean_text(getattr(result, "text_content", "") or getattr(result, "markdown", ""))
            parser = "MarkItDown"
        except Exception:
            text = ""
    if not text:
        reader = PdfReader(BytesIO(body))
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


def fallback_document(url: str, body: bytes, content_type: str) -> dict:
    if "application/pdf" in content_type or url.lower().split("?")[0].endswith(".pdf"):
        return pdf_document(url, body)
    raw = body.decode("utf-8", errors="replace")
    if "json" in content_type:
        text = clean_text(raw)
        return {"url": url, "title": "Documento oficial em dados estruturados", "text": text[:60000], "characters": len(text), "contentType": content_type}
    title_match = re.search(r"<title[^>]*>([\s\S]*?)</title>", raw, re.IGNORECASE)
    html = re.sub(r"<(script|style|noscript|nav|footer|header)[^>]*>[\s\S]*?</\1>", "\n", raw, flags=re.IGNORECASE)
    text = clean_text(unescape(re.sub(r"<[^>]+>", "\n", html)))
    return {"url": url, "title": clean_text(unescape(title_match.group(1) if title_match else "Documento sem título")), "text": text[:60000], "characters": len(text), "contentType": content_type or "text/html", "parser": "urllib"}


def collect(url: str) -> dict:
    try:
        page = Fetcher.get(url, timeout=30, stealthy_headers=True)
    except Exception as scrapling_error:
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; InformerTributario/1.0)", "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8"})
            with urlopen(request, timeout=30) as response:
                return fallback_document(url, response.read(), (response.headers.get("content-type") or "").lower())
        except Exception:
            raise scrapling_error
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
        return pdf_document(url, page.body)
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
