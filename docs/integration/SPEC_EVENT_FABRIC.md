# Formal Specification — NUDG Event Fabric

Subsystem 1 of 2: the same-origin event bus, its rolling persisted log, the privacy
sanitizer, the UI-signaling consumers, and the cross-tab surface-ownership protocol
(named browsing contexts, readiness handshake, staged commands).

Ground truth (all line citations resolve against these files; repository root
`/Users/pablo/Desktop/Summer 2026/nudg-md/`):

| Abbrev | File | Lines |
|---|---|---|
| BUS | `shared/bus.js` | 78 |
| ENG | `shared/nudges.js` | 923 |
| BUD | `shared/buddy.js` | 435 |
| EHR | `ehr/app.js` | 530 |
| SCR | `scribe/app.js` | 485 |

The code is normative. Documentation (`docs/TESTING.md`, `docs/design/NUDGE_CARDS_DESIGN.md`)
is intent-only; every disagreement between code and prose is flagged where it occurs.

---

## 0. Notation

- 𝔻 — the set of same-origin browser documents (tabs) loading the suite. Each app page
  loads scripts in the order `bus.js`, `app.js`, `buddy.js`, `nudges.js`
  (`ehr/index.html:71–74`, `scribe/index.html:196–199`).
- For d ∈ 𝔻: B_d is d's bus instance (the IIFE result assigned to `window.NudgBus`, BUS:7),
  H_d is B_d's ordered handler list (BUS:13), C_d is d's `BroadcastChannel("nudg-demo")`
  object (BUS:12).
- An event record is a 4-tuple e = ⟨ts, app, type, detail⟩ (D1).
- σ — the sanitizer (D3). Δ — the note-signal derivation function (D6).
- Λ — the persisted rolling log: the value at `localStorage["nudg_demo_events"]` (BUS:9).
- clk(d) — document d's wall clock (`Date.now()` / `new Date()`).
- Sequences are written ⟨e₁, e₂, …⟩; |X| is cardinality; ⊎ is disjoint union.
- Definitions are D𝑛, platform facts SF𝑛, invariants INV𝑛, lemmas L𝑛, theorems T𝑛,
  corollaries C𝑛. Every lemma carries a proof or the marker CONJECTURE.

---

## 1. Platform semantics relied upon (SPEC-FACTs)

Each fact below is an assumption imported from a governing web specification, not from
the ground-truth code. Any re-implementation on another platform must re-establish these.

**SF1 (BroadcastChannel scope and no-self-delivery — WHATWG HTML, §Broadcasting to other
browsing contexts).** A message posted via `postMessage` on a `BroadcastChannel` object c
is delivered to every other `BroadcastChannel` object with the same channel name whose
relevant agent is same-origin (and same storage partition) — **excluding c itself**. The
posting object never receives its own message. Consequence in code: BUS:52 posts to other
documents; BUS:53 (`fanout(evt)`) performs the same-tab delivery that the platform withholds.
The header comment BUS:4–5 states this rationale and agrees with the code. Note: a *second*
`BroadcastChannel("nudg-demo")` object in the *same* document would receive the message;
the system creates exactly one per document (INV1), so same-document platform delivery
never occurs.

**SF2 (Structured clone — WHATWG HTML).** BroadcastChannel payloads are transferred by
structured cloning. Functions, DOM nodes, and other non-cloneable values throw. Every
payload in the alphabet (D2) is a tree of strings, finite numbers, booleans, plain arrays,
and plain objects, hence cloneable and also JSON-round-trippable (required because the same
record is persisted via `JSON.stringify`, BUS:48).

**SF3 (Per-sender FIFO; no global order — WHATWG HTML event-loop task queuing).**
Messages posted by one document to a given channel are enqueued as tasks in posting order
at each receiving agent; therefore, for a fixed (sender, receiver) pair, delivery order
equals emission order. No total order across *different* senders is guaranteed.
TO-VERIFY: per-sender FIFO across process boundaries is how all major engines behave and
follows from the spec's ordered task-queuing, but the spec text does not state the
cross-process guarantee as an explicit theorem; treat cross-sender interleavings as
adversarial in all proofs (all proofs below do).

**SF4 (localStorage — WHATWG HTML §Web storage).** `localStorage` is a synchronous,
same-origin (and same-partition) key–value store shared by all documents of the origin.
The API provides **no atomicity across agents**: the historical "storage mutex" is not
implemented, and the spec explicitly permits data races between documents in different
processes. Consequence: a read-modify-write or read-then-remove sequence is atomic only
within one event-loop task of one agent (SF6), never across two process-isolated tabs.
This is the root of the residual race in §6.6 (L5).

**SF5 (storage events — WHATWG HTML §Web storage).** A `storage` event fires only in
*other* same-origin documents, never in the mutating document. Observation: the system
registers **no** `storage` listener anywhere in the five sources; cross-tab signaling is
exclusively BroadcastChannel (SF1), and localStorage is used only as a passive store
(log, cooldowns, claims, metrics, referral state, staged command). SF5 is recorded
because a re-implementation that swaps BroadcastChannel for storage events would inherit
different delivery semantics (no same-tab delivery either, plus coalescing risks).

**SF6 (Run-to-completion — WHATWG HTML event loop).** Within one agent, each task
(event-handler invocation, timer callback, message delivery) runs to completion before
any other task of that agent runs. Consequence: any straight-line synchronous block in
the sources is atomic with respect to all other JS of the same document, including its
timer callbacks and incoming bus deliveries.

**SF7 (Named navigable lookup scope — WHATWG HTML, "the rules for choosing a
navigable").** `window.open(url, name)` with a non-reserved name resolves the name among
navigables **within the opener's browsing context group** (further restricted by
COOP/`noopener` severing). If no such navigable exists there, a **new** auxiliary
navigable with that name is created inside the opener's group. A top-level tab the user
creates independently (new tab, typed URL) starts its own browsing context group; it is
never resolved by another group's lookup, regardless of its `window.name`.
TO-VERIFY: exact partitioning under site isolation / COOP variants; the code's own
comment ENG:246–247 asserts precisely this Chrome behavior and the code defends against
both outcomes, so the protocol is correct under either resolution.

