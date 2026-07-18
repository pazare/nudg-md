# Build manifest — NUDG MD (hackathon day-of record)

Event: The Future of Agentic AI in Healthcare — Abridge × Anthropic × Lightspeed, San Francisco, 2026-07-18 (09:00–22:00 PT).
Team: Pablo Zavala & Santiago (max team size two).
Repo: `pazare/nudg-md` — created and public from first commit on 2026-07-18 so commit timestamps are third-party-verifiable.

## Organizer answers (record verbatim at check-in; "unanswered" until then)

- Day-of-code rule (may pre-existing infra be demoed?): unanswered — this build assumes the stricter rule and is written from scratch day-of.
- Submission mechanism and deadline: unanswered
- Judging rubric/weights and demo length: unanswered (working assumption: ~4-minute live demo)
- Allowed data / sponsor-provided fields: unanswered — synthetic data only until answered.

## Three-bucket disclosure (spoken in the demo, mirrored here)

1. **Pre-existing substrate (referenced, not shipped):** NUDG general-purpose companion platform (private repo) — concept reference only (nudge lifecycle, damper cadence, specific-or-silent grounding). No code, assets, or data copied.
2. **Prepared before the event (disclosed preparation):** research-methods, honesty, and judging protocol documents from our Tribunal prep; workflow familiarity.
3. **Built during the event:** everything in this repository — synthetic scribe app, synthetic legacy EHR, synthetic patient panel, event bus, buddy companion (in progress), docs.

## Synthetic-data statement

All patients, clinicians, notes, labs, transcripts, and assistant answers are fictitious and authored day-of for this demo (`data/patients.json`, `synthetic: true`). Every screen carries a SYNTHETIC / NOT FOR CLINICAL USE marker. No PHI, no sponsor data, no real clinical rows anywhere in this repo.

## Claims discipline

- The demo claims a workflow-support mechanism on synthetic cases; it does not claim improved outcomes, diagnostic superiority, saved lives, calibrated confidence, or regulatory compliance.
- Scripted (non-model) content is labeled as scripted. Any live model lane is labeled as live.
- Limits presented as real are ones we actually hit (EXHAUSTED); all others are labeled HYPOTHESIZED.
