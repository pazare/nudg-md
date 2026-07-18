# NUDG MD — living context & decision log

This file is the compaction-safe source of truth for the build. Update it at every validated step.

## Mission

Win *The Future of Agentic AI in Healthcare* (Abridge × Anthropic × Lightspeed, 2026-07-18) with an
**expert desktop buddy for clinicians**: it watches workflow events across portals (ambient scribe +
legacy EHR) and surfaces professional, grounded nudges — research, prior notes, hospital-guideline
considerations, network insights, and questions. Non-technical clinicians see only the nudges; all
machinery stays hidden.

## Decision log

| When (PT) | Decision |
| --- | --- |
| 2026-07-18 ~11:20 | Pivot: do NOT build the Tribunal clinical escalation POC; keep its rigor/honesty standards as reference. |
| 2026-07-18 ~11:25 | Build = re-designed-from-scratch healthcare version of the NUDG buddy companion. Reference NUDG repo heavily, copy no code (no license; contains secrets). |
| 2026-07-18 ~11:30 | Demo staging = two Chrome tabs: synthetic Abridge-style scribe + synthetic legacy "MediCore" EHR. One localhost origin (:4800) so BroadcastChannel spans tabs. |
| 2026-07-18 ~11:35 | Buddy will be browser-based (Document Picture-in-Picture window, Chrome 116+), NOT Electron — Electron cannot join Chrome's BroadcastChannel; PiP is genuinely always-on-top and same-origin. |
| 2026-07-18 ~11:40 | Public repo `pazare/nudg-md` created day-of; public from first commit for verifiable provenance. |

## Step ladder

- [x] **S1 — Synthetic environment.** Scribe (worklist → record → drafted note → Ask panel) + MediCore EHR (schedule, chart, notes filing, orders) + shared synthetic panel + event bus. → *Awaiting Pablo validation round 1.*
- [ ] **S2 — Buddy skeleton.** `companion/` page opened as Document PiP: header with tempo-mode pill, professional nudge-card stack, acted/dismissed lifecycle, event feed debug toggle (hidden by default).
- [ ] **S3 — Context wiring.** Deterministic rules: workflow event patterns → grounded nudges with per-nudge "why am I seeing this" traceability (every nudge must trace to an event + rule; no free-floating notifications).
- [ ] **S4 — Nudge content packs.** Per-patient synthetic packs: research, prior-note flags, hospital-guideline considerations (synthetic "Riverbend protocol"), network insights, questions. Optional live-LLM lane if time allows, clearly labeled.
- [ ] **S5 — Demo script + polish.** 4-minute script, fallback ladder, honest-limits slide, build manifest finalized.

## Validation log (Pablo is the gate)

| Round | When | Verdict / feedback |
| --- | --- | --- |
| 1 | pending | — |

## Architecture (current)

- One static origin `localhost:4800` (`scripts/serve.sh`, python http.server). Paths: `/scribe/`, `/ehr/`, later `/companion/`.
- `shared/bus.js`: `NudgBus.emit(app, type, detail)` → BroadcastChannel `nudg-demo` + rolling `localStorage['nudg_demo_events']` (last 300, replayable by late joiners).
- Event taxonomy emitted today:
  - scribe: `app_loaded`, `encounter_selected`, `encounter_added`, `recording_started`, `recording_stopped`, `note_generated`, `note_copied`, `note_reviewed`, `ai_question_asked`
  - ehr: `app_loaded`, `ehr_patient_opened`, `ehr_tab_viewed`, `ehr_note_filed`, `ehr_orders_signed`
- Synthetic data: `data/patients.json` (5 patients, scripted notes + scripted Q&A). All fictitious.

## Buddy design notes (for S2/S3, from NUDG recon + rigor brief)

- Nudge model: `{id, type: research|prior_note|guideline|network|question, priority, patientCtx, title, body, source, actions}`; lifecycle `created→queued→shown→acted|dismissed|expired`; decide vs commit split; outcomes logged back onto the bus.
- Cadence: single silence floor + per-nudge-key escalating cooldown (damper). "Specific-or-silent": no generic nudges.
- Tempo modes (adopted vocabulary, adapted to nudging): **NOW** (never gate or delay action; only pre-assembled context), **FOCUSED** (bounded, same-visit suggestions), **DEEP** (longer-horizon considerations, e.g. referrals/screening), **WATCH** (result ownership: pending items get owner + deadline + escalation). Mode shown as a pill; stamped on every nudge.
- Traceability: every nudge shows "why" (triggering event + rule + source). Nudge counts reportable as n/N per rule.
- Honesty rails: SYNTHETIC banner every surface; decision-support framing (human decides); scripted content labeled; limits = EXHAUSTED (actually hit) vs HYPOTHESIZED.

## Ops

- Budget: ~$100 Claude API credits + Codex CLI + Pro account. Delegation: Fable max agents; Codex for straightforward lanes.
- Background agent reports received 11:35 PT: NUDG companion recon; rigor-docs distillation. Key: no NUDG code into public repo (no license, `.env` secrets); PiP recommendation; provenance bucket wording.
- Reference repos (read-only): `/Users/pablo/Desktop/Summer 2026/nudg` (NUDG/VECOS), `/Users/pablo/Desktop/RAISE Cursor` (Tribunal prep, honesty/judging docs).