**SF8 (Empty-URL probe — WHATWG HTML window.open steps).** `window.open("", name)`:
if the name resolves to an existing navigable, its `WindowProxy` is returned **without
navigating it**; if not, a fresh auxiliary navigable is created showing `about:blank`.
This makes ENG:250 a non-destructive probe of an existing companion tab.

**SF9 (Same-origin WindowProxy access — WHATWG HTML §Security).** Same-origin windows may
read each other's `location` and expando properties (`handle.__nudgEhrReady`,
`handle.__nudgEhrInstanceId`, ENG:256–258); cross-origin access throws, which the probe
catches (ENG:259) and interprets as "not ours; reclaim".

**SF10 (Page Visibility — W3C Page Visibility).** `document.hidden` reflects visibility;
`visibilitychange` fires on transitions. Used by `spotlightOnArrival` (EHR:415–427) to
defer the 6 s spotlight until the tab is actually seen (design comment EHR:413–414).

**SF11 (Background timer throttling — engine behavior, not a single normative spec).**
Browsers clamp/throttle timers in hidden tabs (≥ 1 s granularity typical). Affects: the
60 ms document-open delay (EHR:397) and the R-09 dwell timer when the EHR tab is hidden.
TO-VERIFY per target browser; treated as a latency perturbation only — no proof below
depends on timer punctuality, only on eventual firing and one-shot-ness.

**SF12 (window.name persistence — WHATWG HTML).** A navigable's `name` persists across
same-origin navigations within that navigable. Both apps self-name at init
(`window.name = "nudg-ehr"` EHR:443; `"nudg-scribe"` SCR:453), so a companion-created
tab keeps its name after the staged navigation to `/ehr/` (ENG:314).

---

## 2. The event record and the alphabet

**D1 (Event record).** An event is e = ⟨ts, app, type, detail⟩ where
ts ∈ ISO-8601 strings (produced by `new Date().toISOString()`, BUS:44),
app ∈ {`"scribe"`, `"ehr"`, `"buddy"`, `"system"`}, type ∈ Σ (D2), and detail is a plain
JSON object. Constructed exactly once, at BUS:44 (and, for `demo_reset` only, BUS:71).
Note: the rule engine (ENG) emits with app = `"buddy"` even though it executes inside the
scribe/EHR documents (ENG:85, 99, 295, 307, 321, 324, 330, 337, 350, 881); `"buddy"`
identifies the *subsystem*, not the hosting document.

**D2 (Alphabet Σ — exhaustive).** Σ contains exactly the 29 types below; no other string
is ever passed as `type` in the five sources. Provenance classes (D7): DS = static
synthetic dataset (`/data/patients.json`), UI = UI state / enumerated constant,
CLK = clock-derived, ID = identifier (MRN, name, instance/command id), LEN = length of a
free-text buffer, DRV = derived from note text via Δ (D6), Q1 = one predicate bit over a
free-typed question, CFG = configuration.

| # | type | app | emitter site | detail fields: name — JS type — provenance |
|---|---|---|---|---|
| 1 | `app_loaded` | scribe | SCR:482 | `encounters` — number — DS |
| 2 | `app_loaded` | ehr | EHR:505 | `patients` — number — DS |
| 3 | `encounter_selected` | scribe | SCR:127 | `mrn` — string — ID; `name` — string — ID; `reason` — string — DS |
| 4 | `encounter_added` | scribe | SCR:139 | `mrn` — string — ID; `name` — string — ID |
| 5 | `recording_started` | scribe | SCR:167 | `mrn` — string — ID; `name` — string — ID; `simulated` — true — CFG |
| 6 | `recording_stopped` | scribe | SCR:179 | `mrn` — string — ID; `seconds` — number — CLK; `simulated` — true — CFG |
| 7 | `note_generation_cancelled` | scribe | SCR:94 | `mrn` — string — ID; `reason` — `"patient_switched"` — UI |
| 8 | `note_generated` | scribe | SCR:206 | `mrn` — string — ID; `name` — string — ID; `scripted` — true — CFG |
| 9 | `note_signals` | scribe | SCR:420–422 | `mrn` — string — ID; `name` — string — ID; `impressions` — array ⊆ {"anxiety"} — DRV; `topics` — array ⊆ {"nutrition_referral"} — DRV |
| 10 | `note_copied` | scribe | SCR:287 | `mrn` — string — ID; `name` — string — ID; `chars` — number — LEN |
| 11 | `note_copy_failed` | scribe | SCR:289 | `mrn` — string — ID |
| 12 | `note_reviewed` | scribe | SCR:300 | `mrn` — string — ID; `name` — string — ID |
| 13 | `ai_question_asked` | scribe | SCR:391–393 | `mrn` — string — ID; `name` — string — ID; `matched` — boolean — Q1; `chars` — number — LEN; `scripted` — true — CFG |
| 14 | `ehr_patient_opened` | ehr | EHR:141 | `mrn` — string — ID; `name` — string — ID |
| 15 | `ehr_chart_closed` | ehr | EHR:153 | `mrn` — string — ID; `name` — string — ID |
| 16 | `ehr_tab_viewed` | ehr | EHR:164 | `mrn` — string — ID; `tab` — enum {summary, problems, meds, allergies, labs, notes, orders} — UI; `user` — boolean — UI (provenance flag; see D10, and Rule-Engine spec DL1) |
| 17 | `ehr_document_opened` | ehr | EHR:258 | `mrn` — string — ID; `name` — string — ID; `type` — string — DS; `date` — string — DS |
| 18 | `ehr_note_mismatch_blocked` | ehr | EHR:289 | `openMrn` — string — ID; `noteMrn` — string — ID (regex-extracted `SYN-…` token from note text; identifier-shaped by construction, EHR:281) |
| 19 | `ehr_note_filed` | ehr | EHR:297 | `mrn` — string — ID; `name` — string — ID; `type` — enum(4) — UI; `chars` — number — LEN |
| 20 | `ehr_orders_signed` | ehr | EHR:378 | `mrn` — string — ID; `count` — number — UI; `items` — string[] — UI (catalog picks, EHR:16–22); `simulated` — true — CFG |
| 21 | `ehr_command_ack` | ehr | EHR:390 | `commandId` — string — ID; `action` — `"ehr_open_doc"` — UI; `mrn` — string — ID; `ok` — boolean — UI; `reason` — enum {"", "patient_not_found", "document_not_found"} — UI |
| 22 | `nudge_committed` | buddy | ENG:85 | `id` — string — ID; `rule` — enum {R-01,R-04,R-09,R-12} — UI; `mrn` — string — ID; `headline` — string — UI/DS (engine template; may embed DS fields, never note text) |
| 23 | `nudge_acted` | buddy | ENG:295, ENG:881 | `id`, `rule`, `mrn` as #22; `action` — enum (D2a) — UI; `origin` — string — ID |
| 24 | `nudge_dismissed` | buddy | ENG:99 via ENG:369 | `id`, `rule`, `mrn`, `origin` as #23; `reason` — enum {"Not relevant here","Already considered","Not now"} — UI (ENG:426) |
| 25 | `nudge_superseded` | buddy | ENG:99 via ENG:818, 834, 846 | `id`, `rule`, `mrn`, `origin`; `reason` — enum {"chart_switched","chart_closed"} or absent (ENG:846) — UI |
| 26 | `nudg_cmd` | buddy | ENG:307, 321, 324 (with `commandId`); ENG:330 (without) | `action` — `"ehr_open_doc"` — UI; `commandId?` — string — ID; `mrn` — string — ID; `match` — string — UI (always `""` at both construction sites ENG:298, 330); `targetEhrInstanceId?` — string — ID (only ENG:306–307) |
| 27 | `referral_drafted` | buddy | ENG:337 | `mrn` — string — ID; `origin` — string — ID |
| 28 | `referral_simulated_sent` | buddy | ENG:350 | `mrn` — string — ID; `origin` — string — ID |
| 29 | `buddy_variant_changed` | buddy | BUD:242 | `variant` — enum {"dock","cursor"} — UI |
| 30 | `demo_reset` | resetting app or "system" | BUS:71 via `NudgBus.reset` (called EHR:527, SCR:448) | detail = {} |

