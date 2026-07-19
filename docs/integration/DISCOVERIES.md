# NUDG MD → canonical NUDG: extraction dossier

**Document status.** Master index of the formal extraction performed 2026-07-18 (post-judging)
of every subsystem, invariant, design law, and defect developed in this repository, prepared
for re-implementation inside the canonical NUDG companion application. This file is the root
of a document graph; it states the results and their epistemic status, and delegates full
proofs to four specification files in this directory. The target-specific mapping (which
names private-repository internals) is deliberately **not** in this public repository; it
resides in the private repository at `docs/NUDG_MD_INTEGRATION_MAP.md`.

**Register.** Formal throughout. Numbered series used here: S*n* (subsystems), DL*n* (design
laws), CR*n* (canon corrections), OB*n* (integration obligations), K*n* (conjectures/open
problems). Each spec file carries its own internal numbering (D/INV/L/T/…); cross-references
from this file are by file + topic, never by unverified internal label.

**Epistemic status convention.** Three levels, stated per claim:
- **[V]** — re-derived independently during synthesis (source line read, or arithmetic
  machine-recomputed) in addition to agent extraction.
- **[E]** — extracted by a specification agent with `file:line` citations recorded in the
  owning spec; not independently re-derived during synthesis.
- **[C]** — conjecture: stated with what is missing; never used as a premise elsewhere.

The reader's task is to falsify. Every claim below is written to be checkable: it names its
witness (a line, a computation, or a trace) or is marked [C].

---

## 0. Document graph

| File | Contents | Internal apparatus |
|---|---|---|
| `SPEC_EVENT_FABRIC.md` | Event alphabet (29 types, ~100 fields), platform SPEC-FACTs, privacy non-interference theorem, surface-ownership protocol, staged commands, rolling log | 17 sections, 11 proof blocks, 1 conjecture |
| `SPEC_RULE_ENGINE.md` | Engine state space, R-01/R-04/R-09/R-12 as labeled transition systems, guard truth tables, claims/cooldowns/supersession, safety theorem, 9 worked traces, defect register DX-01…DX-15 | 26 sections, 13 proof blocks |
| `SPEC_AI_LANES_PANEL.md` | Lane lifecycle LTS, monotone-provenance theorem, latency-receipt semantics, cancellation non-guarantees, panel aggregation soundness, Holloway refusal theorem | 17 sections, 12 proof blocks |
| `SPEC_EVIDENCE_ROI.md` | Claim-registry schema, boundary rules as a type system, unit-elasticity lemma, 28-figure machine recomputation, KPI schema, assumption-register template | 9 sections, 3 proof blocks |
| *(private repo)* `docs/NUDG_MD_INTEGRATION_MAP.md` | Target architecture map, transport gap analysis, mappings M1–M9 with risk registers, sequencing P1–P9 with gating test suites, open questions Q1–Q14 | 700 lines, read-only extraction |

Ground truth for all four public specs: `shared/bus.js` (78), `shared/nudges.js` (923,
canonical incl. commit 345b377), `shared/buddy.js` (435), `ehr/app.js` (530),
`scribe/app.js` (485), `server/relay.py` (706), `data/patients.json`, `data/evidence.json`,
`docs/ROI_MODEL.md`, `docs/evidence/EVIDENCE_PACK_2026-07-18.md`.

---

## 1. Subsystem inventory (S1–S9)

Each entry: the formal object, its central invariant (restated in full — repetition is
deliberate), and the owning spec.

**S1 — Event fabric.** A same-origin broadcast structure: `BroadcastChannel("nudg-demo")`
⊎ same-tab synchronous fanout ⊎ rolling persisted log (capacity 100 events, TTL 4 h).
Central invariant **[V]** (privacy non-interference, verified at `shared/bus.js:23–31, 44`):
the sanitizer `sanitizedDetail` deletes exactly the key set `{q, text, note}` and is applied
inside `emit` itself — hence **both** the broadcast payload and the persisted log entry are
sanitized; free-text clinical content is unrepresentable on the fabric. The scribe emits only
`note_signals` drawn from a finite regex-derived vocabulary, so channel information content
is bounded by log₂|vocabulary| bits per event plus structural fields. Explicit non-coverage
(stated, not hidden): `mrn` identifiers and event *timing* are visible on the fabric; the
invariant bounds *content*, not metadata. Owner: `SPEC_EVENT_FABRIC.md` (structural-induction
proof over the 29-type emission table).

