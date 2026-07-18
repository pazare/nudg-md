# Gynecological Oncology Second-Opinion Agent — Prototype

Status: **prototype under quarantine review — published for provenance by team
decision (2026-07-18), NOT as a working capability.** It has not run end to end. Offline review found
unenforced guideline/citation guarantees, unsafe whole-record transmission,
repo-served audit outputs, batch validation gaps, a licensing-policy conflict,
schema drift, and incorrect/incomplete clinical fixtures. Keep it separate
from the live NUDG MD demo until those blockers have tests and independent
clinical review.

The remaining handoff notes describe the intended design, not verified
behavior. “Always,” “guaranteed,” cost, safety, and source-coverage claims below
must be treated as unverified until the quarantine blockers are resolved.

> Provenance note (2026-07-18): standalone component by Santiago, published
> here by explicit team decision with the review findings above intact.
> It is NOT wired into the NUDG MD demo rig and has
> not yet been run end-to-end against live credits; it is presented as the
> auditable "heavy-thinking" second-opinion lane the buddy's panel is designed
> to grow into. Runnable sample cases: endometrial, cervical, vulvar — no
> vaginal sample case is built yet.

## Files in this folder

| File | What it does |
|---|---|
| `guideline_source_registry.md` | Source-of-truth list of NCI PDQ guideline URLs by cancer type. The agent fetches these live -- nothing here is a cached copy of guideline text. Currently 9 rows across 7 cancer types (cervical, ovarian, endometrial, vulvar, vaginal, uterine sarcoma, gestational trophoblastic disease); trim/expand rows as needed. |
| `fetch_guideline.py` | Parses the registry, fetches the matching page live, strips it to clean text, logs every call to `audit_log.jsonl` (source URL, timestamp, content hash). |
| `second_opinion_agent.py` | The agent itself. Reads an EMR-style case from a JSON file, validates it against the minimum data set, then runs Claude (model: `claude-fable-5`) in a tool-use loop. `fetch_guideline` is the PRIMARY source (always called first); Anthropic's native `web_search` is a SECONDARY corroboration source restricted to authoritative oncology domains. Returns a structured JSON draft whose citations separate guideline from web sources. Uses adaptive thinking, guaranteed JSON schema output, prompt caching, and a server-side refusal fallback to Opus 4.8. |
| `sample_case.json` | A realistic EMR-style test case (stage IIIC1 dMMR endometrial cancer) you can run through the agent. |
| `batch_process.py` | Same thing, but for processing many cases at once via the Message Batches API (roughly ~95% cheaper per case than running them one at a time, since it stacks the batch discount with cache savings). |
| `requirements.txt` | `anthropic`, `httpx`, `beautifulsoup4`. |

## Setup

```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY="sk-ant-api03-..."   # from console.anthropic.com, Default workspace
python second_opinion_agent.py sample_case.json   # runs the included EMR-style test case
```

## Architecture, in one paragraph

A case arrives as an EMR-style JSON record (demographics, diagnosis,
biomarkers, imaging/pathology summaries, prior treatment, the proposed plan,
patient preferences). The agent validates it against a minimum data set --
missing fields are surfaced in the draft's `missing_information`, never
guessed. It then calls Claude with a system prompt that enforces a source
hierarchy: `fetch_guideline` is the PRIMARY anchor and is always called first
(never answer from memory, guidelines change); Anthropic's native `web_search`
is a SECONDARY source, restricted to authoritative oncology domains
(cancer.gov, nccn.org, esmo.org, esgo.org, figo.org, asco.org, PubMed), used
only to check for newer biomarker-driven therapy and to corroborate a claim
against a second source before it enters the draft. The result is a
schema-enforced JSON draft -- concordance verdict, alternatives, evidence
notes, missing information, escalation flag, and citations that tag each
source as `guideline` or `web_search`, with every substantive claim traceable
to a citation. Because Claude Fable 5's safety classifiers can decline benign
clinical work, the request opts into a server-side fallback to Opus 4.8; if
the whole chain still refuses, the case escalates. That draft then hits
`human_review_gate()` -- currently a stub that just prints -- which is meant
to block everything until a real gynecologic oncologist signs off.

## What's NOT done -- read this before your coworker builds on top

- **`human_review_gate()` is a print statement, not a review workflow.**
  There is no real approval step, no queue, no sign-off record. Nothing
  downstream of a draft opinion should exist until this is real.
- **No PHI/security hardening at all.** No encryption at rest, no access
  controls, no HIPAA-level safeguards on the audit logs. Do not point this
  at real patient data in its current form.
- **Guideline coverage is deliberately narrow right now.** Only NCI PDQ
  (cervical, ovarian, endometrial, vulvar) is wired in, because PDQ is
  confirmed public-domain and safe for AI use. NCCN, ESMO, and ESGO
  guidelines are NOT included -- their current terms restrict or prohibit
  using their content as AI input without a separate license. Don't add
  their PDFs/pages to the registry until that license exists.
- **`fetch_guideline.py` scrapes HTML**, it doesn't use an official content
  API. It works, but NCI does offer a syndication service
  (cancer.gov/syndication) that would be more robust long-term.
- **No automated tests, no error monitoring/alerting, no retry/backoff
  beyond the basic try/except.**
- **The registry only has 4 rows right now** (trimmed during testing) --
  the fuller version also covers uterine sarcoma, vaginal cancer,
  gestational trophoblastic disease, and ovarian borderline/germ-cell
  tumors. Add rows back in the same `| cancer_type | subtype | source | url |`
  format if broader coverage is needed.
- **Model-specific parameters (`thinking`, `output_config`, `cache_control`
  ttl) were checked against the installed `anthropic` SDK's type
  definitions, but no real end-to-end API call has been run against them
  yet** -- confirm the full pipeline works with real credits before relying
  on it.

## Handoff notes for a coworker

- They'll need their own `ANTHROPIC_API_KEY` -- either get added to the
  same Claude Console workspace to generate their own key against the
  shared credits, or be given the existing key through a secure channel
  (not Slack/email in plaintext).
- The registry file is the thing to edit for new cancer types -- the
  Python files shouldn't need touching for that.
- Anything they build on top (real intake form, real review UI, EHR/HMR
  integration) should treat `get_draft_opinion()` in `second_opinion_agent.py`
  as the one function they call, and should build the human review gate
  for real before anything reaches a clinician.
