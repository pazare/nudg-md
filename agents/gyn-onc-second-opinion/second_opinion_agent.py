"""
second_opinion_agent.py

Given a structured gynecological oncology case that arrives the way it would
from an EMR (a JSON record), this calls Claude Fable 5 with two research
tools and returns a structured DRAFT second opinion for a human oncologist.

How it reasons (in priority order):
  1. fetch_guideline (PRIMARY) -- always called first for the case's cancer
     type. This live-fetches the NCI PDQ Health Professional guideline from
     cancer.gov. This is the anchor for every judgment.
  2. web_search (SECONDARY / corroboration only) -- Anthropic's native
     server-side web search, restricted to authoritative oncology domains.
     Used to (a) check whether anything newer than the PDQ text is relevant
     (e.g. a newly approved biomarker-driven therapy) and (b) corroborate a
     specific claim against a second source before it goes in the draft.
     It never replaces the guideline.

Input:
    A case as a JSON file path, validated against the minimum data set:
        python second_opinion_agent.py case.json
    Required fields that are missing are NOT guessed -- they are surfaced in
    the draft's missing_information list.

Output:
    A schema-enforced JSON draft: concordance verdict, alternatives, evidence
    notes, missing information, escalation flag, and citations that separate
    guideline sources from web sources. Every substantive claim must trace to
    at least one citation.

This still produces a DRAFT only. Nothing here is wired to reach a clinician
or patient -- it must pass through human_review_gate() (a hard stop) before
any real use.

Setup:
    pip install anthropic httpx beautifulsoup4
    export ANTHROPIC_API_KEY="sk-ant-..."

Run:
    python second_opinion_agent.py case.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from anthropic import Anthropic

from fetch_guideline import fetch_guideline, FETCH_GUIDELINE_TOOL_SCHEMA, AUDIT_LOG_PATH

MODEL = "claude-fable-5"
# Fable 5 runs input safety classifiers that occasionally decline benign
# life-sciences / clinical work as a false positive (stop_reason "refusal").
# We opt into a server-side fallback so such a decline is rescued on Opus 4.8
# inside the same request instead of failing the case. If the whole chain
# still refuses, we escalate to a human (handled below).
FALLBACK_BETAS = ["server-side-fallback-2026-06-01"]
FALLBACKS = [{"model": "claude-opus-4-8"}]
MAX_TOOL_ITERATIONS = 10  # hard cap so a stuck loop (incl. server-tool pauses) can't run away
MAX_OUTPUT_TOKENS = 8192  # room for thinking + web-search turns + the fuller JSON draft
GUIDELINE_TOOL_RESULT_CHARS = 10000  # truncation limit on guideline text handed back to the model
THINKING_AUDIT_LOG_PATH = Path(__file__).parent / "thinking_audit_log.jsonl"

# The ONLY web domains the agent is allowed to search. This is a hard
# guardrail (passed to the web_search tool as allowed_domains) that backs up
# the trust rules in the system prompt -- blogs/forums/content farms are never
# even fetched, regardless of search ranking.
TRUSTED_WEB_DOMAINS = [
    "cancer.gov", "www.cancer.gov",
    "nccn.org", "www.nccn.org",
    "esmo.org", "www.esmo.org",
    "esgo.org", "www.esgo.org",
    "figo.org", "www.figo.org",
    "asco.org", "www.asco.org",
    "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov",
]

# Native server-side web search (dynamic-filtering variant, supported on
# Fable 5). Runs on Anthropic's infrastructure -- there is no client-side
# execution for it; results come back inline in the response.
WEB_SEARCH_TOOL_SCHEMA = {
    "type": "web_search_20260209",
    "name": "web_search",
    "max_uses": 5,
    "allowed_domains": TRUSTED_WEB_DOMAINS,
}

client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment

# ---------------------------------------------------------------------------
# EMR-style minimum data set
# ---------------------------------------------------------------------------
# The structured record we require to reason about a case, mirroring the
# minimum a treating team would hand over for a second opinion. Values are the
# nested sub-fields that must also be present (empty list = the top-level key
# is enough). Missing fields are reported, never guessed.
MINIMUM_DATA_SET = {
    "case_id": [],
    "cancer_type": [],
    "demographics": ["age", "menopausal_status", "ecog_status", "comorbidities"],
    "diagnosis": ["histology", "grade", "stage"],
    "biomarkers": [],            # relevant markers vary by cancer type; section must exist
    "imaging_summary": [],
    "pathology_summary": [],
    "prior_treatment_history": [],
    "proposed_plan": [],
    "patient_preferences": [],
}


def _is_absent(value) -> bool:
    """A field counts as 'missing' only when it was not really provided.

    An explicit empty list (e.g. comorbidities: []  meaning 'none') is valid
    clinical information, so it is NOT treated as missing. Absent keys, null,
    empty strings, and empty dicts are.
    """
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    if isinstance(value, dict) and len(value) == 0:
        return True
    return False


def validate_case(case: dict) -> list[str]:
    """Return a list of missing minimum-data-set fields (dot-notation paths).

    Does not raise and does not guess -- the caller surfaces whatever is
    missing in the draft's missing_information.
    """
    missing: list[str] = []
    for key, subkeys in MINIMUM_DATA_SET.items():
        value = case.get(key)
        if _is_absent(value):
            missing.append(key)
            continue
        if subkeys and isinstance(value, dict):
            for sub in subkeys:
                if _is_absent(value.get(sub)):
                    missing.append(f"{key}.{sub}")
    return missing


def load_case(path: str) -> dict:
    """Load a case from a JSON file (the EMR-style input)."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Case file not found: {path}")
    with open(p, "r", encoding="utf-8") as f:
        case = json.load(f)
    if not isinstance(case, dict):
        raise ValueError(f"Case file must contain a JSON object, got {type(case).__name__}")
    return case


