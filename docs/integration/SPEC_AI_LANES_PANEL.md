# Formal Specification — AI Provenance Lanes, Receipts, Cancellation, and Panel Aggregation

Specification 1 of 2. Extracted from source on 2026-07-18 for re-implementation inside a
production host-API application with an the gateway provider registry and a a policy firewall.
Code and data files are ground truth; documentation files are intent. Every behavioral claim
carries a `file:line` citation into the sources below. Numbered items: definitions D*n*,
invariants INV*n*, lemmas L*n*, theorems T*n*, non-guarantees N*n*, boundaries B*n*,
findings F*n*, worked examples W*n*. Every lemma and theorem is proved or marked CONJECTURE.

## 0. Sources and citation convention

| Short cite | Absolute path |
|---|---|
| `relay.py` | `/Users/pablo/Desktop/Summer 2026/nudg-md/server/relay.py` |
| `nudges.js` | `/Users/pablo/Desktop/Summer 2026/nudg-md/shared/nudges.js` |
| `buddy.js` | `/Users/pablo/Desktop/Summer 2026/nudg-md/shared/buddy.js` |
| `bus.js` | `/Users/pablo/Desktop/Summer 2026/nudg-md/shared/bus.js` |
| `patients.json` | `/Users/pablo/Desktop/Summer 2026/nudg-md/data/patients.json` |
| `JUDGE_QA.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/JUDGE_QA.md` |
| `ROI_MODEL.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/ROI_MODEL.md` |
| `DESIGN.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/design/NUDGE_CARDS_DESIGN.md` |
| `README.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/README.md` |

F1 (source attribution, recorded before use). The commissioning brief attributes lane-chip
rendering, latency receipts, replace-in-place, and the cancel path to `buddy.js`. In source,
all four live in `nudges.js` (chips and labels `nudges.js:539-545,653-660,690-719`; receipts
`nudges.js:678,739`; replace-in-place `nudges.js:670-681,728-742`; cancellation
`nudges.js:563-591,600-607,783-786`). `buddy.js` contains zero relay references and zero
`fetch` calls; its contribution to cancellation is indirect: it closes the popover and
dispatches the DOM event `nudg:buddy-closed` (`buddy.js:221`), which `nudges.js:783-786`
converts into cancellation. All statements below cite the true locations.

## 1. Preliminaries

D1 (relay). A localhost HTTP server bound to host `127.0.0.1`, port `4809` by default
(`relay.py:37-38`), stdlib-only, exposing `GET /api/health`, `POST /api/quick`,
`POST /api/panel`, `POST /api/cancel` (`relay.py:14-18,619-664`). POST requests require
`Origin ∈ {http://localhost:4800, http://127.0.0.1:4800}` and
`Content-Type: application/json` (`relay.py:39,595-601,638`); body size ≤ 262,144 bytes
(`relay.py:49,584-585`).

D2 (lanes). Two request lanes:
- **quick**: single grounded answer; server-side fallback ladder Anthropic Messages API
  ("claude") → local `codex` CLI → scripted signal (`relay.py:334-391`).
- **panel**: 2–4 isolated reviewer subprocesses via the `codex` CLI, else scripted signal
  (`relay.py:449-540`; seat count bounds `MIN_SEATS = 2`, `MAX_SEATS = 4`, `relay.py:50-51,458-460`).

D3 (served-mode set). M = {`live-claude`, `live-codex`, `scripted`}. The relay's response
field `mode` and receipt field `served_mode` take values only in M: returns at
`relay.py:361` (`live-claude`), `relay.py:379` (`live-codex`), `relay.py:391` (`scripted`,
quick), `relay.py:473,525` (`scripted`, panel), `relay.py:540` (`live-codex`, panel).

D4 (chip label map Λ). The client label table (`nudges.js:539-545`):

| key k | class π(k) | exact label text |
|---|---|---|
| `live-claude` | LIVE | `LIVE: CLAUDE (ANTHROPIC API)` |
| `live-codex` | LIVE | `LIVE: GPT VIA CODEX CLI` |
| `scripted-quick` | SCRIPTED | `SCRIPTED: QUICK LANE UNAVAILABLE` |
| `scripted-panel` | SCRIPTED | `SCRIPTED: PANEL LANE UNAVAILABLE` |
| `scripted-pending` | SCRIPTED | `SCRIPTED · LIVE LANE DELIBERATING…` |

Λ is applied with a fail-closed default: `LANE_LABEL[mode] || LANE_LABEL["scripted-quick"]`
(`nudges.js:656`) and `LANE_LABEL[mode] || LANE_LABEL["scripted-panel"]` (`nudges.js:700`).

D5 (provenance class π). π maps a rendered chip to {SCRIPTED, LIVE} per D4's second column,
with order SCRIPTED < LIVE. A DOM state with no mode chip (initial spinners
`nudges.js:628,631`; torn-down panel `nudges.js:606`) is assigned π = SCRIPTED by convention
(no live claim is displayed).

D6 (receipt). The relay attaches to every lane response a receipt object initialized as
`{requested_lane, ts}` (`relay.py:348,466`; `ts` is ISO-8601 UTC seconds, `relay.py:87-88`)
and extended before return with `served_mode`, `latency_ms`, optionally `model`
(live only: `relay.py:356-360,372-376,535-539`), optionally `note` (lane fall-through
disclosure: `relay.py:377-378,389-390`), optionally `failed_seats` (panel scripted
downgrade only: `relay.py:522`).

D7 (client run). A pair `{runId, controller}` where `runId` is a UUID (or timestamp-random
fallback) and `controller` an `AbortController` (`nudges.js:567-574`). The module-level slot
`activeRelay` holds at most one run (`nudges.js:565`). Server-side, `runId` must match
`^[A-Za-z0-9._-]{8,100}$` (`relay.py:53,118-122`) and is registered in a mutex-guarded map
`RUN_CANCELS: runId → threading.Event` (`relay.py:54-55,125-131`).

