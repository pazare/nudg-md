# NUDG MD — an expert desktop buddy for clinicians

**Hackathon proof of concept.** Built at *The Future of Agentic AI in Healthcare* — Abridge × Anthropic × Lightspeed, San Francisco, **July 18, 2026**. Team: Pablo Zavala & Santiago (team of two).

Clinicians spend their day juggling portals: an ambient scribe in one tab, a legacy EHR in another, guidelines and prior notes somewhere else. **NUDG MD is a desktop buddy that watches the workflow (locally, event-based) and offers timely, grounded nudges** — relevant research, prior notes, hospital-guideline considerations, network insights, and good questions — so the clinician navigates faster and safer without leaving their flow.

> **Everything in this repository is synthetic.** Every patient, clinician, note, lab, and answer is fictitious and generated for demonstration. This is a decision-support *demo* — a human clinician decides, always. It is not a medical device, and no claim of clinical outcomes, diagnostic performance, or regulatory compliance is made.

## Status

| Step | What | Status |
| --- | --- | --- |
| 1 | Synthetic demo environment: ambient-scribe app + fictional legacy EHR, shared event bus | **Built — correctness hardening in progress** |
| 2 | Collapsed buddy presence (A default, B via Shift+B) + nudge-card design gallery | **Design built; cards not wired** |
| 3 | Context wiring: workflow events → grounded nudges (tempo-mode cadence) | Not wired |
| 4 | Nudge content packs + demo script | Design examples only |

Living plan and decision log: [`docs/CONTEXT.md`](docs/CONTEXT.md).

## Quickstart

```bash
./scripts/serve.sh
# then open in Google Chrome:
#   http://localhost:4800/scribe/   (ambient documentation app)
#   http://localhost:4800/ehr/     (fictional legacy "LegacyChart" EHR)
#   http://localhost:4800/design/cards.html  (design-only nudge gallery)
```

No dependencies beyond `python3`. Both app tabs share one local origin so the buddy can subscribe to the same `BroadcastChannel` event stream (`shared/bus.js`).

## What's in the demo environment

- **`scribe/`** — a synthetic look-alike of an ambient clinical-documentation workflow (worklist → record visit → drafted note → ask-the-assistant panel). Recreated for demo staging only; **not affiliated with, endorsed by, or containing any code or assets from Abridge Inc.** — it exists so the buddy can be demonstrated against a realistic modern surface.
- **`ehr/`** — "LegacyChart v4.2," a deliberately dated fictional EHR (schedule, chart tabs, note filing, order entry) representing the legacy portal side of the workflow.
- **`data/patients.json`** — a fully synthetic five-patient panel (marked `synthetic: true`).
- **`shared/bus.js`** — the workflow event stream (`BroadcastChannel` + a sanitized, four-hour, 100-event `localStorage` log) the buddy listens to.
- **`design/`** — the design-only nudge-card and second-opinion gallery. Its examples, providers, metrics, receipts, model outputs, and calculations are illustrative and not runtime evidence.

Every screen carries a **SYNTHETIC — NOT FOR CLINICAL USE** marker.

## Provenance (disclosed per event norms)

- **Built during the event:** everything in this repository. The public commit history supports publication timing; authorship and event-time scope are disclosed team attestations.
- **Prepared before the event (disclosed reference, none of it shipped here):** our research/honesty/judging protocol documents, and workflow familiarity.
- **Pre-existing substrate (disclosed reference, no code copied):** NUDG, our general-purpose companion platform (private repo `pazare/nudg_pazare`), whose nudge-lifecycle concepts (decide→commit delivery, damper cooldowns, "specific-or-silent" grounding) inform this from-scratch healthcare redesign.

## Honest limits

- Answers in the demo assistant are scripted synthetic content, not live model output (labeled as such in-app).
- The professional nudge cards, rules, provider directory, model lanes, receipts, and scenario calculations are currently design artifacts, not wired runtime behavior.
- Nudge quality claims are demonstrated on synthetic cases only; nothing here is validated on real clinical data.
- Any limitation we present as real is one we actually hit; everything else is hypothesized and labeled that way.

## License

MIT — see [`LICENSE`](LICENSE).