# The JSON schema the final answer must match -- see output_config below.
OPINION_SCHEMA = {
    "type": "object",
    "properties": {
        "cancer_type": {"type": "string"},
        "concordance": {
            "type": "string",
            "enum": ["aligned", "partially_aligned", "divergent", "insufficient_data"],
        },
        "concordance_explanation": {"type": "string"},
        "alternatives_to_consider": {"type": "array", "items": {"type": "string"}},
        "evidence_notes": {"type": "string"},
        "missing_information": {"type": "array", "items": {"type": "string"}},
        "escalation_needed": {"type": "boolean"},
        "escalation_reason": {"type": ["string", "null"]},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    # source_type distinguishes the PRIMARY guideline anchor
                    # from SECONDARY corroborating web sources.
                    "source_type": {"type": "string", "enum": ["guideline", "web_search"]},
                    "url": {"type": "string"},
                    "title": {"type": "string"},
                    "subtype": {"type": "string"},
                    # Publication / last-updated date when available (web sources).
                    "date": {"type": "string"},
                },
                "required": ["source_type", "url"],
                "additionalProperties": False,
            },
        },
        "draft_disclaimer": {"type": "string"},
    },
    "required": [
        "cancer_type",
        "concordance",
        "concordance_explanation",
        "alternatives_to_consider",
        "evidence_notes",
        "missing_information",
        "escalation_needed",
        "escalation_reason",
        "citations",
        "draft_disclaimer",
    ],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You are a clinical decision-support assistant for gynecological \
oncology second opinions. You help a treating clinician sanity-check a proposed \
treatment plan for a specific patient against current, authoritative guidelines.

NON-NEGOTIABLE OUTPUT RULE
- Your output is a DRAFT for review by a credentialed gynecologic oncologist. It is \
never delivered to a clinician or patient without that human review. Always fill \
draft_disclaimer with a sentence saying exactly that.

SOURCES, IN PRIORITY ORDER
1. PRIMARY -- fetch_guideline. Always call fetch_guideline for the case's cancer_type \
FIRST, before saying anything about guideline-concordant treatment. Never answer from \
memory; guidelines change. The fetched NCI PDQ text is your anchor for every judgment.
   - If fetch_guideline fails or returns no usable text, set escalation_needed to true \