D8 (user gesture). A DOM `click` or `keydown` event delivered by the browser to a handler
installed by the system. Handlers relevant here: card-button click (`nudges.js:458-465`),
peek-button click (`nudges.js:478-492`), panel-navigation click (`nudges.js:769-774`),
panel-tablist keydown (`nudges.js:775-782`), popover-close interactions
(`buddy.js:223-227,245-260,301-315,365`).

## 2. Relay lane algorithms

### 2.1 Quick lane (server)

Algorithm (`relay.py:334-391`), after input validation (`question` nonempty string,
≤ 2000 chars `relay.py:52,335-339`; `patient` object; `context` list `relay.py:340-345`):

1. `started ← time.monotonic()` (`relay.py:347`); receipt ← `{requested_lane:"quick", ts}`.
2. If `claude_ready()` — defined as `bool(os.environ.get("ANTHROPIC_API_KEY"))`
   (`relay.py:91-92`) — call the Anthropic Messages API (`relay.py:151-204`) with model
   `NUDG_QUICK_MODEL` default `claude-sonnet-5` (`relay.py:43`), `max_tokens` 500
   (`relay.py:44`), system prompt `relay.py:61-68`, network timeout 60 s (`relay.py:45,183`).
   Validate the reply against D9-Q; on success return
   `{mode:"live-claude", text, receipt}` (`relay.py:353-361`). On `RelayError` with
   status ≠ 499, append a note and fall through (`relay.py:362-365`); status 499 re-raises.
3. If `codex_ready()` (`relay.py:95-110`): run one CLI call (`relay.py:239-301`), validate
   against D9-Q, return `{mode:"live-codex", text, receipt}` (`relay.py:367-379`); 499
   re-raises (`relay.py:380-382`).
4. Else return `{mode:"scripted", receipt}` — **no text field** (`relay.py:385-391`).

D9-Q (quick format contract). `valid_quick_reply(text)` ⇔ text is a nonempty string, total
word count ≤ 120 (`stripped.split()`, `relay.py:326`), and its last nonblank line starts
with `"Basis: "` followed by nonempty content (`relay.py:320-331`). A live reply failing
D9-Q is converted to a lane failure (`relay.py:354-355,370-371`), i.e., contract violation
⇒ downgrade, never repair.

### 2.2 Panel lane (server)

Algorithm (`relay.py:449-540`): validate question/patient/seats (2 ≤ |seats| ≤ 4, each an
object; `relay.py:458-463`). If ¬`codex_ready()`: return `{mode:"scripted", receipt}`
(`relay.py:468-473`). Else spawn one thread per seat (`relay.py:496-503`), each running an
isolated `codex exec` subprocess with prompt `seat_prompt(lens, patient, question)`
(`relay.py:397-409`); the client supplies `lens` = seat **name** (`nudges.js:638`,
`{id, name, lens: s.name}`). Threads are joined with timeout `CODEX_TIMEOUT_S + 10` = 130 s
(`relay.py:48,503`); an unjoined worker yields an invalid placeholder seat
(`relay.py:506-516`).

D9-P (seat validity). `parse_seat_reply(raw)` accepts iff raw parses as JSON with key set
exactly `{stance, rationale, requests}` (`relay.py:416`), `stance ∈ {support, oppose,
insufficient}` (`relay.py:423`), rationale a nonempty string, ≤ 400 chars and ≤ 40 words
(`relay.py:426-428`), requests a string ≤ 400 chars (`relay.py:429`), and the biconditional
(`stance = insufficient` ⇒ requests nonempty) ∧ (`stance ∈ {support, oppose}` ⇒ requests
empty) (`relay.py:430-433`). Invalid replies map to the placeholder
`{stance:"insufficient", rationale:<diagnostic>, requests:"", _valid:false}`
(`relay.py:441-446,482-488,508-516`).

INV-P (all-or-nothing seat validity). If any seat record has `_valid = false`, the entire
panel run returns `{mode:"scripted", receipt}` with `failed_seats` = the invalid count
(`relay.py:518-525`); live seat sets displayed to a user therefore contain only D9-P-valid
records. (Restated and used in §8 as the domain condition of L6.)

If all seats are valid, the relay returns `{mode:"live-codex", seats, aggregate, receipt}`
(`relay.py:527-540`) where `aggregate = {support: |{r : r.stance = "support"}|,
total: |seats|, requests_data: |{r : r.requests.strip() ≠ ""}|}` (`relay.py:530-534`).

### 2.3 Response shapes

| endpoint | outcome | payload |
|---|---|---|
| `/api/quick` | live | `{mode ∈ {live-claude, live-codex}, text, receipt}` (`relay.py:361,379`) |
| `/api/quick` | scripted | `{mode:"scripted", receipt}` — no text (`relay.py:391`) |
| `/api/panel` | live | `{mode:"live-codex", seats, aggregate, receipt}` (`relay.py:540`) |
| `/api/panel` | scripted | `{mode:"scripted", receipt}` — no seats (`relay.py:473,525`) |
| `/api/cancel` | always | `{cancelled: bool, runId}` (`relay.py:658`) |
| error | any | `{error: message}` with mapped HTTP status (`relay.py:665-668`) |

Consequence (used by T1): scripted responses carry no substitutable content; scripted text
and scripted seats originate exclusively client-side, from `patients.json` via the card
(`nudges.js:666,725`; Holloway scripted content `patients.json:31,33,34-62,63-68`).

### 2.4 Health endpoint

D10 (health). `GET /api/health` → 200
`{ok:true, lanes:{claude ∈ {"ready","no-key"}, codex ∈ {"ready","unavailable"}},
instance, ts}` (`relay.py:619-632`). Semantics:
- `claude = "ready"` ⇔ the environment variable `ANTHROPIC_API_KEY` is nonempty
  (`relay.py:91-92`). **Presence, not validity**: no probe request is made.
- `codex = "ready"` ⇔ a `codex` binary is on PATH ∧ `codex login status` exits 0 within 5 s
  ∧ its combined output contains `"logged in"` ∧ does not contain `"not logged in"`
  (`relay.py:95-110`).