**S2 — Deterministic rule engine.** A single-threaded transition system over state
(noteSignals, tabViews, lastTabByMrn, cards, claims, cooldowns, metrics, timers) consuming
the S1 alphabet, emitting only: card render, badge state, focus/stage actions, metric bumps.
Rules: R-01 (cross-app join, note signal × chart condition), R-04 (wayfinding: ≥4 *distinct*
tabs under user provenance within 40 s), R-09 (stillness: sliding 8 s/90 s deadline, re-armed
by user activity, fire-time-gated on Summary), R-12 (post-simulated-send watch). Central
theorem **[E]**: safety — the engine's full action repertoire crosses no machine boundary
(all sends simulated; enumeration in `SPEC_RULE_ENGINE.md`). At-most-once card emission per
(rule, mrn, cooldown-window) via claims **[E]**. Owner: `SPEC_RULE_ENGINE.md`.

**S3 — Cross-tab surface ownership.** `openEhrTarget()`: window.open-by-name inside a click
gesture + `__nudgEhrReady`/`__nudgEhrInstanceId` handshake + staged commands under
`nudg_pending_ehr_command` (15 s TTL, read-then-remove on target load). Governing platform
fact **[V]** (observed live as the wrong-tab failure, then spec-confirmed): named
browsing-context lookup is scoped to the **browsing context group**; an independently-opened
tab is unreachable by name. Consequences are DL4 below. At-most-once staged-command execution
holds within one group by run-to-completion atomicity **[E]**; the cross-process TOCTOU race
between two cold-starting target tabs is exhibited, bounded by the TTL, and mitigated by the
single-owner handshake **[E]**. Owner: `SPEC_EVENT_FABRIC.md`.

**S4 — Attention-clock UI.** (i) `spotlightOnArrival`: highlight timers deferred through
`visibilitychange` so the 6 s window is measured in *visible* time, not wall time; (ii) badge
policy: numeric red ⇔ actionable-nudge count > 0, gray dot ⇔ passive activity only; (iii)
popover placement: measured `offsetHeight` (never an assumed constant) + prefer-above +
viewport clamp + `ResizeObserver` re-clamp. Owner: `SPEC_EVENT_FABRIC.md` (consumer
sections); laws DL3/DL5 below.

**S5 — Two-lane AI with monotone provenance.** Lane lifecycle LTS: `SCRIPTED →
LIVE_PENDING → {LIVE_SERVED(mode, latency_ms), SCRIPTED_FALLBACK}`. Central invariant
**[E]** (monotone provenance, proved over all paths incl. error and cancel): the displayed
provenance label upgrades only on a served live result; failure and cancellation leave the
scripted label intact. Latency receipt: a defined client-side interval (definition with its
measurement points in `SPEC_AI_LANES_PANEL.md`), certifying end-to-end request latency, not
model-time decomposition. Cancellation: POSIX process-group termination for the CLI lane;
explicit non-guarantee **[V-by-disclosure]**: an already-sent HTTPS request may complete
server-side. Corrected location claim: this machinery lives in `shared/nudges.js`, not
`shared/buddy.js` (CR2). Owner: `SPEC_AI_LANES_PANEL.md`.

**S6 — Panel aggregation.** Seats S, vote alphabet {support, oppose, insufficient} with
abstention first-class. Display = the pair (|support|, |S|) — counts, never averaged
confidence. Aggregation-soundness theorem **[E]**: the count display requires no
independence, calibration, or exchangeability assumption; an averaging counterexample is
exhibited. Refusal semantics as coded **[V]** (`shared/nudges.js:706–712`): UNDERDETERMINED
⇔ ∃ seat with stance = insufficient. See CR3 — this is *narrower* than the previously
narrated "support < quorum" rule. Holloway (3 insufficient + 1 oppose) ⇒ UNDERDETERMINED,
proved under the coded rule **[V]**. Owner: `SPEC_AI_LANES_PANEL.md`.

