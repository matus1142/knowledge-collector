#!/usr/bin/env python3
"""
generate_manifest.py
--------------------
Recursively scans the knowledge hub directory and produces manifest.json.
Run from the repo root before deploying or committing.

Usage:
    python generate_manifest.py
"""

import os
import json

# ── Configuration ──────────────────────────────────────────────────────────────

ROOT_DIR = "."                # scan from repo root
OUTPUT_FILE = "manifest.json"

SUPPORTED_EXTENSIONS = {".html", ".md", ".pdf"}

# Files and directories to ignore during scan
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

IGNORE_DIRS = {
    ".git",
    ".github",
    "node_modules",
    "__pycache__",
    ".DS_Store",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def should_ignore_dir(name: str) -> bool:
    return name in IGNORE_DIRS or name.startswith(".")


def should_ignore_file(name: str) -> bool:
    if name in IGNORE_FILES:
        return True
    if name.startswith("."):
        return True
    _, ext = os.path.splitext(name)
    return ext.lower() not in SUPPORTED_EXTENSIONS


def get_file_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    mapping = {".html": "html", ".md": "markdown", ".pdf": "pdf"}
    return mapping.get(ext, "unknown")


def build_tree(abs_dir: str, rel_dir: str) -> dict | None:
    """
    Recursively build a folder node.
    Returns None if the folder contains no supported files (anywhere in its subtree).
    """
    entries = sorted(os.listdir(abs_dir), key=str.lower)

    files = []
    children = []

    for entry in entries:
        abs_path = os.path.join(abs_dir, entry)
        rel_path = os.path.join(rel_dir, entry).replace("\\", "/")

        if os.path.isdir(abs_path):
            if should_ignore_dir(entry):
                continue
            child_node = build_tree(abs_path, rel_path)
            if child_node is not None:
                children.append(child_node)

        elif os.path.isfile(abs_path):
            if should_ignore_file(entry):
                continue
            files.append({
                "name": entry,
                "path": rel_path,
                "type": get_file_type(entry),
            })

    # Prune empty subtrees
    if not files and not children:
        return None

    folder_name = os.path.basename(abs_dir) if rel_dir else "Root"

    return {
        "name": folder_name,
        "path": rel_dir,
        "files": files,
        "children": children,
    }


def count_stats(node: dict) -> dict:
    stats = {"total_files": 0, "total_folders": 0, "html": 0, "markdown": 0, "pdf": 0}

    def walk(n):
        stats["total_folders"] += 1
        for f in n.get("files", []):
            stats["total_files"] += 1
            t = f.get("type", "")
            if t in stats:
                stats[t] += 1
        for c in n.get("children", []):
            walk(c)

    walk(node)
    return stats


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print(f"Scanning '{os.path.abspath(ROOT_DIR)}' ...")

    root_node = build_tree(os.path.abspath(ROOT_DIR), "")

    if root_node is None:
        root_node = {"name": "Root", "path": "", "files": [], "children": []}

    stats = count_stats(root_node)

    manifest = {
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00","Z"),
        "stats": stats,
        "tree": root_node,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"✓ {OUTPUT_FILE} written.")
    print(f"  Folders : {stats['total_folders']}")
    print(f"  Files   : {stats['total_files']}  "
          f"(HTML={stats['html']}, MD={stats['markdown']}, PDF={stats['pdf']})")


if __name__ == "__main__":
    main()