F4 (semantic caveat, health). A revoked or malformed key still yields `claude:"ready"`;
the failure surfaces only on first use, as a labeled scripted fallback (see T1). A gateway
re-implementation must document its health endpoint identically as *capability presence,
not credential validity* (§10 R8).

Remark (origin asymmetry). `do_GET` performs no origin check (`relay.py:619-634`); origin
and content-type gates apply to POST only (`relay.py:636-638`). `POST /api/health` → 405
(`relay.py:659-661`). Disclosure through unchecked GET is limited to the two lane booleans,
`instance`, and `ts`.

Client health usage: `lanes()` caches the probe for 60 s (`nudges.js:641-651`), applies a
1500 ms timeout (`nudges.js:645`), and on any error records both lanes false
(`nudges.js:647-649`) — a pessimistic default whose direction agrees with INV2 (failure ⇒
SCRIPTED-class labels).

## 3. Client lane lifecycle as a labeled transition system

D11 (state space). Per panel view (quick | panel), the chip state is one of:
- `S_INIT` — spinner, no mode chip (`nudges.js:628` "Asking for a quick take…";
  `nudges.js:631` "Convening the seats…"); π = SCRIPTED by D5 convention.
- `S_PEND` — chip `scripted-pending`, scripted content painted (`nudges.js:672,730`).
- `S_UNAVAIL` — chip `scripted-quick` | `scripted-panel` (`nudges.js:672,680,684,730,741,745`).
- `S_LIVE(m)`, m ∈ {live-claude, live-codex} — chip Λ(m), live payload painted
  (`nudges.js:678,738`).
- `S_GONE` — panel exited; container repainted with cards (`nudges.js:606`).

D12 (freshness guard). Each lane run captures `myRun = panelRun` at entry
(`nudges.js:663,722`); `panelRun` increments on every `renderPanel` and `exitPanel`
(`nudges.js:625,604`). A paint on behalf of run r executes only under
`myRun = panelRun ∧ panelCard ≠ null` (+ `panelLane` match inside `paintQuick`/`paintSeats`,
`nudges.js:655,691`). JavaScript run-to-completion makes each guard-then-paint atomic.

Transition table (quick lane; the panel lane is isomorphic with `codex` in place of
`claude ∨ codex` and sites 726-746):

| # | from | to | guard / trigger | site |
|---|---|---|---|---|
| t1 | — | `S_INIT` | `renderPanel("quick")` (gesture, D8) | `nudges.js:627-629` |
| t2 | `S_INIT` | `S_PEND` | health: `claude ∨ codex` ready | `nudges.js:669-672` |
| t3 | `S_INIT` | `S_UNAVAIL` | health: neither ready (terminal; no request sent) | `nudges.js:672-673` |
| t4 | `S_PEND` | `S_LIVE(m)` | response served ∧ `res.mode ≠ "scripted"` ∧ `res.text` ∧ fresh (D12) | `nudges.js:677-678` |
| t5 | `S_PEND` | `S_UNAVAIL` | response served ∧ `res.mode = "scripted"` ∧ fresh | `nudges.js:679-681` |
| t6 | `S_PEND` | `S_UNAVAIL` | fetch rejects (network error, HTTP ≥ 400 incl. 499, UI timeout 150 s quick / 180 s panel, abort) ∧ fresh | `nudges.js:682-686` (timeouts `nudges.js:676,736`) |
| t7 | any | `S_GONE` | `exitPanel` (gesture or bus event; also increments `panelRun`) | `nudges.js:600-607` |
| t8 | any | `S_INIT` | `renderPanel(lane′)` (gesture; cancels + increments `panelRun`) | `nudges.js:622-634` |

There is no transition into `S_LIVE(m)` other than t4 (its panel twin `nudges.js:737-739`
additionally requires `res.mode === "live-codex"` ∧ `res.seats`). There is no transition
out of `S_LIVE(m)` except t7/t8. Replace-in-place: t4 and t5 overwrite the same container
element (`nudges.js:654-659,693-718`); no history of chips is retained.

W1 (worked trace, live). Gesture `second_opinion` click → `enterPanel` → `renderPanel("quick")`
(`nudges.js:357-358,593-599`): t1. Health cache says claude ready: t2 paints scripted text
from `patients.json:31` under chip `SCRIPTED · LIVE LANE DELIBERATING…` with the auxiliary
note "Live lane answering (Claude): it replaces this scripted text when it lands."
(`nudges.js:672`). POST `/api/quick` returns
`{mode:"live-claude", text, receipt:{served_mode:"live-claude", model, latency_ms:2312, ts}}`:
t4 paints chip `LIVE: CLAUDE (ANTHROPIC API)` and receipt line `receipt: live-claude · 2312 ms`
(`nudges.js:678`).

W2 (worked trace, degraded). As W1 through t2. Server: claude key present but call fails
(e.g., 401) → note appended; codex not logged in → return `{mode:"scripted", receipt:{…,
note:"claude failed (anthropic api error 401: authentication_error); scripted fallback
retained"}}` (`relay.py:362-365,385-391`). Client t5: chip `SCRIPTED: QUICK LANE UNAVAILABLE`,
literal receipt string "receipt: live lane became unavailable; scripted fallback remains"
(`nudges.js:679-681`). The label class never left SCRIPTED; the chip text changed from
pending to unavailable — a within-class relabel, not an upgrade.

W3 (worked trace, cancel via Shift+B). Panel deliberating (`S_PEND`, run r in flight).
Keydown Shift+B outside an editable target (`buddy.js:245-252`) → `setVariant`
(`buddy.js:235-244`) → `applyVariant` closes the open popover (`buddy.js:233`) → `closePop`
dispatches `nudg:buddy-closed` (`buddy.js:221`) → listener `nudges.js:783-786`:
`panelCard ≠ null` ⇒ `exitPanel` → `cancelActiveRelay` (`nudges.js:601,580-591`): abort r's
fetch, POST `/api/cancel {runId}` with `keepalive:true`; then `panelRun += 1`
(`nudges.js:604`), container repainted with cards (t7). Server: `cancel_run` sets r's Event
(`relay.py:140-145`); a codex child in poll receives SIGTERM within ≤ 0.1 s poll granularity
(`relay.py:277-284,207-227`); handler answers 499 (`relay.py:280`). Client-side, r's fetch
rejection reaches the catch at `nudges.js:682-686` with `panelCard = null` ⇒ no paint. No
chip was upgraded, no chip was restored; the terminal state is `S_GONE`.