(29 distinct type strings; `app_loaded` appears with two payload shapes, rows 1–2.)

**D2a (action enum).** `action` ∈ {open_rhythm, show_me, start_referral, simulate_send,
discard_referral, acknowledge} — the values emitted at ENG:295 (all card actions except
`dismiss`/`not_this` → menu only, ENG:290–292; `open_rhythm` and `second_opinion`
excluded at ENG:294) plus `open_rhythm` emitted post-acknowledgment at ENG:881.
`second_opinion` is never emitted on the bus (panel entry is document-local).

**D7 (Provenance classes).** As listed in D2. The privacy argument (§5) is a case
analysis over this column: classes DS, UI, CLK, ID, CFG are functions of the synthetic
dataset, UI state, clock, or random ids — independent of note text; classes DRV, LEN, Q1
depend on free text only through the bounded abstractions of D6/L4.

---

## 3. Bus operational semantics

**D3 (Sanitizer σ).** σ(m) for a detail object m is a shallow copy of m with exactly the
keys `q`, `text`, `note` deleted (BUS:23–31; the deletions are BUS:27, 28, 29 — the exact
key list is {q, text, note}, verified against code; the design intent comment BUS:25–26
agrees). σ(undefined) = {} (BUS:24). σ is idempotent and pointwise: σ(σ(m)) = σ(m).
Scope note (code over comment): σ is applied at **emission** (BUS:44), so it governs the
BroadcastChannel payload and the same-tab fanout too, not only persistence; it is
re-applied to every entry on every log read (BUS:39). Vacuity note: no live emitter in D2
ever passes a `q`, `text`, or `note` key; σ is defense in depth against future emitters.

**D4 (recent_τ).** For a parsed array log L and TTL τ = 4 h (BUS:11),
recent(L) = ⟨σ-mapped e ∈ L : Number.isFinite(Date.parse(e.ts)) ∧ Date.parse(e.ts) ≥ clk − τ⟩
(BUS:33–41). Entries with missing/unparseable ts are evicted (the Number.isFinite guard).

**D5 (Bus operations).** Per document d:
- `emit(app, type, detail)` (BUS:43–55): (1) construct e = ⟨ISO(clk), app, type, σ(detail)⟩
  (BUS:44); (2) best-effort log write: Λ ← last₁₀₀(recent(parse(Λ)) ⧺ ⟨e⟩) (BUS:46–48;
  `slice(-LOG_MAX)` with LOG_MAX = 100, BUS:10), any storage exception swallowed (BUS:49–51);
  (3) `C_d.postMessage(e)` (BUS:52); (4) local fanout: invoke each h ∈ H_d in registration
  order under per-handler try/catch (BUS:15–19, 53). Returns e.
- `on(h)` (BUS:57–59): append h to H_d. No unsubscription primitive exists.
- `history()` (BUS:61–67): last₁₀₀(recent(parse(Λ))); on any exception, ⟨⟩.
- `reset(app)` (BUS:69–75): delete Λ (BUS:70); construct r = ⟨ISO(clk), app∥"system",
  "demo_reset", {}⟩; post + fanout r. **r is not written to Λ** — `demo_reset` never
  appears in `history()` (construction: the only log write is BUS:48, inside `emit`, and
  `reset` does not call `emit`).
- Remote delivery: `C_d.onmessage = m ⇒ fanout(m.data)` (BUS:21).

**INV1 (single bus, single channel, single handler set per document).** Each document
evaluates BUS's IIFE once (script tag order, §0) and assigns `window.NudgBus` once;
BUD:9–10 and ENG:8–9 guard against double-load with `window.__nudgBuddyLoaded` /
`window.__nudgEngineLoaded`. Hence exactly one C_d and one H_d per document, and SF1's
same-document-second-channel caveat is moot.

