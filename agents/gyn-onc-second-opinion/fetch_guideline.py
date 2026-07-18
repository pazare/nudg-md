"""
fetch_guideline.py

Live-fetch tool for the gynecological oncology second-opinion agent.

Reads guideline_source_registry.md (the source-of-truth list of NCI PDQ
URLs by cancer type) and, given a cancer_type, fetches that page LIVE at
call time -- no local copy of guideline text is stored. Every call is
logged to audit_log.jsonl with the source URL, retrieval timestamp, and a
hash of what was retrieved, so any case can later show exactly what it
was based on.

max_chars default raised to 12000 (was 6000) -- the model was flagging
truncated guideline text as a real limitation on its answers, and with
prompt caching in place on the calling side, the extra tokens are cheap.
"""

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

REGISTRY_PATH = Path(__file__).parent / "guideline_source_registry.md"
AUDIT_LOG_PATH = Path(__file__).parent / "audit_log.jsonl"

# cancer.gov (like many sites) returns 403 to requests with no/generic
# User-Agent. A normal browser-style header avoids that.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


def _parse_registry() -> dict:
    """Parse the markdown table in guideline_source_registry.md into
    {cancer_type: [{"subtype": ..., "source": ..., "url": ...}, ...]}."""
    text = REGISTRY_PATH.read_text(encoding="utf-8")
    registry: dict[str, list[dict]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|") or line.startswith("|---") or "cancer_type" in line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 4:
            continue
        cancer_type, subtype, source, url = cells
        if not url.startswith("http"):
            continue
        registry.setdefault(cancer_type.lower(), []).append(
            {"subtype": subtype, "source": source, "url": url}
        )
    return registry


REGISTRY = _parse_registry()


def _strip_to_text(html: str) -> str:
    """Strip nav/boilerplate, keep clinical body text."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    # collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _log_fetch(case_id: str, cancer_type: str, url: str, retrieved_at: str, text_hash: str, success: bool):
    entry = {
        "case_id": case_id,
        "cancer_type": cancer_type,
        "source_url": url,
        "retrieved_at": retrieved_at,
        "text_sha256": text_hash,
        "success": success,
    }
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def fetch_guideline(cancer_type: str, case_id: str = "unlogged", max_chars: int = 12000) -> dict:
    """
    Fetch the NCI PDQ guideline page(s) for a given cancer_type.

    Returns:
        {
          "success": bool,
          "cancer_type": str,
          "sources": [{"url": str, "subtype": str}],
          "retrieved_at": ISO8601 str,
          "extracted_text": str (truncated to max_chars),
          "error": str (only if success is False),
        }
    """
    key = cancer_type.strip().lower()
    matches = REGISTRY.get(key)
    retrieved_at = datetime.now(timezone.utc).isoformat()

    if not matches:
        _log_fetch(case_id, key, "", retrieved_at, "", success=False)
        return {
            "success": False,
            "cancer_type": key,
            "error": f"'{cancer_type}' not found in guideline_source_registry.md. "
                     f"Known types: {sorted(REGISTRY.keys())}",
        }

    combined_text = []
    sources_used = []
    for match in matches:
        try:
            resp = httpx.get(match["url"], timeout=15, follow_redirects=True, headers=REQUEST_HEADERS)
            resp.raise_for_status()
            text = _strip_to_text(resp.text)
            combined_text.append(f"--- Source: {match['url']} ({match['subtype']}) ---\n{text}")
            sources_used.append({"url": match["url"], "subtype": match["subtype"]})
        except Exception as e:
            combined_text.append(f"--- Source: {match['url']} FAILED: {e} ---")

    full_text = "\n\n".join(combined_text)
    truncated = full_text[:max_chars]
    text_hash = hashlib.sha256(full_text.encode("utf-8")).hexdigest()

    _log_fetch(case_id, key, ";".join(s["url"] for s in sources_used), retrieved_at, text_hash, success=bool(sources_used))

    return {
        "success": bool(sources_used),
        "cancer_type": key,
        "sources": sources_used,
        "retrieved_at": retrieved_at,
        "extracted_text": truncated,
        "text_sha256": text_hash,
    }


# Tool schema to hand to the Claude API (Messages API tool-use format)
FETCH_GUIDELINE_TOOL_SCHEMA = {
    "name": "fetch_guideline",
    "description": (
        "Fetch the current NCI PDQ treatment guideline for a given gynecological "
        "cancer type, live from cancer.gov. Use this before making any treatment "
        "recommendation. Do not answer from memory -- always fetch first."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "cancer_type": {
                "type": "string",
                "description": "One of the registry's cancer types, e.g. 'cervical', 'ovarian', 'endometrial', 'vulvar', 'vaginal', 'uterine', 'gestational trophoblastic disease'.",
            }
        },
        "required": ["cancer_type"],
    },
}


if __name__ == "__main__":
    import sys
    ct = sys.argv[1] if len(sys.argv) > 1 else "cervical"
    result = fetch_guideline(ct, case_id="cli-test")
    print(json.dumps({k: v for k, v in result.items() if k != "extracted_text"}, indent=2))
    print("\n--- first 500 chars of extracted_text ---")
    print(result.get("extracted_text", "")[:500])