## 4. Monotone provenance

INV2 (monotone provenance). In every reachable DOM state, the displayed provenance class
satisfies: π = LIVE only if a live-mode response (`res.mode ∈ {live-claude, live-codex}`)
with a nonempty payload (`res.text` for quick; `res.seats` for panel) was received over the
relay socket by the current, fresh (D12) run. Equivalently: the label never upgrades
SCRIPTED → LIVE except on a served live result; failures, timeouts, cancellations, unknown
modes, and stale responses leave or restore a SCRIPTED-class label.

L1 (fail-closed label lookup). For every k ∉ dom(Λ), the rendered label is
`scripted-quick` (quick surface) or `scripted-panel` (panel surface), both π = SCRIPTED.
Proof. The only lookups are `LANE_LABEL[mode] || LANE_LABEL["scripted-quick"]`
(`nudges.js:656`) and `LANE_LABEL[mode] || LANE_LABEL["scripted-panel"]` (`nudges.js:700`);
JavaScript `||` substitutes the default exactly when the lookup is `undefined`, i.e., for
every key outside dom(Λ) = the five rows of D4. ∎

L2 (live-paint site inventory). The complete set of call sites that can pass a key of class
LIVE to a paint function is {`nudges.js:678`, `nudges.js:738`}.
Proof. Exhaustive enumeration of paint call sites: `paintQuick` is called at
`nudges.js:672` (literal `"scripted-pending"`/`"scripted-quick"`), `678` (`res.mode`),
`680` (literal `"scripted-quick"`), `684` (literal `"scripted-quick"`); `paintSeats` at
`nudges.js:730` (literal `"scripted-pending"`/`"scripted-panel"`), `738` (`res.mode`),
`741`, `745` (literal `"scripted-panel"`). Literal arguments are SCRIPTED-class by D4.
Only 678 and 738 pass a variable. ∎

T1 (monotone provenance). INV2 holds on all execution paths, including error and cancel
paths.
Proof. By L2, a LIVE-class chip can only be produced at `nudges.js:678` or `738`.
Site 678 executes under the conjunction `myRun === panelRun ∧ res ∧ res.mode ∧
res.mode !== "scripted" ∧ res.text ∧ panelCard` (`nudges.js:677`); site 738 under
`myRun === panelRun ∧ res.mode === "live-codex" ∧ res.seats ∧ panelCard`
(`nudges.js:737`); both additionally re-check surface identity inside the paint function
(`nudges.js:655,691`). Hence a LIVE paint requires a completed relay response whose mode
is non-scripted with nonempty payload, observed by the current run (D12). If `res.mode` is
any string outside M's live values, L1 forces a SCRIPTED label even at these sites — the
payload may render, the provenance claim cannot. Error paths: fetch rejection or non-2xx
reaches only the catch sites `nudges.js:682-686`/`743-747`, which paint SCRIPTED-class
literals, and only when fresh; otherwise nothing paints. Cancel paths: every call of
`cancelActiveRelay` is either preceded-and-followed by `panelRun` increment
(`renderPanel` `nudges.js:623-625`; `exitPanel` `nudges.js:601-604`) or occurs when
`panelCard = null` (`nudges.js:783-786` else-branch); in the first case D12 freshness fails
for the cancelled run, in the second the paint guards fail; in both, the cancelled run
paints nothing, and the DOM was already repainted by the canceller (t7/t8). Initial and
torn-down states carry no chip (D5 ⇒ π = SCRIPTED). Server-side, live modes are emitted
only with a D9-validated payload (`relay.py:353-361,367-379,527-540`), so a LIVE chip
additionally implies contract-validated content, modulo B1. ∎

B1 (trust root). The client authenticates nothing: any process bound to `127.0.0.1:4809`
could return `mode:"live-claude"`. INV2's guarantee is therefore *relative to the relay's
self-report*; the trust root is local port binding plus the relay's key discipline (§7).
A production gateway must state its own trust root (mTLS, service identity) explicitly
(§10 R3).

Remark (degrade legality). t5/t6 relabel `S_PEND → S_UNAVAIL` within SCRIPTED. INV2
constrains upgrades only; downgrades and within-class relabels are unrestricted and are
exercised deliberately (`README.md:55`: "A missing, failed, or cancelled lane leaves an
explicitly scripted fallback rather than silently upgrading its provenance.").

## 5. Latency receipts

D13 (measured interval). `latency_ms = int((time.monotonic() − started) × 1000)`, i.e.,
the truncated millisecond count of a monotonic-clock interval measured **inside the relay
process**, where `started` is captured at handler entry after body parsing and field
validation (`relay.py:347` quick; `relay.py:465` panel) and the endpoint is captured
immediately before the receipt is finalized for the chosen outcome (`relay.py:359,375,387`
quick; `relay.py:471,523,538` panel).

L3 (interval composition). The interval includes, cumulatively for whichever branches ran:
readiness probes (`claude_ready` env read; `codex_ready` subprocess probe, ≤ 5 s,
`relay.py:95-110`), each attempted lane's full duration (a failed claude attempt of up to
60 s is included in a subsequently served codex latency — fall-through at
`relay.py:362-367`), reply-contract validation, and for the panel the wall time until all
seat threads join (0.1 s poll granularity, `relay.py:277-284`; join bound 130 s,
`relay.py:503`). It excludes: HTTP accept/parse before handler dispatch, response
serialization and socket write (`relay.py:561-570`), browser↔relay transport, browser
event-loop queuing, and DOM render.
Proof. Direct reading of the cited control flow: `started` precedes the first readiness
check (`relay.py:347` < `351`; `465` < `468`); each `receipt.update(latency_ms=…)` is the
last computation before its `return`; no earlier timestamp exists in the handler. ∎