**S7 — Evidence layer with typed boundaries.** Claim registry: 36 claims, schema fields
(id, claim, effect size with n/N, population, source, year ∈ ℤ ∪ {"UNVERIFIED"}, DOI/URL,
study type, quality grade, quotable line ≤ 25 words). Boundary rules formalized as a type
system **[E]**: each quantitative claim typed by (construct dimension × population ×
year-USD × design); addition is defined only at identical dimension — therefore the cost
lanes are pairwise incomparable and any cross-lane sum is *ill-typed* (never-sum =
dimensional soundness, proved); relative-risk → individual-probability coercion is ill-typed
absent a base-rate premise; guideline authority carries a population index and does not
transfer; UNVERIFIED admits no out-coercions. Owner: `SPEC_EVIDENCE_ROI.md`.

**S8 — Tempo modes.** NOW/FOCUSED/DEEP/WATCH as a scheduling policy over card classes
(interrupt eligibility × deferral horizon). In this build the modes are design vocabulary
realized partially (R-09 followUp mode; WATCH cards); the full policy lattice is an
integration obligation (OB6), not an implemented artifact — stated so it cannot be
mistaken for shipped behavior.

**S9 — Parallel-rig methodology (blue/green for live demos).** Definition: a namespace
injection σ applied to the three shared-mutable-state domains of same-origin browsing
contexts — channel names, storage keys, window names — producing a full rig
(`/scribe2/ /ehr2/ /shared2/`, channel `nudg-demo2`, keys suffixed `2`, names
`nudg-scribe2`/`nudg-ehr2`). **Non-interference proposition [V by construction]:** if σ is
injective and its codomain is disjoint from the canonical namespace on all three domains,
the rig and canonical systems share no mutable state, hence event traces of one are
invariant under arbitrary execution of the other. Proof sketch: the only cross-context
mutable channels for same-origin documents are exactly those three domains (plus network,
unused rig-side); disjointness removes each; induction over interleaved traces. Promotion =
applying the rig-validated diff modulo σ⁻¹ (performed as commit 345b377). Method validated
operationally: the memorized live demo remained untouched while the R-09 fix was proven in
the rig, then promoted.

---

## 2. Design laws from observed failures (DL1–DL6)

Each law: failure trace → statement → enforcement site → integration obligation. These are
the transferable results; each was purchased with a live malfunction.

**DL1 — Provenance separation.** *Failure:* programmatic `setTab("summary")` during chart
open counted as doctor navigation; R-04/R-09 fired prematurely ("it is time-scripted").
*Law:* partition observer state into **location state** (where the user is — updated on
*every* transition, any provenance) and **activity state** (what the user did — updated
*only* on user-provenance events). Formally: for event e with provenance bit u(e),
location := δ_loc(location, e) unconditionally; activity := δ_act(activity, e) iff u(e).
*Enforcement [V]:* `lastTabByMrn.set(d.mrn, d.tab)` precedes the `if (!d.user) break;`
guard in the `ehr_tab_viewed` case of `shared/nudges.js` — the ordering is load-bearing.
*Obligation OB1:* every event schema in the target carries an explicit provenance bit;
no rule consumes an event lacking it.

**DL2 — Fire-time context gating.** *Failure:* R-09 armed during scenario 2 fired while a
document was foregrounded, interrupting the demo. *Law:* eligibility guards over *ambient
context* (foreground tab, focus, mode) must be evaluated at **fire time** t_fire, not at
arm time t_arm — the arm-time context is stale by construction. Corollary (accepted
trade-off, stated openly): with gate-reject-without-re-arm, the system enters a **silent
absorption** state — after a rejection, no depth prompt until the next user activity. The
trade was chosen deliberately: false silence over false interruption, consistent with the
restraint metric (nudges/encounter target < 1). Reachable-trace analysis in
`SPEC_RULE_ENGINE.md` **[E]**. *Obligation OB2:* target scheduler re-checks all context
guards at delivery; a rejected delivery transitions to a defined re-arm policy chosen per
rule (absorb vs re-queue), never an implicit one.

**DL3 — Attention-clock timers.** *Failure:* a 4.5 s highlight expired inside a hidden tab;
the user never saw it. *Law:* timers that measure *human attention* must run on visible
time: start ⇔ document visible; defer via one-shot `visibilitychange` otherwise. Wall-clock
timers are valid only for machine deadlines (TTLs, cooldowns). *Enforcement [E]:*
`spotlightOnArrival` in `ehr/app.js`. *Obligation OB3:* the target's UI layer exposes an
attention-clock timer primitive; UX timers are ill-formed on the wall clock by lint rule.

