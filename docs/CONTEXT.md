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
| 2026-07-18 ~11:30 | Demo staging = two Chrome tabs: synthetic Abridge-style scribe + fictional synthetic legacy "LegacyChart" EHR. One localhost origin (:4800) so BroadcastChannel spans tabs. |
| 2026-07-18 ~11:35 | Buddy will be browser-based (Document Picture-in-Picture window, Chrome 116+), NOT Electron — Electron cannot join Chrome's BroadcastChannel; PiP is genuinely always-on-top and same-origin. |
| 2026-07-18 ~11:40 | Public repo `pazare/nudg-md` created day-of; public from first commit for verifiable provenance. |
| 2026-07-18 ~12:10 | Collapsed buddy presence built as two live-switchable variants — A "calm dock orb" (draggable, snaps to edges) vs B "cursor companion" (lagged follower, NUDG heritage). Shift+B or popover link switches; choice synced across tabs via bus. Bus gained same-tab fanout (BroadcastChannel skips own context). Pablo picks a variant at validation. |
| 2026-07-18 ~12:49 | Validation 1 passed. Variant A default, B retained. Demo = 3 live scenarios: (1) omitted context changes a reasonable differential; (2) guided navigation to buried chart info; (3) depth prompt — specific research + synthetic specialist directory (expandable) + second-opinion panel with well-being/time/cost visuals and a single-model ↔ multi-agent (Tribunal-heritage) toggle. Scenario 3 needs one added synthetic oncology patient (design first, data next step). |
| 2026-07-18 ~13:17 | Claude design critique round 1 committed. Codex validation found additional blockers: S1 did not match the diagnosis brief, the panel contradicted its refusal rule, weekdays were wrong, proof-like mocks lacked local labels, Quick take was not default, and narrow reflow/ARIA/contrast failed. A local correction pass addresses those defects before wiring. |
| 2026-07-18 ~14:0x | **Companion wired live.** `shared/nudges.js` engine: R-01 (derived note signals; raw free text stripped before transport), R-04 (wayfinding, self-supersedes on document open), R-09 (depth prompt via `depthPack`, demo dwell 8 s), and R-12 (an unsent local draft first; Watch only after explicit **Simulate sign & send**). Cards render in Nudges; Activity is the audit trail; EHR obeys safe navigation commands. The localhost AI relay offers optional Claude/Codex lanes, honest scripted fallbacks, strict origin checks, and cancellable Codex runs. The Holloway pack is explicitly a diabetes/CKD sample, not Pablo's pending vaginal-cancer case. |
| 2026-07-18 ~15:05 | **Evidence pack added.** The verbatim report and 36-claim registry are committed. A structurally compatible oncology `depthPack` template is present but not loaded at runtime; its patient slots and population applicability must be resolved before integration. |

## Step ladder

- [x] **S1 — Synthetic environment.** Scribe (worklist → simulated timer → scripted editable note → scripted Ask panel) + LegacyChart EHR (schedule, chart, notes filing, orders) + shared synthetic panel + event bus. Pablo validated the environment; correctness hardening is under replay.
- [x] **S2 — Buddy skeleton.** Collapsed A/B presence, accessible Nudges/Activity views, card stack, peek, dismissal reasons, cooldown, and cross-tab lifecycle are live. Default may shift from A to B after Pablo's test.
- [x] **S3 — Context wiring.** Deterministic R-01/R-04/R-09/R-12 rules trace every shown card to patient-scoped events and a rule id; raw free text is excluded from the transport.
- [ ] **S4 — Nudge content packs.** James differential and Margaret wayfinding/runtime depth samples are live. The oncology evidence registry and non-live template are present; patient-specific facts, applicability checks, and runtime integration remain pending. The gallery is explicitly illustrative. Optional model lanes are wired and labeled.
- [ ] **S5 — Demo script + polish.** 4-minute script, fallback ladder, honest-limits slide, build manifest finalized.

## Validation log (Pablo is the gate)

| Round | When | Verdict / feedback |
| --- | --- | --- |
| 1 | 2026-07-18 ~12:49 | Environment validated (worked after refresh; initial confusion finding the orb — onboarding cue worth considering). **Variant decision: A (calm dock) is default; keep B switchable via Shift+B.** Directive: develop efficiently; next = nudge card design (design only), 3 demo scenarios; second-opinion panel with calculations/visualizations; frontier-vs-MA toggle. |
| 2 | 2026-07-18 ~13:4x | Cards "almost good": fix in-card overflow; friendlier copy (strong verbs, colons, capitalization); make it intuitive and "nudgy"; moat = cursor integration. Oncology (vaginal cancer) case arrives after research; GPT-5.6 Pro evidence run in flight. Next: wire the companion + AI (done ~14:0x, commit ef12d06). |
| 3 | pending | Full live test per docs/TESTING.md (all 6 phases). **Variant default may shift to B (cursor companion) — Pablo signaled "we might be shifting towards B."** Claude lane lights up when Pablo exports ANTHROPIC_API_KEY and restarts the relay. |

## Architecture (current)

- One static origin `localhost:4800` (`scripts/serve.sh`, python http.server). Paths: `/scribe/`, `/ehr/`, `/design/cards.html`; the same launcher manages the optional relay on `127.0.0.1:4809`.
- `shared/bus.js`: `NudgBus.emit(app, type, detail)` → BroadcastChannel `nudg-demo` + rolling `localStorage['nudg_demo_events']` (100-event cap, four-hour TTL, replayable by late joiners). Raw `q`, `text`, and `note` fields are stripped before both fanout and persistence; Reset clears the log across tabs.
- Event taxonomy emitted today:
  - scribe: `app_loaded`, `encounter_selected`, `encounter_added`, `recording_started`, `recording_stopped`, `note_generated`, `note_generation_cancelled`, `note_signals`, `note_copied`, `note_copy_failed`, `note_reviewed`, `ai_question_asked`
  - ehr: `app_loaded`, `ehr_patient_opened`, `ehr_chart_closed`, `ehr_tab_viewed`, `ehr_document_opened`, `ehr_note_filed`, `ehr_note_mismatch_blocked`, `ehr_orders_signed`
- Scripted note/review state and EHR drafts/notes/orders use per-tab `sessionStorage`; Reset Demo clears those artifacts and the shared event log across open tabs.
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