Certification statement (to be reproduced verbatim in a gateway contract):
a latency receipt **certifies** relay-observed wall time to produce the served outcome. It
**does not certify**: (i) model inference time in isolation; (ii) user-perceived latency
(excludes client transport and render); (iii) per-lane attribution under fallback (single
cumulative number); (iv) per-seat timing (panel reports one number for the join of 2–4
threads); (v) clock accuracy beyond the relay host's monotonic clock; (vi) authenticity
(B1: unauthenticated self-report).

Client rendering: the numeric receipt is displayed only for live outcomes — quick:
`` `receipt: ${res.receipt.served_mode} · ${res.receipt.latency_ms} ms` `` (`nudges.js:678`);
panel: `` `run: live · seats: ${res.seats.length} · one model per lane, contexts isolated ·
${res.receipt.latency_ms} ms` `` (`nudges.js:738-739`). Scripted outcomes render fixed
diagnostic strings without the number (`nudges.js:680,684,741,745`), although the scripted
receipt object does carry `latency_ms` (`relay.py:387,471,523`) — display omission, not
measurement omission.

Client-side timeout constants (UI abort, distinct from D13): health 1,500 ms
(`nudges.js:645`), quick 150,000 ms (`nudges.js:676`), panel 180,000 ms (`nudges.js:736`);
server-side: Anthropic 60 s (`relay.py:45`), codex 120 s (`relay.py:48`), panel join +10 s
(`relay.py:503`). Disclosed expected latencies (intent, not measured constants): quick ≈ 2 s,
panel ≈ 1–2 min (`JUDGE_QA.md:200,212`).

## 6. Cancellation

D14 (server cancellation protocol). `POST /api/cancel {runId}` sets the `threading.Event`
registered for `runId` and reports `{cancelled: found}` (`relay.py:140-145,655-658`).
Registration: `register_run` rejects an already-active `runId` with HTTP 409
(`relay.py:125-131`); `unregister_run` removes it in a `finally` block with identity check
(`relay.py:134-137,643-646,651-654`).

Effect per lane:
- **claude (HTTPS)**: the cancel event is consulted before the request (`relay.py:156-157`)
  and after the response body is consumed (`relay.py:202-203`). The blocking
  `urllib.request.urlopen` (`relay.py:183`) is **not** interrupted.
- **codex (subprocess)**: the run loop polls `cancel_event` every 0.1 s and on set calls
  `stop_process_group` then raises 499 (`relay.py:277-280`).

L4 (process-group termination). `stop_process_group` sends SIGTERM to the child's process
group, waits ≤ 1.0 s, escalates to SIGKILL, waits ≤ 1.0 s again (`relay.py:207-227`).
Group semantics hold because children are spawned with `start_new_session=True`
(`relay.py:272`), making the CLI a session/group leader so `os.killpg(proc.pid, …)`
reaches the CLI and its descendants. Every spawned child is tracked in `ACTIVE_PROCESSES`
under `PROCESS_LOCK` (`relay.py:56-57,264-275,296-297`); relay shutdown (SIGTERM/SIGHUP
handler and the `finally` in `main`) stops all tracked groups (`relay.py:230-236,678-700`);
new spawns are refused once `SHUTTING_DOWN` is set (`relay.py:58,265-266`).
Proof. Direct reading of the cited lines; the escalation order and both bounded waits are
explicit; `ProcessLookupError`/`ChildProcessError` are absorbed. ∎