**T1 (Delivery).** Under INV1, SF1, SF6: an event e emitted in document d is delivered
(i) to every h ∈ H_d exactly once, synchronously, inside the emitting task, in
registration order; and (ii) to every h ∈ H_{d′}, d′ ≠ d same-origin, exactly once,
asynchronously, as one task per receiving document.
*Proof.* (i): BUS:53 calls `fanout(e)` in the same synchronous frame; `fanout` iterates
H_d in array order (BUS:16); per-handler try/catch (BUS:17) confines handler faults, so
every handler is invoked regardless of earlier handlers throwing; SF6 makes the whole
emit-plus-fanout block atomic within d. No other local path invokes handlers with e
(SF1: C_d does not self-deliver, so BUS:21 never fires in d for its own e).
(ii): SF1 delivers exactly one message event per remote channel object; INV1 gives one
channel per document; BUS:21 fans it out to H_{d′} once. ∎

**L1 (Handler registration order).** In each document, registration order is:
BUD handler (BUD:378) at buddy-script parse; ENG handler (ENG:789) at engine-script
parse; the app handler (EHR:489 / SCR:479) **last**, because both `init()` functions are
async and register only after `await fetch("/data/patients.json")` resolves (EHR:447→489;
SCR:455→479), which is after all four scripts have parsed.
*Proof.* Script order §0 + the await point precedes registration in both `init` bodies;
SF6 orders parse-time registrations before any later task. ∎
(No proof in either spec depends on handler order; L1 is recorded so a re-implementation
does not accidentally create an order dependence.)

**L2 (Ordering).** For a fixed emitting document d and receiving document r (r = d or
r ≠ d), events are observed at r in emission order. Across two distinct emitters, no
order is guaranteed.
*Proof.* r = d: synchronous fanout inside each emit (T1.i) and SF6 serialize. r ≠ d: SF3
per-sender FIFO. The negative claim is SF3's caveat. ∎

**Fault model (as coded).** A storage failure (quota, disabled) silently degrades the
log only; live delivery is unaffected (BUS:49–51 comment and control flow agree).
A throwing handler is isolated (BUS:17). A missing BroadcastChannel API degrades to
same-tab-only operation (BUS:12 null guard, BUS:21, 52 conditionals).

---

## 4. The rolling log

**INV2 (Capacity).** Immediately after any `emit` that completes its storage write,
|parse(Λ)| ≤ 100. *Proof.* The only write of Λ is BUS:48, which stores
`log.slice(-100)`. ∎ (LOG_MAX = 100, BUS:10.)

**INV3 (TTL at read).** Every entry returned by `history()` and every entry retained by
an `emit` rewrite has Date.parse(ts) ≥ clk − 4 h at the moment of that read (BUS:34–37;
LOG_TTL_MS = 4·60·60·1000, BUS:11). Eviction is **lazy**: between operations, stored
bytes may age past the TTL; they are dropped at the next read (BUS:46 or BUS:63), never
by a timer. There is no other eviction trigger. `reset` deletes the log wholesale
(BUS:70).

**INV4 (Log sanitized).** Every detail object stored in Λ is a σ-image.
*Proof.* Structural induction over the write history of Λ. Base: Λ absent ⇒ parse
fallback `[]` (BUS:46). Step: the only writer is BUS:48; its input is
recent(parse(Λ)) ⧺ ⟨e⟩ where recent σ-maps every retained old entry (BUS:39) and e's
detail is σ(detail) by construction (BUS:44). σ idempotent ⇒ property preserved. Even an
out-of-band writer that injected raw keys under `nudg_demo_events` is cleansed at the
next emit or read. ∎

**Eviction algorithm, exactly as coded (normative restatement).** On `emit`:
parse (fallback `[]` on absence or parse error) → drop entries with non-finite or
stale ts (< clk − 4 h) → σ-map survivors → append the new event → keep the last 100 →
stringify and store; on storage exception, skip the write entirely. On `history()`:
parse → TTL-filter → σ-map → last 100 (the second `slice(-100)` at BUS:63 is redundant
given INV2 but defensive against out-of-band writes). On `reset`: remove the key.

**Late-join replay.** BUD seeds its activity list from `history()` at load
(BUD:406–409), keeping the last 8 labelable entries (vs. a live cap of 12, BUD:397) and
counting them as already seen (no unseen increment). This is the sole consumer of
`history()`; ENG never replays the log (its state is rebuilt from live events only).

---

## 5. Privacy non-interference

**D6 (Derivation function Δ).** Let Text be the set of strings. Define (SCR:410–416):
- a(t) = 1 iff `/\b(anxiety|anxious|panic)\b/` matches lowercase(t)
- n(t) = 1 iff `/\b(dietitian|nutritionist|nutrition referral|medical nutrition|mnt)\b/`
  matches lowercase(t)
- Δ : Text → {0,1}², Δ(t) = (a(t), n(t)).

The emitted vocabulary is the image under the fixed encoding
imp(1) = ["anxiety"], imp(0) = []; top(1) = ["nutrition_referral"], top(0) = []
(SCR:412–416). **Finite codomain: |range| = 4.** The strings "anxiety" and
"nutrition_referral" are program constants, not substrings extracted from the note.
Input t is the live rendered note `els.noteSections.innerText` (SCR:412), gated on a
rendered patient (SCR:411), debounced 700 ms (SCR:426), and change-triggered: the triple
JSON [mrn, impressions, topics] is emitted only when it differs from the last emitted
triple (`lastSignals` dedup, SCR:417–419). Triggers: note render (SCR:248) and every
`input` on the note (SCR:473).

**INV5 (Privacy non-interference of the fabric).** For every event e ∈ D2 emitted at any
reachable state, and for every field f of e.detail: the value of f is independent of the
raw note text (and of the free-typed assistant question) **except** through the following
bounded abstractions: (i) Δ(t) ∈ {0,1}² for `note_signals.impressions/topics`;
(ii) buffer lengths ℓ for the `chars` fields of `note_copied` (SCR:287; length of the
assembled plaintext including the fixed header, SCR:251–264), `ehr_note_filed` (EHR:297),
`ai_question_asked` (SCR:392); (iii) the single predicate bit `matched` of
`ai_question_asked` (SCR:366–372, 392); (iv) the regex-extracted MRN token `noteMrn` of
`ehr_note_mismatch_blocked` (EHR:281–289), which is `SYN-[A-Z0-9-]+`-shaped by the
extraction regex. In particular no field ever carries the note text or any free
substring of it. Additionally (INV4) the persisted log stores only σ-images, and σ
strips the designated free-text carrier keys {q, text, note} from every broadcast and
persisted payload (D3).

