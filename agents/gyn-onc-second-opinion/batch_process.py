"""
batch_process.py

Cost-optimized path for processing MANY cases at once (as opposed to
second_opinion_agent.py, which is built for one interactive case at a
time). Use this when you have a backlog of cases to run overnight, not
when you need an answer back in the same second.

Why this is structured differently from second_opinion_agent.py:
Anthropic's Message Batches API is asynchronous -- there's no live
back-and-forth mid-batch, so the interactive "Claude calls a tool, we
run it, we send the result back" loop doesn't apply here. Instead, we
do the guideline lookup ourselves BEFORE submitting the batch (we already
know each case's cancer_type up front), embed the guideline text directly
in the prompt, and ask for the structured JSON answer in a single turn
per case. Combined with prompt caching on the shared system prompt, this
is roughly ~95% cheaper per case than running the same volume through
second_opinion_agent.py one at a time (50% batch discount stacked with
~90% savings on the cached portion of the prompt).

Setup:
    pip install anthropic httpx beautifulsoup4
    export ANTHROPIC_API_KEY="sk-ant-..."

Run:
    python batch_process.py
"""

import json
import time
from pathlib import Path

from anthropic import Anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from fetch_guideline import fetch_guideline
from second_opinion_agent import SYSTEM_PROMPT, OPINION_SCHEMA, MODEL, MAX_OUTPUT_TOKENS

RESULTS_PATH = Path(__file__).parent / "batch_results.jsonl"

client = Anthropic()


def _build_request_for_case(case: dict) -> Request:
    """Pre-fetch the guideline ourselves, then build a single-turn request
    (no tool use -- batch requests don't support an interactive tool loop)."""
    guideline = fetch_guideline(case.get("cancer_type", ""), case_id=case.get("case_id", "unlogged"))

    user_content = (
        "Here is the case, plus the current NCI PDQ guideline text already "
        "retrieved for you. Provide the draft second opinion per your "
        "instructions -- you do not need to (and cannot) call any tool here; "
        "the guideline text below is already the live, current version.\n\n"
        f"CASE:\n{json.dumps(case, indent=2)}\n\n"
        f"GUIDELINE (source: {guideline.get('sources')}, "
        f"retrieved_at: {guideline.get('retrieved_at')}):\n"
        f"{guideline.get('extracted_text', '[fetch failed: ' + str(guideline.get('error')) + ']')}"
    )

    return Request(
        custom_id=case["case_id"],
        params=MessageCreateParamsNonStreaming(
            model=MODEL,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral", "ttl": "1h"},
                }
            ],
            thinking={"type": "adaptive", "display": "summarized"},
            output_config={"format": {"type": "json_schema", "schema": OPINION_SCHEMA}},
            messages=[{"role": "user", "content": user_content}],
        ),
    )


def run_batch(cases: list[dict], poll_interval_seconds: int = 30) -> list[dict]:
    """Submit all cases as one batch, poll until done, return parsed results."""
    requests = [_build_request_for_case(c) for c in cases]

    batch = client.messages.batches.create(requests=requests)
    print(f"Submitted batch {batch.id} with {len(requests)} case(s). Polling...")

    while True:
        status = client.messages.batches.retrieve(batch.id)
        print(f"  status: {status.processing_status}")
        if status.processing_status == "ended":
            break
        time.sleep(poll_interval_seconds)

    results = []
    with open(RESULTS_PATH, "a", encoding="utf-8") as f:
        for entry in client.messages.batches.results(batch.id):
            record = {"case_id": entry.custom_id}
            if entry.result.type == "succeeded":
                text_blocks = [
                    b.text for b in entry.result.message.content
                    if getattr(b, "type", None) == "text"
                ]
                raw = "\n".join(text_blocks).strip()
                try:
                    record["draft_opinion"] = json.loads(raw)
                except json.JSONDecodeError:
                    record["error"] = "invalid JSON returned"
                    record["raw_output"] = raw
            else:
                record["error"] = entry.result.type
            results.append(record)
            f.write(json.dumps(record) + "\n")

    return results


if __name__ == "__main__":
    example_cases = [
        {
            "case_id": "BATCH-0001",
            "cancer_type": "cervical",
            "figo_stage": "IB2",
            "histology": "squamous cell carcinoma",
            "proposed_plan": "Radical hysterectomy with pelvic lymphadenectomy",
        },
        {
            "case_id": "BATCH-0002",
            "cancer_type": "endometrial",
            "figo_stage": "IA",
            "histology": "endometrioid, grade 1",
            "proposed_plan": "Total hysterectomy with bilateral salpingo-oophorectomy, no adjuvant therapy",
        },
    ]

    all_results = run_batch(example_cases)
    print(f"\n{len(all_results)} result(s) written to {RESULTS_PATH}")
    for r in all_results:
        print("\n" + "=" * 70)
        print(f"HUMAN REVIEW REQUIRED -- {r['case_id']} is NOT approved for delivery")
        print(json.dumps(r, indent=2))