and explain why in escalation_reason rather than guessing.
2. SECONDARY -- web_search. After you have the guideline, you MAY use web_search to \
(a) check whether anything more recent than the PDQ text is relevant (e.g. a newly \
approved biomarker-driven therapy for this patient's markers) and (b) corroborate a \
specific claim before you state it. web_search supplements the guideline; it never \
replaces it.

WEB_SEARCH TRUST RULES (apply these strictly)
- Only trust primary/authoritative domains: cancer.gov, nccn.org, esmo.org, esgo.org, \
figo.org, asco.org, and PubMed (ncbi.nlm.nih.gov/pubmed). Ignore blogs, forums, and \
general health-content sites even if they rank highly.
- Never state a clinical claim on the strength of a single web result. Cross-check it \
against at least one other authoritative source, or against the PDQ guideline text you \
already fetched, before including it.
- For every fact you draw from web_search, capture the exact URL and, if available, the \
publication or last-updated date, and record them in citations with source_type \
"web_search".
- If web results are thin, outdated, or conflict with each other or with the guideline, \
say "insufficient reliable evidence" for that specific point rather than filling the gap \
with a plausible guess or prior knowledge -- and set escalation_needed accordingly.

CITATIONS AND TRACEABILITY
- Every citation entry must set source_type to "guideline" (the fetched PDQ page) or \
"web_search" (an authoritative web source), with its url (and date for web sources).
- Every substantive claim in concordance_explanation, alternatives_to_consider, and \
evidence_notes must be traceable to at least one entry in citations. If you cannot \
support a claim from the guideline or a corroborated authoritative source, do not make \
the claim.

JUDGMENT
- Think carefully about whether the proposed plan actually matches what the guideline \
recommends for this specific stage/grade/biomarker combination before judging \
concordance. Do not default to "aligned" just because a plausible-sounding regimen was \
named.
- If the case is missing information you would need (stage, biomarkers, ECOG, etc.), name \
exactly what is missing in missing_information rather than assuming it. Use concordance \
"insufficient_data" when the gaps prevent a real judgment."""


def _execute_tool(tool_name: str, tool_input: dict, case_id: str) -> str:
    """Client-side tool execution. web_search is server-side and never reaches here."""
    if tool_name == "fetch_guideline":
        result = fetch_guideline(
            tool_input.get("cancer_type", ""),
            case_id=case_id,
            max_chars=GUIDELINE_TOOL_RESULT_CHARS,
        )
        slim = {
            "success": result.get("success"),
            "cancer_type": result.get("cancer_type"),
            "sources": result.get("sources"),
            "retrieved_at": result.get("retrieved_at"),
            "extracted_text": result.get("extracted_text", ""),
            "error": result.get("error"),
        }
        return json.dumps(slim)
    return json.dumps({"error": f"Unknown tool '{tool_name}'"})


def _extract_web_sources(content) -> list[dict]:
    """Pull the web_search results out of a response's content blocks.

    Returns a list of {url, title, date} for successful results, or a single
    {error: ...} entry when the search tool itself errored (server tools return
    errors as a result block, not an exception).
    """
    sources: list[dict] = []
    for block in content:
        if getattr(block, "type", None) != "web_search_tool_result":
            continue
        result_content = getattr(block, "content", None)
        if isinstance(result_content, list):
            for r in result_content:
                sources.append(
                    {
                        "url": getattr(r, "url", None),
                        "title": getattr(r, "title", None),
                        # web results expose recency as page_age when known
                        "date": getattr(r, "page_age", None),
                    }
                )
        else:
            # Error object, e.g. {error_code: "max_uses_exceeded"}
            sources.append({"error": getattr(result_content, "error_code", str(result_content))})
    return sources


def _log_thinking(case_id: str, thinking_summaries: list[str]):
    if not thinking_summaries:
        return
    entry = {
        "case_id": case_id,
        "logged_at": datetime.now(timezone.utc).isoformat(),
        "thinking_summaries": thinking_summaries,
    }
    with open(THINKING_AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _log_web_search(case_id: str, cancer_type: str, sources: list[dict]):
    """Log which web_search sources were used, into the same audit_log.jsonl the
    guideline fetch writes to, following the same one-line-per-retrieval pattern."""
    if not sources:
        return
    entry = {
        "case_id": case_id,
        "cancer_type": cancer_type,
        "tool": "web_search",
        "web_sources": sources,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "success": any("error" not in s for s in sources),
    }
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _fallback_used(response) -> bool:
    """True if this response was served by the Opus 4.8 fallback rather than
    the requested Fable 5 model (a Fable 5 refusal was rescued, or a sticky
    follow-up turn was routed straight to the fallback)."""
    served = getattr(response, "model", None)
    if served and not served.startswith(MODEL):
        return True
    iterations = getattr(getattr(response, "usage", None), "iterations", None) or []
    return any(getattr(e, "type", None) == "fallback_message" for e in iterations)


def _log_completion(case_id: str, cancer_type: str, generated_by_model, fallback_used: bool):
    """Record which model actually produced the case's answer, in the same
    audit_log.jsonl, so a reviewer can tell Fable 5 from the Opus 4.8 fallback."""
    entry = {
        "case_id": case_id,
        "cancer_type": cancer_type,
        "event": "completion",
        "generated_by_model": generated_by_model,
        "fallback_used": fallback_used,
        "logged_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def get_draft_opinion(case: dict) -> dict:
    """Run the tool-use loop and return the parsed draft opinion dict."""
    case_id = case.get("case_id", "unlogged")
    cancer_type = case.get("cancer_type", "")

    # Validate against the minimum data set up front. We do NOT block on
    # missing fields -- we surface them, and also hand them to the model so it
    # reasons with the gaps in view.
    missing_fields = validate_case(case)

    user_content = (
        "Here is the patient case, as a structured EMR-style record. Provide a "
        "draft second opinion per your instructions.\n\n"
        + json.dumps(case, indent=2)
    )
    if missing_fields:
        user_content += (
            "\n\nAUTOMATED INTAKE CHECK -- the following minimum-data-set fields "
            "were not provided in this record and must be reflected in "
            "missing_information (do not guess their values):\n"
            + "\n".join(f"- {m}" for m in missing_fields)
        )

    messages = [{"role": "user", "content": user_content}]

    thinking_summaries: list[str] = []

    def _finalize(draft: dict, response=None) -> dict:
        """Merge intake-detected missing fields into the draft, stamp which model
        actually generated the answer (Fable 5 vs the Opus 4.8 fallback), log
        that provenance, then return."""
        if isinstance(draft, dict) and "missing_information" in draft:
            mds_flags = [
                f"Required minimum-data-set field not provided in EMR record: {m}"
                for m in missing_fields
            ]
            existing = draft.get("missing_information") or []
            draft["missing_information"] = list(dict.fromkeys(list(existing) + mds_flags))
        if isinstance(draft, dict) and response is not None:
            served = getattr(response, "model", None)
            fb = _fallback_used(response)
            draft["generated_by_model"] = served
            draft["fallback_used"] = fb
            _log_completion(case_id, cancer_type, served, fb)
        return draft

    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=MAX_OUTPUT_TOKENS,
            betas=FALLBACK_BETAS,
            fallbacks=FALLBACKS,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral", "ttl": "1h"},
                }
            ],
            thinking={"type": "adaptive", "display": "summarized"},
            tools=[FETCH_GUIDELINE_TOOL_SCHEMA, WEB_SEARCH_TOOL_SCHEMA],
            # Only the final, tool-free turn actually emits a schema-matching
            # text block; tool/pause turns don't, so declaring the schema on
            # every turn is safe.
            output_config={"format": {"type": "json_schema", "schema": OPINION_SCHEMA}},
            messages=messages,
        )

        for block in response.content:
            if getattr(block, "type", None) == "thinking" and getattr(block, "thinking", None):
                thinking_summaries.append(block.thinking)

        # Log any web_search sources this turn used, same pattern as fetch logging.
        web_sources = _extract_web_sources(response.content)
        _log_web_search(case_id, cancer_type, web_sources)

        messages.append({"role": "assistant", "content": response.content})

        # Safety classifiers can decline (HTTP 200, stop_reason "refusal") --
        # handle it before reading content, and escalate rather than guess.
        if response.stop_reason == "refusal":
            _log_thinking(case_id, thinking_summaries)
            return _finalize(
                {
                    "cancer_type": cancer_type,
                    "concordance": "insufficient_data",
                    "concordance_explanation": "The model declined to produce an opinion for this case.",
                    "alternatives_to_consider": [],
                    "evidence_notes": "",
                    "missing_information": [],
                    "escalation_needed": True,
                    "escalation_reason": "Request was declined by the model's safety classifiers; route to a human specialist.",
                    "citations": [],
                    "draft_disclaimer": "This is a DRAFT and must be reviewed by a credentialed gynecologic oncologist before any use.",
                },
                response,
            )

        # Server-side web_search hit its iteration limit -- resend to resume.
        if response.stop_reason == "pause_turn":
            continue

        if response.stop_reason != "tool_use":
            _log_thinking(case_id, thinking_summaries)
            text_parts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
            final_text = "\n".join(text_parts).strip()
            try:
                return _finalize(json.loads(final_text), response)
            except json.JSONDecodeError:
                # Defense in depth -- output_config should prevent this.
                return {
                    "error": "Model did not return valid JSON",
                    "raw_output": final_text,
                    "generated_by_model": getattr(response, "model", None),
                    "fallback_used": _fallback_used(response),
                }

        # Client-side tool calls (fetch_guideline). web_search runs server-side
        # and is already resolved inside response.content, so it isn't here.
        tool_results = []
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                result_text = _execute_tool(block.name, block.input, case_id)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_text,
                    }
                )
        messages.append({"role": "user", "content": tool_results})

    _log_thinking(case_id, thinking_summaries)
    return {
        "error": f"Exceeded {MAX_TOOL_ITERATIONS} tool iterations without a final answer",
        "generated_by_model": getattr(response, "model", None),
        "fallback_used": _fallback_used(response),
    }


def human_review_gate(draft_opinion: dict) -> bool:
    """
    MANDATORY gate. Nothing downstream of this should fire until a real,
    credentialed gynecologic oncologist has reviewed and approved the draft.
    This stub only prints -- replace with your actual review workflow
    (queue, dashboard, sign-off record, etc.) before this touches a real case.
    """
    print("\n" + "=" * 70)
    print("HUMAN REVIEW REQUIRED -- draft is NOT approved for delivery")
    print("=" * 70)
    print(json.dumps(draft_opinion, indent=2))
    print("\nNo clinician or patient should see this until a specialist approves it.")
    return False  # always blocks until you wire in a real approval step


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python second_opinion_agent.py <case.json>", file=sys.stderr)
        print("  <case.json> is an EMR-style structured case record.", file=sys.stderr)
        sys.exit(1)

    case = load_case(sys.argv[1])
    draft = get_draft_opinion(case)
    human_review_gate(draft)