**T2 (INV5 holds).** *Proof by structural induction over the emission-site table D2*
(the table is exhaustive by construction: it was produced by enumerating every
`NudgBus.emit`/`NudgBus.reset` call in the five sources; sites: SCR:94, 127, 139, 167,
179, 206, 287, 289, 300, 391, 420, 482, 448; EHR:141, 153, 164, 258, 289, 297, 378, 390,
505, 527; ENG:85, 99, 295, 307, 321, 324, 330, 337, 350, 881; BUD:242; BUS:71).
Induction is over the finite set of sites; for each site, case-inspect each constructed
field:
- Classes ID/DS/UI/CLK/CFG (D7): each such field is assigned from the static dataset
  (`patients.json` via `DATA`/`byMrn`), from enumerated UI state (tab names EHR:164,
  catalog items EHR:16–22, action ids ENG:D2a, reasons ENG:426, variant BUD:242), from
  the clock (SCR:179 seconds), or from generated ids (`crypto.randomUUID`, ENG:26,
  EHR:5). None of these reads the note buffer or question buffer. Verified per site: the
  argument expressions at each cited line reference only `p`/`current`/`selected`
  dataset records, counters, enums, and ids — never `noteSections`, `noteText`, or
  `askInput` contents.
- Class DRV: only site SCR:420–422; fields are the D6 encodings; dependence factors
  through Δ with |range(Δ)| = 4. Restating INV5 at its use site: the invariant permits
  exactly this dependence.
- Class LEN: SCR:287 (`text.length` of the copied plaintext), EHR:297 (`text.length` of
  the filed note), SCR:392 (`q.length` — wait, the field is `chars: q.length`; verified
  at SCR:392 the value is the question length). Dependence is the length function ℓ only.
- Class Q1: SCR:392 `matched` = ∃ key ∈ patient.qa[].keys : lowercase(q) contains key
  (SCR:363–368) — one bit per ask event.
- EHR:289: `noteMrn` is the first capture of `/^MRN:\s*(SYN-[A-Z0-9-]+)\s*$/im` applied
  to the pasted note (EHR:281), uppercased — an identifier-shaped token; the surrounding
  note text is not emitted. This is the tightest point of INV5: a note author could
  deliberately encode data in a fake MRN token; the flow is bounded by the regex
  character class and emitted only on the mismatch path. Flagged as a boundary case, not
  a violation of the letter of INV5 (which excepts it under (iv)).
- ENG sites: card `headline` (ENG:85) is one of the fixed templates ENG:114, 143, 177,
  212, 231, interpolating only dataset fields (`p.name`, `doc.type`, `depthPack`
  strings); `why` strings are not emitted on the bus (they live in the card object
  only). All other ENG-site fields are ids/enums.
- BUS:71: detail = {} — nothing.
No site passes keys `q`, `text`, or `note`; σ (D3) would delete them if one did; by INV4
the log inherits the property. ∎

**L4 (Information-flow bound).** Per emitted event, the information about the note text
(resp. question text) carried by the fabric is bounded by:
- `note_signals`: ≤ 2 bits (Δ), and by the change-trigger (SCR:417–419) a run of k
  consecutive emissions for one mrn conveys ≤ 2 + (k−1)·log₂3 bits of Δ-trajectory
  (from a given Δ-value, at most 3 successor values differ), plus emission timing;
- `note_copied` / `ehr_note_filed`: ⌈log₂ L_max⌉ bits each (length only);
- `ai_question_asked`: ⌈log₂ L_max⌉ + 1 bits (length + matched);
- every other event: 0 bits.
*Proof.* Immediate from T2's case analysis: the only text-dependent field values factor
through Δ, ℓ, or the matched predicate, whose ranges have the stated cardinalities. ∎

**Boundary — what INV5 does NOT cover (explicit).**
1. **Identifiers.** `mrn` and patient `name` ride in cleartext in nearly every event and
   persist ≤ 4 h in Λ (INV3). In this system they index a synthetic dataset; in a real
   deployment they are PHI-adjacent linkage keys. INV5 says nothing about them.
2. **Timing side channels.** Emission times (ts field, 700 ms debounce granularity)
   reveal typing/navigation cadence; T1/L2 deliver them origin-wide.
3. **Lengths.** The `chars` fields are a deliberate leak of buffer length (L4).
4. **Non-bus storage.** Full note text exists outside the fabric: the EHR keeps filed
   notes and drafts in per-tab `sessionStorage` (`ehr_notes_*`, `ehr_draft_*`,
   EHR:34–39, 261, 294–296); the scribe keeps draft HTML in memory (SCR:34, 100) and
   writes full plaintext to the system clipboard on user copy (SCR:273). These are
   outside the bus and outside INV5.
5. **Origin trust.** Any same-origin script can subscribe (BUS:57) and read Λ (SF4).
   INV5 is non-interference of the *transported payloads*, not access control.
6. **Relay disclosure (engine, user-initiated).** The second-opinion lanes POST
   dataset-derived chart facts and the dataset-authored question to the loopback relay
   `127.0.0.1:4809` (ENG:21, 676, 736, 751–767) — dataset content, not note text; scoped
   fully in the Rule-Engine spec's safety theorem.

---

## 6. Cross-tab surface ownership

### 6.1 Named-context reachability

**T3 (Reachability).** Let d_S be the scribe document. (i) If a navigable named
`nudg-ehr` exists in d_S's browsing context group (e.g., one previously created by
`window.open` from d_S and since navigated to `/ehr/`), then `window.open("", "nudg-ehr")`
from d_S returns its WindowProxy without navigating it. (ii) If the user independently
opened `/ehr/` in a fresh tab, that navigable is in a different browsing context group;
the same call cannot return it and instead creates a new blank auxiliary navigable named
`nudg-ehr` in d_S's group — even though the independent tab has set
`window.name = "nudg-ehr"` (EHR:443), because SF7 scopes lookup to the group.
*Proof.* (i): SF7 resolution + SF8 non-navigating empty-URL probe + SF12 (the name
survives the earlier staged navigation). (ii): SF7's creation clause; the independent
tab's self-naming is only visible to lookups within *its* group. ∎