**DL4 — Surface ownership.** *Failure:* the buddy targeted a user-opened EHR tab by name;
the platform, scoping named lookup to the browsing context group, opened a *new* tab while
the old one sat stale. *Law:* an agent may only direct surfaces it **created or adopted
through a handshake**; cold-start direction uses staged commands (persisted, TTL-bounded,
consumed exactly once on load). *Enforcement [V/E]:* `openEhrTarget()` + readiness
handshake + `nudg_pending_ehr_command` (15 s TTL). *Obligation OB4:* in the target, every
controllable surface registers with the companion (instance id, capability set); direction
of unregistered surfaces is rejected at the API, not attempted and half-performed.

**DL5 — Measure-then-place.** *Failure:* popover placement assumed height ≤ 360 px; tall
cards rendered off-viewport. *Law:* geometry decisions consume only *measured* extents
(`offsetHeight`, `ResizeObserver`) and re-run on resize; assumed intrinsic sizes are
ill-formed. *Enforcement [E]:* `positionPop` + observer in `shared/buddy.js`. *Obligation
OB5:* companion window placement in the target uses measured display/work-area geometry
with a re-clamp subscription.

**DL6 — Namespaced rig (S9 restated as law).** *Failure mode avoided:* mutating a
memorized live demo hours before presenting. *Law:* validate behavioral changes in a
σ-renamed clone sharing zero mutable state; promote by σ⁻¹ on the validated diff only.
*Obligation OB6a:* the target gains a config-level namespace parameter (bus subject prefix,
store key prefix, window-class suffix) so a rig is a configuration, not a copy-paste.

---

## 3. Canon corrections (CR1–CR9)

Divergences between what was previously narrated/documented and what the code proves.
Each names its witness. These matter precisely because the integration must copy the
*actual* semantics, not the remembered ones.

- **CR1 [V]** Sanitization is applied at **emission** (`shared/bus.js:23–31, 44`), covering
  broadcast *and* log — stronger than the narrated "log-only" sanitization. Key set exactly
  `{q, text, note}`.
- **CR2 [E]** Lane chips, latency receipts, and the cancel path are implemented in
  `shared/nudges.js`, not `shared/buddy.js`; Shift+B cancels only via popover-close →
  `nudg:buddy-closed`.
- **CR3 [V]** Panel refusal predicate as coded (`shared/nudges.js:706–712`):
  UNDERDETERMINED ⇔ at least one seat votes *insufficient*. There is **no support quorum**;
  an all-oppose panel renders `Supported: 0/N`, not a refusal. Design reading: refusal
  encodes *epistemic insufficiency* (missing data requested), while substantive opposition
  remains visible in the count. Integration decision required (OB7): keep, or generalize to
  an explicit configurable predicate; either way the predicate must be declared, not
  implicit.
- **CR4 [E]** `server/relay.py` computes a panel aggregate that the UI never reads; the
  client recomputes it (equivalence on valid seat sets proved in `SPEC_AI_LANES_PANEL.md`).
  Dead computation to delete or adopt at integration.
