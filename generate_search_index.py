#!/usr/bin/env python3
"""
generate_search_index.py
------------------------
Recursively scans all supported documents and builds search_index.json
with extracted text content for full-text search on the client.

Dependencies:
    pip install pdfplumber beautifulsoup4

Usage:
    python generate_search_index.py
"""

import os
import json
import re
import html as html_module
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────────

ROOT_DIR = "."
OUTPUT_FILE = "search_index.json"

SUPPORTED_EXTENSIONS = {".html", ".md", ".pdf"}

IGNORE_FILES = {
    "index.html",
    "viewer.html",
    "manifest.json",
    "search_index.json",
    "style.css",
    "script.js",
    "viewer.js",
    "generate_manifest.py",
    "generate_search_index.py",
}

IGNORE_DIRS = {".git", ".github", "node_modules", "__pycache__"}

# Maximum characters of content to store per document (keeps index size manageable)
MAX_CONTENT_CHARS = 2000

# ── Text Extractors ────────────────────────────────────────────────────────────

def extract_html(filepath: str) -> tuple[str, list[str], list[str]]:
    """
    Extract visible text, tags, and aliases from an HTML file.
    Reads <meta name="tags"> and <meta name="aliases"> for enriched search.
    Returns (content, tags, aliases).
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        # Fallback: strip tags with regex if bs4 not installed
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read()
        content = re.sub(r"<[^>]+>", " ", raw)
        content = html_module.unescape(content)
        content = re.sub(r"\s+", " ", content).strip()
        return content[:MAX_CONTENT_CHARS], [], []

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    # Extract meta tags/aliases
    tags = []
    aliases = []
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or "").lower()
        content_val = meta.get("content") or ""
        if name == "tags":
            tags = [t.strip() for t in content_val.split(",") if t.strip()]
        elif name == "aliases":
            aliases = [a.strip() for a in content_val.split(",") if a.strip()]

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "header", "footer", "noscript"]):
        tag.decompose()

    text = soup.get_text(separator=" ")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_CONTENT_CHARS], tags, aliases


def extract_markdown(filepath: str) -> tuple[str, list[str], list[str]]:
    """
    Extract plain text from Markdown, parse YAML frontmatter for tags/aliases.
    Returns (content, tags, aliases).
    """
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()

    tags = []
    aliases = []

    # Parse YAML frontmatter (--- ... ---)
    frontmatter_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", raw, re.DOTALL)
    if frontmatter_match:
        fm_text = frontmatter_match.group(1)
        raw = raw[frontmatter_match.end():]

        # Simple YAML key extraction (no full YAML parser dependency)
        for line in fm_text.splitlines():
            if line.startswith("tags:"):
                val = line[5:].strip().strip("[]")
                tags = [t.strip().strip('"\'') for t in val.split(",") if t.strip()]
            elif line.startswith("aliases:"):
                val = line[8:].strip().strip("[]")
                aliases = [a.strip().strip('"\'') for a in val.split(",") if a.strip()]

    # Remove Markdown syntax for plain-text extraction
    text = raw
    text = re.sub(r"#{1,6}\s+", "", text)           # headings
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)    # bold
    text = re.sub(r"\*(.+?)\*", r"\1", text)         # italic
    text = re.sub(r"`{3}[\s\S]*?`{3}", "", text)     # fenced code blocks
    text = re.sub(r"`(.+?)`", r"\1", text)           # inline code
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)      # images
    text = re.sub(r"\[(.+?)\]\(.*?\)", r"\1", text)  # links
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)  # list bullets
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)  # numbered lists
    text = re.sub(r"^\s*>\s+", "", text, flags=re.MULTILINE)      # blockquotes
    text = re.sub(r"\|.*?\|", " ", text)             # tables
    text = re.sub(r"\s+", " ", text).strip()

    return text[:MAX_CONTENT_CHARS], tags, aliases


def extract_pdf(filepath: str) -> tuple[str, list[str], list[str]]:
    """
    Extract text from PDF using pdfplumber (preferred) or fallback to pypdf.
    Returns (content, [], []).
    """
    text = ""

    # Try pdfplumber first
    try:
        import pdfplumber
        with pdfplumber.open(filepath) as pdf:
            pages_text = []
            char_count = 0
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                pages_text.append(page_text)
                char_count += len(page_text)
                if char_count >= MAX_CONTENT_CHARS:
                    break
            text = " ".join(pages_text)
    except ImportError:
        # Fallback to pypdf
        try:
            from pypdf import PdfReader
            reader = PdfReader(filepath)
            parts = []
            for page in reader.pages:
                parts.append(page.extract_text() or "")
                if sum(len(p) for p in parts) >= MAX_CONTENT_CHARS:
                    break
            text = " ".join(parts)
        except ImportError:
            text = ""  # No PDF library available; content will be empty
            print(f"  ⚠  No PDF library found. Install: pip install pdfplumber")

    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_CONTENT_CHARS], [], []


def extract_title(filepath: str, file_type: str) -> str:
    """Derive a human-readable title from the file content or filename."""
    name = Path(filepath).stem.replace("_", " ").replace("-", " ").title()

    if file_type == "html":
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                raw = f.read(4096)
            m = re.search(r"<title[^>]*>([^<]+)</title>", raw, re.IGNORECASE)
            if m:
                return m.group(1).strip()
            m = re.search(r"<h1[^>]*>([^<]+)</h1>", raw, re.IGNORECASE)
            if m:
                return re.sub(r"<[^>]+>", "", m.group(1)).strip()
        except Exception:
            pass

    elif file_type == "markdown":
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("# "):
                        return line[2:].strip()
                    # Skip frontmatter
                    if line and not line.startswith("---"):
                        break
        except Exception:
            pass

    return name


# ── Walker ─────────────────────────────────────────────────────────────────────

def get_file_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    return {".html": "html", ".md": "markdown", ".pdf": "pdf"}.get(ext, "unknown")


def walk_files(root: str):
    """Yield (abs_path, rel_path) for all supported files."""
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune ignored directories in-place
        dirnames[:] = sorted(
            [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")],
            key=str.lower,
        )

        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel_dir == ".":
            rel_dir = ""

        for filename in sorted(filenames, key=str.lower):
            if filename in IGNORE_FILES or filename.startswith("."):
                continue
            _, ext = os.path.splitext(filename)
            if ext.lower() not in SUPPORTED_EXTENSIONS:
                continue

            abs_path = os.path.join(dirpath, filename)
            rel_path = (
                os.path.join(rel_dir, filename).replace("\\", "/").lstrip("/")
            )
            yield abs_path, rel_path


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    abs_root = os.path.abspath(ROOT_DIR)
    print(f"Indexing '{abs_root}' ...")

    index = []
    counts = {"html": 0, "markdown": 0, "pdf": 0}

    for abs_path, rel_path in walk_files(abs_root):
        file_type = get_file_type(os.path.basename(rel_path))
        folder = "/".join(rel_path.split("/")[:-1])

        print(f"  [{file_type:8s}] {rel_path}")

        # Extract content
        try:
            if file_type == "html":
                content, tags, aliases = extract_html(abs_path)
            elif file_type == "markdown":
                content, tags, aliases = extract_markdown(abs_path)
            elif file_type == "pdf":
                content, tags, aliases = extract_pdf(abs_path)
            else:
                content, tags, aliases = "", [], []
        except Exception as e:
            print(f"    ⚠  Error extracting {rel_path}: {e}")
            content, tags, aliases = "", [], []

        title = extract_title(abs_path, file_type)

        index.append({
            "title": title,
            "path": rel_path,
            "type": file_type,
            "folder": folder,
            "content": content,
            "tags": tags,
            "aliases": aliases,
        })

        counts[file_type] = counts.get(file_type, 0) + 1

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)

    total = sum(counts.values())
    print(f"\n✓ {OUTPUT_FILE} written — {total} documents indexed.")
    print(f"  HTML={counts['html']}, Markdown={counts['markdown']}, PDF={counts['pdf']}")


if __name__ == "__main__":
    main()