**C1 (Create-or-adopt protocol).** `openEhrTarget()` (ENG:248–262) returns exactly one of:
- `{handle, existing: true, needsNavigation: false, instanceId}` — **adopt**: the probe
  found a same-origin window on path `/ehr/…` (ENG:256) with `__nudgEhrReady === true`
  (ENG:257, SF9) and a string `__nudgEhrInstanceId` (ENG:258);
- `{handle, existing: false, needsNavigation: true, instanceId: null}` — **create or
  reclaim**: a fresh `about:blank` auxiliary, or an existing named context that is
  off-path or cross-origin (SF9 throw caught at ENG:259 leaves `onEhrPath = false`;
  comment ENG:259 "reclaim it below" matches the caller's ENG:314 navigation);
- `{handle, existing: false, needsNavigation: false, instanceId: null}` — on-path but
  not ready (loading, or pre-handshake);
- `null` — popup blocked or `window.open` threw (ENG:251, 261).
*Proof.* Case-exhaustive over the three booleans computed at ENG:255–259 and the null
guards; `existing = ready` and `needsNavigation = ¬onEhrPath` by ENG:260. ∎
The probe runs inside the click gesture (comment ENG:245–246) so popup blocking is the
exception, not the rule.

### 6.2 The readiness handshake

**D10 (Handshake).** The EHR document publishes, in order: `window.name = "nudg-ehr"`
(EHR:443), `window.__nudgEhrInstanceId = EHR_INSTANCE_ID` (EHR:444, id minted at EHR:5),
… (data load, UI wiring, bus subscription EHR:489–496) …, and **last**
`window.__nudgEhrReady = true` (EHR:497), immediately before consuming any staged
command (EHR:498). Consequence (SF6): `existing = true` in C1 implies the EHR's
`nudg_cmd` bus listener (EHR:491–495) is already installed — ready-implies-listening.
The probe's `instanceId` enables **unicast over broadcast**: a live command stamps
`targetEhrInstanceId` (ENG:306–307) and every EHR instance drops commands stamped for
someone else (EHR:492).

### 6.3 The staged-command protocol

**D9 (Staged command).** Key `nudg_pending_ehr_command` (ENG:22, EHR:4). Record:
`{action: "ehr_open_doc", commandId, mrn, match, expiresAt}` where
`expiresAt = clk + 15000` (ENG:267, 269). Producer: `queueEhrCommand(cmd, card,
{persist})` (ENG:264–287): persist = true stores the record; persist = false **removes**
any stored record (ENG:270–272). Always sets in-memory
`pendingHandoff = {commandId, cardId, card, expiresAt}` and two timers:
`handoffTimer` 3500 ms — "not confirmed" toast if the handoff is still pending
(ENG:273–276); `commandCleanupTimer` 15100 ms — removes the stored record if it still
bears this commandId, then clears `pendingHandoff` (ENG:277–286).
Consumers, two disjoint paths:
- **Load-time**: `consumePendingEhrCommand()` (EHR:429–439), called once at EHR:498:
  `getItem` then `removeItem` back-to-back (EHR:432–433), then validate
  (non-null ∧ action = "ehr_open_doc" ∧ Number.isFinite(expiresAt) ∧ expiresAt ≥ clk,
  EHR:437) and execute `openDocFromBuddy` (EHR:438).
- **Live**: bus listener (EHR:491–495): on `nudg_cmd` with matching action, drop if
  stamped for another instance (EHR:492), else **remove the staged record first**
  (EHR:493 — prevents a later-loading EHR from re-consuming a command a live EHR is
  already executing) and execute.

**Dispatch decision tree (ENG:297–328, `open_rhythm`; the only staged-command producer).**
1. Engine hosted in the EHR document itself: bare `nudg_cmd` broadcast (ENG:324), no
   staging, no targeting.
2. Probe adopts a ready EHR: `queueEhrCommand(…, {persist: false})` (ENG:305) — no
   shared record exists at all (comment ENG:303–304: "without exposing a shared pending
   record that an unrelated EHR tab could consume"); stamp `targetEhrInstanceId`
   (ENG:306); broadcast (ENG:307); `handle.focus()` (ENG:308).
3. Probe returns a claimable handle: persist (ENG:313), navigate iff `needsNavigation`
   (`handle.location = "/ehr/"`, ENG:314 — navigate **only that handle**, comment
   ENG:311–312), focus (ENG:315).
4. Probe null (popup blocked): persist **and** broadcast untargeted (ENG:319–321) so
   either an already-open listener or the next EHR load can serve it; report that focus
   failed (ENG:326–328).
The `show_me` action (R-04) broadcasts `nudg_cmd` without commandId and without staging
(ENG:330) — fire-and-forget, no acknowledgment; see Rule-Engine spec DX-06.

**Acknowledgment.** The EHR acks every commandId-bearing command (EHR:388–391:
`ehr_command_ack {commandId, action, mrn, ok, reason}`; success EHR:409, failure
EHR:394, 402). The scribe-side engine consumes acks (ENG:866–888): match on app/state
/commandId (ENG:867); a **late** ack (clk > expiresAt, ENG:868) clears everything and
keeps the card ("confirmed too late", ENG:869–874); a timely ok = true ack emits the
deferred `nudge_acted` (ENG:881), removes the card (ENG:882), toasts; ok = false keeps
the card for retry (ENG:885). Either way `pendingHandoff` is cleared (ENG:875, 887).

### 6.4 At-most-once execution

**T4 (At-most-once under serialized consumption).** Fix one staged record c (one
commandId). If all consuming code that can observe c runs on a single event loop
(one agent), then c is executed at most once.
*Proof.* Restating SF6 in full at its use site: within one agent, each task runs to
completion before any other task of that agent runs. Both consumption paths are
straight-line synchronous within one task: load-time does getItem; removeItem;
validate; execute (EHR:432–438), and the live path does removeItem; execute
(EHR:493–494). Under SF6 these tasks serialize. The first task to run removes the key
(EHR:433 or EHR:493) before any other task can read it; every later task's getItem
returns null (load path bails at EHR:437's null check) or acts on the live broadcast
without touching c. The producer's cleanup timer (ENG:277–286) only ever removes,
never re-creates, c. Hence at most one execution derived from c. ∎
Scope note: two same-group, same-process EHR documents share serialization in practice;
T4 is stated agent-wise because that is what SF6 licenses.

**L5 (Residual TOCTOU race — negative result, exhibited).** If two EHR documents
initialize concurrently on **distinct processes** (e.g., a companion-created tab and an
independently user-created tab — distinct browsing context groups per SF7, hence
typically distinct processes), c can be executed twice.
*Exhibit.* Restating SF4 in full at its use site: localStorage provides no atomicity
across agents; interleavings of getItem/removeItem from different processes are
permitted. Interleaving table (both tabs loading `/ehr/`, c fresh, TTL not expired):

| t | Tab A (process 1) | Tab B (process 2) | key state |
|---|---|---|---|
| 1 | EHR:432 getItem → c | — | present |
| 2 | — | EHR:432 getItem → c | present |
| 3 | EHR:433 removeItem | — | absent |
| 4 | — | EHR:433 removeItem (no-op) | absent |
| 5 | EHR:437 valid → EHR:438 execute | — | absent |
| 6 | — | EHR:437 valid → EHR:438 execute | absent |

Both execute: two charts open, two acks race; the scribe accepts the first matching ack
and clears `pendingHandoff` (ENG:887), the second is dropped at ENG:867's
`!pendingHandoff` guard. This is a **known limitation**, accepted as such. ∎

**Mitigations, as coded.** (1) **Single-owner discipline**: when a ready owner exists,
the command is never staged at all (persist = false path, ENG:303–305) and is unicast by
instance id (ENG:306, EHR:492) — the race presupposes staging, which occurs only when no
ready owner was found inside the gesture. (2) The live listener clears the staged copy
before executing (EHR:493), closing the broadcast-plus-stage double-serve in the
popup-blocked path for all serialized observers (T4). (3) **Time bound**: the record is
self-expiring — consumers reject after expiresAt (EHR:437), the producer deletes it at
15.1 s (ENG:277–286), and a late ack is refused (ENG:868). Hence the vulnerability
window for L5 is ≤ 15 s from staging (≤ 15.1 s for record residency with a live
producer; exactly the consumer-side 15 000 ms bound if the producer died).

**L6 (TTL bound).** No execution of a staged record occurs later than 15 000 ms after
its staging, regardless of producer liveness.
*Proof.* The only executions are EHR:438 (guarded by `expiresAt < Date.now() ⇒ return`,
EHR:437, with expiresAt = staging clk + 15000, ENG:267) and EHR:494 (live path — not an
execution *of the stored record* but of the broadcast; the broadcast is synchronous with
staging). Clock skew caveat: expiresAt is minted on the scribe document's clock and
compared on the EHR document's clock; same machine, so skew ≈ 0, but a re-implementation
across machines must not reuse this design. ∎

### 6.5 Post-command UI signaling (spotlight)

`openDocFromBuddy` (EHR:387–411): open chart (emits #14), programmatic `setTab("notes")`
(emits #16 with user = false — provenance flag per EHR:161–163), then after 60 ms
(EHR:397; SF11 caveat) pick the first row containing `match` else the first row
(EHR:398–399; match = "" always, D2 #26 ⇒ first row), synthesize `row.click()` — which
fires the row's open handler and thus emits #17 `ehr_document_opened` (EHR:404 → 258) —
scroll into view, spotlight row and read-box, ack. `spotlightOnArrival` (EHR:415–427):
if `document.hidden`, defer the 6 s glow (EHR:418) until the first `visibilitychange` to
visible (SF10; design comment EHR:413–414: the glow must not expire before the user
arrives).

### 6.6 Surface-ownership summary

Ownership of the "one EHR surface" is established per-gesture, never assumed: probe
(C1) → adopt-and-unicast, claim-and-stage, or stage-and-broadcast → acknowledge or
time out (§6.3) → at-most-once per T4 with the L5 caveat bounded by L6. The named
context is the *rendezvous*; localStorage is the *mailbox*; the bus is the *wire*; the
instance id is the *addressee*; expiresAt is the *stamp date*.

---

## 7. UI-signaling consumers (buddy surface)

The buddy (BUD) is a pure consumer plus one emitter (#29). Formal obligations a
re-implementation must preserve:

**D11 (Label function).** labelFor: events → strings ∪ {⊥}; defined for exactly the 23
types keyed in BUD:32–53 (a strict subset of Σ: `note_signals`, `nudg_cmd`,
`app_loaded`, `ehr_command_ack`, `referral_drafted`, `referral_simulated_sent`,
`buddy_variant_changed`, `demo_reset` are unlabeled ⇒ silent), else ⊥; a throwing label
evaluates to ⊥ (BUD:58). Only labeled events enter the activity list ("specific-or-
silent", BUD:31); list capped at the last 12 (BUD:397); seeded from history's last 8
labelable (BUD:406–409).

**D12 (Badge function).** With n = nudgeCount (set only by the engine via
`setNudgeCount`, BUD:433 — the count of cards for the active patient), u = unseen
(labeled events that arrived while the popover was closed, BUD:400), the badge shows:
text "99+" if n > 99, else String(n) if n > 0, else "" (BUD:110); hidden iff
n = 0 ∧ u = 0 (BUD:111); dot-styled iff n = 0 ∧ u > 0 (BUD:112). Comment BUD:107 states
the invariant: numeric urgency is reserved for nudges; mere activity earns a dot.
Opening the popover zeroes u (BUD:203).

**D13 (Popover placement).** With anchor rect r, W = offsetWidth ∥ 304, H = offsetHeight
∥ 340: left = clamp(r.left − W + r.width, 12, innerWidth − W − 12); top = (r.top − H − 12)
if > 12 else r.bottom + 12, then clamped into [12, innerHeight − H − 12]
(BUD:173–182) — prefer above, never off-screen. A ResizeObserver re-clamps upward when
content growth pushes the bottom edge past innerHeight − 12 (BUD:186–198).

**D14 (Variant sync).** Variants {dock, cursor}; toggled by Shift+B outside editable
targets (BUD:245–252), by the footer button (BUD:261), or by a remote
`buddy_variant_changed` (BUD:390–393) applied with {silent: true}. Echo-termination:
`setVariant` no-ops on equal value (BUD:236) and emits only when ¬silent (BUD:240–243),
so a remote application never re-broadcasts — the sync converges in one hop.

**D15 (Reset propagation).** `demo_reset` clears the buddy surface (BUD:379–389) and, in
each app document, the app's local state with broadcast = false (EHR:490, SCR:480 —
preventing reset storms); the initiating app called `NudgBus.reset` exactly once
(EHR:527, SCR:448).

---

## 8. Worked trace TR1 — one emission, two documents

Setup: d_S (scribe, engine active, Okafor selected), d_E (EHR, idle). User types
"…likely anxiety…" in the note. τ₀ is the debounce expiry. Columns show the fabric only
(engine reactions are the Rule-Engine spec's TR-R01).

| t | site | action | Λ (log) | H_{d_S} sees | H_{d_E} sees |
|---|---|---|---|---|---|
| τ₀ | SCR:426→410 | Δ(text) = (1,0); triple differs from lastSignals | — | — | — |
| τ₀ | SCR:420 → BUS:44 | e₉ = ⟨ts,"scribe","note_signals",{mrn,name,["anxiety"],[]}⟩; σ strips nothing (no q/text/note keys) | recent(Λ) ⧺ e₉, last 100 (BUS:46–48) | — | — |
| τ₀ | BUS:52 | postMessage(e₉) | unchanged | — | queued (SF1) |
| τ₀ | BUS:53 | fanout | unchanged | BUD (BUD:394: labelFor = ⊥ ⇒ silent), ENG (ENG:792: R-01 path), app handler (no case) — in L1 order, same task (T1.i) | — |
| τ₀+ε | EHR BUS:21 | message task | unchanged | — | BUD (silent), ENG (ENG:792: stores signals; APP="ehr" ⇒ no evalR01), app handler (no case) |

INV2/INV3/INV4 hold at the write (≤ 100 entries, TTL-filtered, σ-mapped); INV5 holds at
the emission (fields: ID, ID, DRV, DRV — restating INV5: the only note-text dependence
is through Δ, here (1,0), 2 bits).

## 9. Worked trace TR2 — cold-EHR handoff (staged command)

Setup: scribe shows R-01 card; **no** EHR tab exists. User clicks "Open the rhythm note".

| t | site | action | key `nudg_pending_ehr_command` | named context `nudg-ehr` |
|---|---|---|---|---|
| 0 | ENG:298 | mint c = {action, commandId: "I:t", mrn, match: ""} | absent | none |
| 0 | ENG:250 (C1) | probe: window.open("", "nudg-ehr") ⇒ new about:blank (SF7 creation, SF8) | absent | blank, in d_S's group |
| 0 | ENG:255–260 | onEhrPath = false ⇒ {existing: false, needsNavigation: true} | absent | blank |
| 0 | ENG:313 (D9) | queueEhrCommand persist: c′ = c ∪ {expiresAt: t₀+15000}; timers 3500/15100 armed | **c′** | blank |
| 0 | ENG:314–315 | handle.location = "/ehr/"; focus | c′ | navigating |
| 0 | ENG:326 | toast "Opening the rhythm note…" | c′ | navigating |
| ~t₁ | EHR:443–444 | window.name kept (SF12); instance id published | c′ | loading |
| t₁ | EHR:497 | __nudgEhrReady = true (D10: listener EHR:491 already installed) | c′ | ready |
| t₁ | EHR:432–433 | getItem → c′; removeItem (one task, SF6) | **absent** | ready |
| t₁ | EHR:437–438 | expiresAt ≥ clk ⇒ openDocFromBuddy(c′) → emits #14, #16(user=false), #17; spotlight §6.5 | absent | showing note |
| t₁ | EHR:390 (via EHR:409) | emit #21 ack {commandId, ok: true} | absent | — |
| t₁+ε | ENG:866–888 | scribe: timely ack, ok ⇒ emit #23 nudge_acted (ENG:881), remove card, toast, clear pendingHandoff | absent | — |
| t₀+15.1 s | ENG:277–286 | cleanup timer: key already absent, pendingHandoff already null ⇒ no-op | absent | — |

At-most-once: T4 applies (single consuming agent). Had the ack arrived after
t₀ + 15 000 ms: ENG:868 branch — key removed, pendingHandoff cleared, card retained,
"confirmed too late" toast (ENG:873). Had `window.open` returned null (popup blocker):
dispatch case 4 — c′ staged **and** broadcast (ENG:319–321); a live EHR would execute via
EHR:493–494 (removing c′ first); with none, the next `/ehr/` load within 15 s consumes c′.

---

## 10. Obligations index

| Item | Statement (short) | Status |
|---|---|---|
| SF1–SF12 | platform facts §1 | SPEC-FACT (SF3, SF7, SF11 carry TO-VERIFY nuances) |
| D1–D15 | records, alphabet, σ, Δ, protocols, UI functions | defined |
| INV1 | one bus/channel/handler-set per document | proved in situ |
| INV2 | log ≤ 100 entries after write | proved |
| INV3 | TTL 4 h enforced at every read; lazy eviction | proved by construction |
| INV4 | log stores σ-images only | proved (induction) |
| INV5 | privacy non-interference | T2 proved (structural induction over D2) |
| INV6 | staged record self-expires at 15 s | proved as L6 |
| T1, L1, L2 | delivery, registration order, ordering | proved |
| L3 | (folded into INV2–INV4 eviction argument) | — |
| T2, L4 | privacy + bit bound | proved |
| T3, C1 | named-context reachability; create-or-adopt | proved from SF7/SF8/SF9/SF12 |
| T4 | at-most-once (serialized agents) | proved from SF4/SF6 |
| L5 | TOCTOU across processes | exhibited (accepted limitation) |
| L6 | 15 s bound | proved (same-machine clock caveat) |

End of Event-Fabric specification. The Rule-Engine specification
(`agentB_spec_rule_engine.md`) consumes D1–D2, INV5, T1–T4, and C1 by reference and
restates each invariant in full where used.