- **CR5 [E]** Relay health `"ready"` certifies key **presence**, not key validity.
- **CR6 [V]** ROI community-hours lower bound: exact 16.07 h/day at 50 FTE; the table
  previously displayed 17. Corrected to 16 in `docs/ROI_MODEL.md` this commit. (28 figures
  machine-recomputed in `SPEC_EVIDENCE_ROI.md`; this was the single beyond-rounding
  discrepancy. One deliberate self-disfavoring round survives by design: $0.016 → "two
  cents".)
- **CR7 [V]** The "§15 measurement plan" cross-reference dangled (the evidence pack has no
  §15; §15 of the design spec is the evidence *mapping*). `docs/ROI_MODEL.md` §7 now
  self-contains its enumeration. `docs/JUDGE_QA.md` retains the stale token as a historical
  artifact of the judged version; do not propagate it into the target.
- **CR8 [E]** The believed generate-note-overwrites-edits defect is **absent** in the
  current `scribe/app.js` (draft-preserving paths at :239, :472). The *actual* persistence
  defect: on reload, reviewed-status persists while edits do not (state divergence,
  DX-registered).
- **CR9 [E]** `open_research` is dead code, and live research anchors bypass the audit
  trail that scripted anchors traverse (`shared/nudges.js:362–364` vs `:400–402`) — an
  honesty-surface gap to close at integration (OB8).

---

## 4. Defect and conjecture register (summary)

Full register: DX-01…DX-15 in `SPEC_RULE_ENGINE.md` §Discrepancies (includes: `show_me`
broadcast without acknowledgment path; metric evaluated/fired asymmetry; twin-tab
`activeMrn` clobber; the CR8 reload divergence). Standing conjectures, usable as premises
nowhere:

- **K1 [C]** Twin-tab claim race: two same-rule claims may both survive when two engine
  instances race on claim keys across processes; suspected window is one storage round-trip.
  Missing: a forced-interleaving reproduction.
- **K2 [C]** Hidden-tab timer throttling alters R-09 deadline accuracy beyond the modeled
  bound in background tabs. Missing: measurement under Chrome's intensive throttling policy.

Both are transport-level races that the target integration dissolves *by construction* if
OB4's registration model and a server-side claim authority (single writer) are adopted —
which is the recommended resolution rather than in-browser mitigation.

---

## 5. Integration obligations (consolidated)

OB1 provenance bit on every event schema (DL1). OB2 fire-time guard re-check + declared
re-arm policy per rule (DL2). OB3 attention-clock timer primitive; wall-clock UX timers
ill-formed (DL3). OB4 surface registration + reject-unregistered direction (DL4). OB5
measured-geometry placement with re-clamp (DL5). OB6 namespace parameter for rig
configurations (DL6); tempo-mode policy lattice made explicit (S8). OB7 refusal predicate
declared and configurable (CR3). OB8 audit-trail parity for live research anchors (CR9).
OB9 gateway response metadata must carry {served_mode, latency_ms, receipt} to preserve S5's
monotone-provenance invariant end-to-end (the private map identifies the concrete envelope
gap and the transport decision; sequencing P1–P9 and gating test suites are enumerated
there). OB10 the assumption-register template (id, statement, status ∈ {STIPULATED,
HYPOTHESIZED, PURE-ASSUMPTION, STRUCTURAL}, sensitivity hook) ships with any quantitative
claim surface (S7; template in `SPEC_EVIDENCE_ROI.md`).

---

## 6. What was proved, in one table

| Result | Status | Where |
|---|---|---|
| Privacy non-interference of the fabric (content-bounded, metadata excluded) | Proved [V sanitizer site] | SPEC_EVENT_FABRIC |
| At-most-once staged-command execution in-group; TOCTOU exhibited cross-process with TTL bound | Proved + negative exhibit [E] | SPEC_EVENT_FABRIC |
| Named-lookup group scoping ⇒ create-or-adopt necessity | SPEC-FACT + corollary [V operationally] | SPEC_EVENT_FABRIC |
| R-04 fires iff ≥4 distinct user-provenance tabs in window; never from programmatic navigation | Proved [E] | SPEC_RULE_ENGINE |
| R-09 fire-time Summary gate; silent-absorption reachability; old-vs-new regression trace pair | Proved + trace [E] | SPEC_RULE_ENGINE |
| Engine safety: no boundary-crossing action in the full repertoire | Proved [E] | SPEC_RULE_ENGINE |
| Monotone provenance across all lane paths incl. error/cancel | Proved [E] | SPEC_AI_LANES_PANEL |
| Aggregation soundness (counts assumption-free; averaging counterexample) | Proved [E] | SPEC_AI_LANES_PANEL |
| Holloway panel ⇒ UNDERDETERMINED under the coded predicate | Proved [V predicate site] | SPEC_AI_LANES_PANEL |
| Never-sum = dimensional soundness; ill-typed coercions per boundary rule | Proved [E] | SPEC_EVIDENCE_ROI |
| Unit elasticity of the ROI chain; interval propagation; 28-figure recomputation (1 erratum → CR6) | Proved + machine-checked [V arithmetic] | SPEC_EVIDENCE_ROI |
| Rig non-interference under namespace injection σ | Proved (construction) [V] | this file, S9 |

Anything not in this table is not proved; it is inventory, law, obligation, or conjecture,
and is labeled as such at its site.