N1 (explicit non-guarantee). An Anthropic HTTPS request already sent cannot be recalled:
cancellation detaches the UI result (abort + freshness guard) and terminates codex
children, but a short in-flight HTTPS call may finish server-side, incurring its cost.
Stated in source and docs: comment at `nudges.js:590` ("best effort; a short in-flight
Anthropic request may finish server-side"), `README.md:56`, `JUDGE_QA.md:79,212`. A gateway
re-implementation must carry this non-guarantee forward verbatim unless it implements
connection-level abort end to end (§10 R4).

INV3 (client at-most-one-in-flight). Per browser document, at most one relay run (D7) is
unfinished at any instant; the slot `activeRelay` (`nudges.js:565`) is that run.
Proof. `beginRelay` is reachable only inside `runQuick` (`nudges.js:674`) and `runPanel`
(`nudges.js:734`), both invoked solely by `renderPanel` (`nudges.js:629,632`), which first
calls `cancelActiveRelay` (`nudges.js:623`) — emptying the slot — and increments `panelRun`
(`nudges.js:625`). Between a run's freshness check (`nudges.js:668,727`) and its
`beginRelay` there is no `await`, so by run-to-completion no interleaving can start a
second run first; a run made stale by a later `renderPanel`/`exitPanel` returns before
`beginRelay`. Completion clears the slot via `finishRelay` (`nudges.js:576-578,687,748`);
cancellation clears it in `cancelActiveRelay` (`nudges.js:582-583`). Hence the slot is
overwritten only when empty. ∎
Scope. INV3 is a client discipline. The server enforces only `runId` uniqueness (409,
`relay.py:128`); it imposes no global concurrency cap — `ThreadingHTTPServer`
(`relay.py:671-672`) serves N distinct clients' runs concurrently. A production gateway
requiring per-principal single flight must enforce it server-side (§10 R4).

Gesture inventory reaching `cancelActiveRelay` (each restating INV2's cancel obligation —
cancelled runs never repaint, per T1's cancel-path case):
G1 "← Back to nudges" click → `exitPanel` (`nudges.js:611,769-772,600-607`).
G2 lane-tab click → `renderPanel` (`nudges.js:769-774,622-623`).
G3 lane-tablist keydown Arrow/Home/End → `renderPanel` (`nudges.js:775-782`).
G4 popover ✕ click → `closePop` → `nudg:buddy-closed` (`buddy.js:223,214-222`; `nudges.js:783-786`).
G5 Escape keydown (`buddy.js:227`).
G6 pointerdown outside popover (`buddy.js:224-226`).
G7 Shift+P toggle-close, cursor variant (`buddy.js:253-260`).
G8 Shift+B variant switch — closes an open popover as a side effect (`buddy.js:245-252,233`); full chain in W3.
G9 orb/companion click toggling closed (`buddy.js:301-315,365`).
G10 bus-driven teardown: encounter/chart switch or close, mirrored outcome, demo reset →
`exitPanel` (`nudges.js:796-803,815-826,827-840,849-859,889-908`).
The `show_me` action closes the popover (`nudges.js:329-332`), reaching G4's chain.

## 7. Key handling

INV4 (key confinement). The relay obtains `ANTHROPIC_API_KEY` exclusively from process
environment at call time (`relay.py:153`, plus the boolean presence check `relay.py:91-92`);
the key appears in exactly one egress position — the `x-api-key` request header sent to the
constant `https://api.anthropic.com/v1/messages` (`relay.py:41,172-181`) — and in no log,
no response, no file, and no child-process environment. (Docstring intent: `relay.py:20`
"Keys are never logged, never echoed in responses, never written to disk.")

Verification by exhaustive output-channel enumeration (VERIFIED; no counterexample found):

| channel | evidence |
|---|---|
| access log | `log_message` prints method + path + status only; comment "never bodies, headers, or keys" (`relay.py:603-605`) |
| startup banner | lane readiness booleans only (`relay.py:684-693`) |
| HTTP responses | handler-constructed dicts only; receipt fields enumerated in D6 contain no key; error payloads carry `RelayError.message` (static strings + status codes) or exception **class names** only (`relay.py:665-668`) |
| Anthropic error path | response body reduced to `error.type` string; comment "it never contains our key" (`relay.py:185-192`); transport errors reduced to exception class name (`relay.py:193-194`) |
| codex children | environment filtered through `CODEX_ENV_ALLOWLIST` (16 names; no `ANTHROPIC_*`) — `relay.py:70-75,113-115,273`; prompts contain system text + patient JSON + question only (`relay.py:307-317,397-409`) |
| disk | the only file written is the codex output temp file (model output), unlinked in `finally` (`relay.py:245,285-301`) |
| health | booleans `"ready"/"no-key"` (`relay.py:625-628`) — presence bit only (F4) |

Findings: none (no leak path). Two precision notes for the re-implementation:
(a) the brief's phrase "reads the key at startup" is not what is coded — the read is lazy,
per request (`relay.py:153`), so key rotation takes effect without restart; (b) confinement
is by absence of emitting code, not by a redaction layer; any added logging of headers or
child environments would void INV4 — a production gateway should add structural redaction
(§10 R5).

## 8. Panel aggregation

D15 (seats and votes). S = the seat list of a run, 2 ≤ |S| ≤ 4 (`relay.py:50-51,458-460`).
Vote alphabet V = {`support`, `oppose`, `insufficient`} (`relay.py:423`; prompt shape
`relay.py:403-407`). `insufficient` is a first-class ⊥-like abstention: D9-P obliges it to
carry a nonempty `requests` payload naming the missing data, and forbids that payload on
non-abstaining votes (`relay.py:430-433`).

D16 (displayed aggregate). For a displayed seat set S with vote map v: S → V, define
`support(S) = |{s : v(s) = support}|` and `absten(S) = |{s : v(s) = insufficient}|`.
The client renders (`nudges.js:705-712`):
- if `absten(S) > 0`: the refusal token
  `UNDERDETERMINED · the panel declines to ratify and lists what it needs first`
  (`nudges.js:711`);
- else: the pair as `Supported: support(S)/|S| seats · no seat requested missing data ·
  positions, never confidence` (`nudges.js:712`).

INV5 (refusal rule, as coded). UNDERDETERMINED ⇔ absten(S) ≥ 1. The only threshold constant
is 0 (`nudges.js:706,710`). There is no quorum variable, no majority test, and `oppose`
votes do not trigger refusal.

F2 (specification-drift guard). The commissioning brief presumes a rule of the form
"UNDERDETERMINED when support < quorum". No such rule exists in code or data; the coded
rule is INV5 (presence-of-abstention). Corner case exhibiting the difference: votes
(support, oppose, oppose, oppose) display `Supported: 1/4 seats` — not a refusal — whereas
any support-quorum rule with quorum ≥ 2 would refuse. A design-gallery mock shows a hybrid
string ("UNDERDETERMINED · 1 supports referral · 3 identify assessment or missing-data
needs", `DESIGN.md:128`), but the gallery is declared illustrative, non-runtime
(`README.md:40`); the runtime strings are exactly those of D16.

L5 (requests/abstention equivalence on valid seats). For every D9-P-valid seat record r:
`r.requests ≠ "" ⇔ r.stance = insufficient`.
Proof. Both implications are conjuncts of the validity predicate (`relay.py:430-433`):
insufficient ⇒ requests nonempty; support/oppose ⇒ requests empty; stances are exhaustive
by `relay.py:423`. ∎
Domain caveat: the invalid-seat placeholder (insufficient with empty requests,
`relay.py:441-446,508-516`) violates the biconditional, but INV-P (§2.2, restated: any
invalid seat forces the whole run to `mode:"scripted"`, `relay.py:518-525`) excludes it
from every displayed live seat set.

L6 (client/server aggregate agreement). On any displayed live panel, the server's
`aggregate.support` equals the client's `support(S)`, `aggregate.total = |S|`, and
`aggregate.requests_data = absten(S)`.
Proof. Displayed live sets contain only valid records (INV-P). Support and total are the
same count expressions (`relay.py:531-532` vs `nudges.js:705` and `|S|`). For the third:
`requests_data` counts nonempty `requests` (`relay.py:533`), which on valid records equals
the abstention count by L5. ∎
F3 (dead metadata). The client never reads `res.aggregate`; it recomputes from `res.seats`
(`nudges.js:705-706`). The server field is redundant-but-consistent (L6). A gateway should
either make the server aggregate authoritative or delete it; shipping two computations
invites future divergence.

T2 (aggregation soundness — assumption-freeness). The displayed aggregate is the function
g(⟦S⟧) = (support(S), |S|, [absten(S) > 0]) of the realized stance multiset ⟦S⟧ alone. Its
correctness presupposes no independence, no calibration, and no exchangeability across
seats: for **any** joint probability law P over seat outputs — arbitrarily correlated,
arbitrarily miscalibrated — and any realization drawn from P, g is computed pointwise on
that realization and asserts nothing beyond it.
Proof. g's definition (`nudges.js:705-712`) references only the realized stance strings of
the displayed run; no distributional parameter, weight, prior, or cross-seat term appears.
A statement about one realization that quantifies over no distribution is invariant under
the choice of P. ∎
Contrast: any scheme that reports a pooled numeric confidence c̄ = (1/|S|) Σ c_s asserts a
group-level probability, which requires (i) a calibration premise — each c_s is a
probability of a common event on a common scale — and (ii) a pooling justification
(independence or exchangeability) for c̄ to mean anything about the event. The coded
display refuses both premises and says so on screen: "positions, never confidence"
(`nudges.js:712`; `JUDGE_QA.md:39` "Aggregates show support counts, never confidence
percentages, and refusal — UNDERDETERMINED — is a first-class output").

W4 (averaging destroys the abstention/oppose distinction). Embed V into [0,1] by any
affine confidence scale e(support) = 1, e(insufficient) = ½, e(oppose) = 0 (the standard
"neutral midpoint" embedding). Consider two deterministic joint distributions over 4-seat
outputs: P₁ = point mass on (support, support, oppose, oppose); P₂ = point mass on
(insufficient, insufficient, insufficient, insufficient). Then the averaged confidence is
c̄(P₁) = (1+1+0+0)/4 = ½ and c̄(P₂) = (½·4)/4 = ½ — identical — while the coded display
distinguishes them maximally: P₁ renders `Supported: 2/4 seats`; P₂ renders
`UNDERDETERMINED` (INV5, absten = 4). Therefore no post-processing of c̄ can recover the
display: the mean factors through a statistic that identifies outcomes the display must
separate. Conversely the display does not determine c̄ — (support, support, insufficient,
oppose) also renders UNDERDETERMINED with c̄ = 5/8 ≠ ½ — so neither statistic refines the
other; the choice of g over c̄ is a semantic commitment, not a coarsening. ∎

T3 (Holloway refusal). Both scripted Holloway seat sets aggregate to UNDERDETERMINED under
INV5.
Proof. Primary set (`patients.json:63-68`): endocrinology insufficient (64), nephrology
insufficient (65), pharmacy insufficient (66), primary care oppose (67) ⇒ absten = 3 ≥ 1 ⇒
refusal token; note support = 0 is not the trigger — INV5 fires on absten alone.
Follow-up set (`patients.json:34-62`): insufficient (35-41), insufficient (42-48),
insufficient (49-55), oppose (56-61) ⇒ absten = 3 ⇒ refusal. Each scripted insufficient
seat carries nonempty `requests` (`patients.json:40,47,54` and `64-66`), so L5's shape
holds in data as well; the oppose seats carry none. The rendered sentence is exactly
`nudges.js:711`; the doc intent matches (`JUDGE_QA.md:51`: three seats name missing
intake/preference/access data; one opposes treating a simulated send as completed care). ∎

Scripted-lane note (restating INV2 at a use site): the scripted seat sets render through
the same `paintSeats` under SCRIPTED-class chips (`nudges.js:730`), so the refusal token
can legitimately appear under a scripted label; INV2 is about the provenance chip, not
about which aggregate token shows.

## 9. Cost model and the no-unrequested-spend invariant

Machine-read constants (normative for a port): quick `max_tokens` 500 (`relay.py:44`);
quick model default `claude-sonnet-5`, env-overridable (`relay.py:43`); codex model default
= CLI default (`relay.py:47`); timeouts §5; seat bounds 2–4 (`relay.py:50-51`); question
cap 2000 chars (`relay.py:52`); body cap 256 KiB (`relay.py:49`).

Dollar figures (ILLUSTRATIVE — appearing nowhere in code; no pricing constant is
machine-read): quick ≈ $0.01 per run; panel ≈ $0.30–0.60 per run (`DESIGN.md:150`;
`ROI_MODEL.md:163-165`; `JUDGE_QA.md:190`); the assumption register uses $0.45 as the
panel point value (`ROI_MODEL.md:36`, A11). Any port must re-derive prices from its
provider registry; these numbers certify order of magnitude of intent only.

INV6 (no unrequested spend). Every POST to `/api/quick` or `/api/panel` is dominated, in
program order, by a user gesture (D8). Deterministic triggers (rules R-01/R-04/R-09/R-12)
perform no network I/O; the sole non-relay fetch is the static `/data/patients.json` at
boot (`nudges.js:915`).
Proof (call-site enumeration). The relay client function `relay()` (`nudges.js:547-561`)
has exactly three call sites: `nudges.js:645` (`GET /api/health`, inside `lanes()`),
`676` (`POST /api/quick`, inside `runQuick`), `736` (`POST /api/panel`, inside `runPanel`);
plus one direct `fetch` at `585` (`POST /api/cancel`, inside `cancelActiveRelay`).
`lanes()` is called only from `runQuick`/`runPanel` (`nudges.js:667,726`). `runQuick` and
`runPanel` are called only from `renderPanel` (`nudges.js:629,632`). `renderPanel` is
reachable only from: `enterPanel` (`nudges.js:598`) — itself called only from
`runAction(card, "second_opinion")` (`nudges.js:357-358`); the panel-navigation click
handler (`nudges.js:769-774`); and the panel-tablist keydown handler (`nudges.js:775-782`).
`runAction` is called only from the card-button click handler (`nudges.js:458-465`) and
the peek-button click handler (`nudges.js:478-492`, `data-act="primary"` at 488-490).
No `element.click()` or synthetic event dispatch targeting these handlers exists in
`nudges.js` or `buddy.js`. Timer-driven code (`armR09`, `nudges.js:155-202`) and
bus-driven code (`nudges.js:789-912`) render or remove cards and may *cancel* runs
(G10, §6), but contain no path into `renderPanel`. Hence every lane request chain begins
at a `click` or `keydown`. ∎
Gesture table for the two spend endpoints:

| request | initiating gestures |
|---|---|
| `/api/quick` | second-opinion action click (card `nudges.js:458-465` or peek `488-490`); "Quick take" tab click (`769-774`); tablist ArrowLeft/Home keydown (`775-782`) |
| `/api/panel` | "Panel review" tab click (`769-774`); tablist ArrowRight/End keydown (`775-782`) |
| `/api/health` | prefix of either of the above (via `lanes()`, 60 s cache) |
| `/api/cancel` | teardown gestures G1–G10 (§6) |

Policy statement verified: "deterministic triggers free; AI depth only on explicit
request" (`ROI_MODEL.md:162-165`; `JUDGE_QA.md:218-220`) is implemented as INV6; "free"
is the cost-model idealization *marginal ≈ $0 of provider spend*, not zero CPU.

## 10. Gateway integration mapping

D17 (lane as provider + policy). A lane is a tuple
`(provider_id, model, token_cap, timeout_s, format_contract, fallback_next)`;
the concrete instances are quick-claude = (anthropic, `claude-sonnet-5`, 500, 60, D9-Q,
quick-codex), quick-codex = (codex-cli, CLI-default, —, 120, D9-Q, scripted),
panel-codex = (codex-cli, CLI-default, —, 120 per seat, D9-P ∧ INV-P, scripted).
In an the gateway provider registry, `provider_id` resolves through the registry and
`format_contract` runs as a post-hook; the a policy firewall owns the egress allowlist that
§7 implements by construction (single constant URL, `relay.py:41`).

S1 (minimal response-metadata schema preserving INV2). Every gateway response MUST carry:

```
receipt: {
  requested_lane: "quick" | "panel",
  served_mode:    "scripted" | "live-<provider_id>",   // authoritative provenance
  model:          string,        // REQUIRED iff served_mode ≠ "scripted"
  latency_ms:     int ≥ 0,       // D13 semantics; certification statement of §5 applies
  ts:             ISO-8601 UTC,
  note?:          string,        // fall-through disclosure (relay.py:377-378,389-390)
  failed_seats?:  int            // panel scripted downgrade only (relay.py:522)
}
```

with payload-presence rules: `text` iff quick ∧ live; `seats` (+ optional `aggregate`)
iff panel ∧ live; scripted responses carry **no content payload** (§2.3).

Requirements (each restates the invariant it protects):
- R1 (label function). The UI derives the chip solely as Λ′(served_mode) with a total,
  fail-closed extension: unknown values map to a SCRIPTED-class label (generalizes L1).
- R2 (no scripted content from the wire). Scripted fallback content lives with the UI or a
  signed scripted store, never in the degraded response — otherwise a degraded path could
  imitate a live payload and T1's enumeration breaks.
- R3 (receipts mandatory, trust root named). Every response carries S1; the deployment
  document states the trust root replacing B1 (service identity/mTLS).
- R4 (cancellation). Cancel is idempotent, best-effort, keyed by run id; per-principal
  single flight (INV3) is enforced server-side; N1 is either engineered away
  (verified end-to-end abort) or carried forward verbatim as a disclosed non-guarantee.
- R5 (key confinement, INV4). Provider credentials live in the gateway process/secret
  manager; structural redaction on all log sinks; child tools receive allowlisted
  environments (cf. `relay.py:70-75,113-115`).
- R6 (contract ⇒ downgrade). Format-contract failure yields `served_mode:"scripted"`
  (never partial repair) — cf. `relay.py:354-355,370-371`.
- R7 (all-or-nothing panels, INV-P). Any invalid seat downgrades the entire panel response
  with `failed_seats` disclosed — cf. `relay.py:518-525`.
- R8 (health honesty, F4). Health reports capability presence, not credential validity,
  and says so in its schema description.

T4 (preservation). If the UI satisfies R1 and the gateway satisfies R2, R6, R7 and emits
`served_mode` per S1, then INV2 holds in the re-implemented system.
Proof sketch (structure identical to T1). R1 makes the label a total function of
`served_mode` with SCRIPTED default, so LIVE-class chips arise only from
`served_mode = live-*` responses (L1/L2 analogue). R6/R7 ensure live modes are emitted
only with contract-valid payloads (D9 analogue). R2 removes the only remaining channel by
which a degraded response could present live-looking content. Freshness/cancel guards are
a UI obligation identical to D12 and must be ported with the label function; given them,
the case enumeration of T1 goes through unchanged. Marked CONJECTURE only in the sense
that it quantifies over an unbuilt implementation; the proof obligation checklist is
exactly {R1, R2, R6, R7, D12-port}. ∎ (conditional)

## 11. Findings register (file 1)

- F1 §0 — brief attributes lane/receipt/cancel machinery to `buddy.js`; it lives in
  `nudges.js` (locations cited). Shift+B cancels only via the popover-close side effect.
- F2 §8 — no support-quorum exists; coded refusal is INV5 (any abstention). Oppose-only
  panels display `Supported: 0/N seats`, not UNDERDETERMINED.
- F3 §8 — server `aggregate` is computed but unread by the client (consistent by L6);
  single-source it in the port.
- F4 §2.4 — health `claude:"ready"` certifies key presence, not validity.
- N1 §6 — in-flight Anthropic HTTPS requests may complete server-side after cancel.
- B1 §4 — provenance is relay self-report; local port binding is the trust root.
- Remark §2.4 — `GET /api/health` is origin-unchecked (boolean disclosure only).

## 12. Index

Definitions D1–D17; invariants INV2 (monotone provenance), INV3 (single flight, client),
INV4 (key confinement), INV5 (refusal rule), INV6 (no unrequested spend), INV-P
(all-or-nothing seats); lemmas L1–L6 (all proved); theorems T1–T3 (proved), T4
(conditional, obligations enumerated); non-guarantee N1; boundary B1; worked examples
W1–W4; findings F1–F4. Companion file: `agentC_spec_evidence_roi.md` (claim-registry type
system, ROI arithmetic, KPI schema, assumption-register template).
