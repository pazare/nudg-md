# NUDG MD — 4-minute stage script (2026-07-18)

Abridge × Anthropic × Lightspeed, *The Future of Agentic AI in Healthcare*. Two speakers: Pablo
drives and narrates; Santiago owns the second-opinion panel beat. Rig: two Chrome tabs on
`localhost:4800` — the synthetic scribe (`/scribe/`) and the fictional LegacyChart EHR (`/ehr/`) —
with the buddy live in both and the local AI relay on `127.0.0.1:4809`.

Conventions: [stage directions in brackets]. "Spoken lines in quotes." **Bold quotes are verbatim
on-screen text** — read them off the screen, never from memory.

## Beat map

| Clock | Beat | Voice |
| --- | --- | --- |
| 0:00–0:25 | Cold open: the problem, the thesis | Pablo |
| 0:25–1:30 | Scenario 1 — the conflicting impression (Okafor) | Pablo |
| 1:30–2:00 | Scenario 2 — the maze (Holloway) | Pablo |
| 2:00–3:20 | Scenario 3 — the depth prompt + second opinion | Pablo, then Santiago |
| 3:20–3:40 | The moat: Shift+B, the cursor companion | Pablo |
| 3:40–4:00 | Honest close | Pablo |

## Pre-stage ritual (run it minutes before, every time)

1. Quit the ChatGPT desktop app: its debug banner photobombs Chrome on stage.
2. Server + relay up: `./scripts/serve.sh`. For both live replacements, health check
   `http://127.0.0.1:4809/api/health` must show both `"claude": "ready"` and `"codex": "ready"`
   (export `ANTHROPIC_API_KEY` in that terminal first). If either lane is unavailable, use and name
   the labeled scripted fallback; do not promise a live replacement. `ready` is only a local
   preflight—Claude can still fail authentication or network access at request time.
3. Hard-reload BOTH tabs: ⌘⇧R in the scribe tab, ⌘⇧R in the LegacyChart tab.
4. Click **Reset demo** (scribe, bottom-left), then approve its confirmation dialog — it wipes both
   tabs: notes, drafts, orders, event log, and every nudge cooldown. The EHR's toolbar twin is
   **Reset Demo** and has the same confirmation.
5. Confirm: white pulse orb at its saved screen edge in each tab and badge empty. The onboarding
   toast is session-only and may not repeat after a reset. If the orb was dragged left during
   rehearsal, drag it back to the right once. If a small circle trails the cursor instead, press
   Shift+B once: start in the calm dock.
6. Scribe tab frontmost, worklist visible. Breathe.

---

## The script

### 0:00–0:25 · Cold open — Pablo

[Scribe tab on screen. Stand still. No clicks yet.]

"In 2018 logs from one major EHR, doctors spent sixteen minutes and fourteen seconds in the record
per visit. A third was chart review. We target the avoidable navigation inside that work."

"NUDG MD is a buddy that lives where the doctor's eyes already are — and nudges when a new
conclusion conflicts with the documented context. Two working synthetic apps, one buddy. Watch."

### 0:25–1:30 · Scenario 1 — the conflicting impression — Pablo

[0:25 — Click **James Okafor** (9:40 AM) in the worklist. Click **Generate note**. The scripted
note appears in about a second.]

"This is our synthetic scribe. It captured the visit, but a reassuring conversation can still
tempt a casual closing impression. The doctor types one now."

[0:35 — Click at the end of Assessment & Plan and TYPE, live, exactly:
`Impression: palpitations, likely anxiety related.` — then hands off the keyboard for one second.]

[0:45 — The orb pulses, badge shows 1, and a peek slides in beside it:
**"Anxiety can wait: Rule out recurrent AF first."**]

"One second later: a nudge. Not an alarm. Not a pop-up that blocks typing. A peek."

[0:52 — Click **Open buddy** on the peek. The full card: **Chart check · FOCUSED · James
Okafor**. Read the three facts off the card, pointing at each source chip.]

"Three facts, each with its source. **A 14-day monitor confirmed paroxysmal AF.** **Today's pulse
is documented as irregularly irregular.** **He misses apixaban about twice a month, with a prior
TIA in his history.** And the frame: **Keep anxiety in the differential: Confirm the rhythm and his
anticoagulation first. You decide.**"

[1:10 — Click **Open the rhythm note**. THE JUMP: Chrome switches itself to the LegacyChart tab.
Okafor's chart is open, the Notes tab selected, and the 2026-05-12 progress note is open and
glowing blue. Let the room see it land. Do not touch the tab bar.]

"The scribe captured today's story. The buddy checked the new impression against this visit and
the prior chart — and walked us to the proof in one click."

### 1:30–2:00 · Scenario 2 — the maze — Pablo

[1:30 — In LegacyChart: click **« Back to Schedule**, then the **HOLLOWAY, Margaret** row.]

"Now the maze every doctor knows: where is that note?"

[1:38 — Click four chart tabs fast, opening nothing: **Problems → Medications → Allergies →
Labs**. On the fourth, the peek slides in: **"Find the progress note in 2 clicks."**]

"Four clicks of hunting: the buddy offers a path — two numbered steps."

[1:48 — Click **Open buddy**. Point to the two numbered steps and the “Why this, why now”
trace. Do not click **Show me** yet.]

"The path is numbered. If the doctor finds the note first, the card leaves on its own — the trace
says it plainly: **leaves on its own once you open anything**. It nudges, never nags."

### 2:00–3:20 · Scenario 3 — the depth prompt + second opinion — Pablo, then Santiago

[2:00 — Click **Show me**. The chart jumps to Notes; the top note opens and glows blue. Then step
back from the keyboard for 8 seconds.]

"Or it just takes you. Now I do the hardest thing in a live demo: nothing. I stop — it notices."

[2:08 — Peek: **"A1c rose to 8.4: The plan names no nutrition owner."** Click
**Open buddy**: the Depth card, **DEEP** chip.]

"Her A1c is climbing and the synthetic plan names nobody for nutrition. So the buddy brings depth:
one specific source, with its own applicability caveat on the card, and a mock in-network
specialist — every entry marked **Synthetic network**."

[2:20 — Click **Draft referral**. The card: **"Referral draft saved locally: Nothing has been
sent."** Point at the headline. Then click **Simulate sign & send**. Toast: **"Synthetic send
recorded: No external system was contacted."** A green WATCH card appears: **"Simulated referral
sent: A reply is due by Saturday, Jul 25."**]

"Draft first: nothing leaves without the doctor. I simulate sign and send, and the buddy records a
watch: **Owner: Dr. Rivera. Backup: Care coordination.** A due date. The boundary is explicit: this
prototype does not run the deadline monitor or return the card automatically."

[2:40 — Click **Acknowledge**. Then **« Back to Schedule** → reopen **HOLLOWAY, Margaret** →
stillness again, 8 seconds. Peek: **"Referral recorded. Review the decision in depth?"**]

[2:52 — Click **Open second opinion** directly on the peek. The popover widens: **Quick take** is
the default. A scripted answer paints instantly, chipped **"SCRIPTED · LIVE LANE
DELIBERATING…"**. If live text replaces it while on screen, read the served-mode chip and receipt;
otherwise keep the labeled scripted answer and move on.]

"A simulated send is not clinical closure. This follow-up review asks what the handoff still has
to verify. Scripted answer instantly; if live lands, the chip and receipt name which lane served it
and how fast. If it does not, the fallback stays visibly labeled."

[3:02 — Pablo clicks **Panel review** and steps back. Santiago steps in. Four scripted seats
paint instantly under the chip **"SCRIPTED · LIVE LANE DELIBERATING…"**.]

**Santiago:** "Four specialist seats, instantly — and the chip tells the truth: scripted, while
the live panel deliberates. Real deliberation takes a minute or two, and we would rather show
honest work than a fake instant answer. Three seats name missing follow-up inputs; one warns that
a simulated send is not completed care. So the screen says **UNDERDETERMINED · the panel declines
to ratify and lists what it needs first**. Here, that means what the handoff must verify next. That
refusal is a feature. Disagreement stays on screen: support
counts, never confidence."

[If the LIVE seats replace the scripted ones while on screen, Santiago reads the real aggregate
off the screen instead — e.g. **"Supported: 3/4 seats"**: "Panel support three of four —
we keep disagreement on screen: support counts, never confidence." Never predict the live
result; read it.]

### 3:20–3:40 · The moat — Pablo

[3:20 — Click once on empty page background so focus leaves every text box, then press
**Shift+B**. Toast: **"Buddy style: cursor companion (Option B). Shift+P opens it."** The orb vanishes;
a small companion now trails the cursor. Note: this closes the buddy and cancels any live panel
run still deliberating — by design. If a judge asks later, rerun Panel review during Q&A and let
it land live. Wiggle the mouse. Then click over to the scribe tab: it switched too.]

"And here is the moat: the buddy just left its dock and moved in at the cursor — in both apps
at once. Closing the buddy cancels its run: no hidden work. Attention is the scarcest resource
in the exam room, so the nudge arrives exactly where the doctor's eyes already are."

### 3:40–4:00 · Honest close — Pablo

[Stand still. Companion idling on screen.]

"What you saw is honest. Every patient is synthetic. This is decision support: it never decides,
never orders, never sends. Adjacent evidence is labeled adjacent, and unverified stays labeled
UNVERIFIED. The workflow event stream stays local; a structured synthetic case leaves only when we
explicitly invoke a live lane. The repo is public — first commit this morning, every commit today. NUDG MD: it
nudges, never nags, and it never leaves the doctor's side."

---

## Fallback ladder

The pre-stage ritual above is rung zero. Then, in order of blast radius:

1. **Relay down** (health URL fails; chips read **"SCRIPTED: QUICK LANE UNAVAILABLE"** or
   **"SCRIPTED: PANEL LANE UNAVAILABLE"**): the
   scripted chips carry the whole panel beat. Narrate them as the honesty layer: "Everything
   labeled scripted is exactly that — the labeling is the product." Every other beat — cards,
   the jump, draft, watch — is fully local and unaffected. Do not restart anything on stage.
2. **A rule misfires or will not fire**: click **Reset demo** (scribe, bottom-left) or **Reset
   Demo** (EHR toolbar) — either one is a 5-second clean slate across BOTH tabs — then redo the
   trigger. Most common cause: an earlier **Dismiss ▾** started a 24-hour cooldown; Reset clears
   it. Micro-recoveries: the peek self-hides after ~14 seconds — the card is still inside, click
   the pulsing orb (badge 1); the S1 trigger needs the word "anxiety" plus a one-second typing
   pause; S2 needs four different chart tabs inside 40 seconds with no row opened; the depth prompt
   needs 8 seconds of true stillness — another chart-tab or document action restarts the clock.
3. **The jump or tab focus fails**: the nudge stays until LegacyChart acknowledges that the note
   opened. Open the EHR tab manually and retry; do not say the chart is staged unless the note is
   visibly open. The glow starts only after the tab becomes visible.
4. **The live state breaks but Chrome remains open**: the gallery at
   `http://localhost:4800/design/cards.html` is a static design tour of card anatomy and an
   illustrative oncology depth/panel example. It is not the Holloway story and does not contain
   the referral-draft/WATCH sequence; narrow the narration and say plainly that the live path
   failed. If Chrome
   itself quits, reopen it and use session restore; if the tabs do not return, reopen the three
   localhost URLs before continuing.

One warning worth repeating: do not press Shift+B while the panel is deliberating unless you
mean it — closing the buddy cancels the live run. That is intentional (no hidden paid work),
and the script above spends it as a spoken feature.

## Judge Q&A appendix

The letters are the research run's internal source-type tiers, not formal GRADE certainty or
patient-level confidence (A authoritative RCT/guideline · B peer-reviewed with indirectness · C
older/simulation/single-center · U unverified). Full registry:
`docs/evidence/EVIDENCE_PACK_2026-07-18.md` and `data/evidence.json`.

**1 · "Isn't this just alert fatigue with better fonts?"**
Override rates in the wild run about 90% (CDS-01, B), and appropriateness varies so widely
(CDS-02, B) that raw override rate is not a metric we use: we count shown over evaluated, with
reasons. Our cards are severity-tiered (CDS-03, internal tier C) and never modal in this demo
(CDS-06, internal tier C — a simulation). A cluster RCT used a different intervention—required
prescribing justification—and is only directional context (CDS-04, internal tier A, Meeker JAMA
2016). Our three-choice dismissal menu is not that intervention and inherits none of its effect.

**2 · "Would it actually improve outcomes?"**
Unproven, and we say so: NUDG MD has zero outcome evidence. The nearest RCT is adjacent —
individualized nutrition support in colorectal chemotherapy improved treatment tolerance
(NUT-05, B, n=88) — but that is a different population, and neither it nor the wider pack shows
a survival benefit; the pack's own bottom line calls survival evidence insufficient. What we
would measure first is process: appropriate acceptance, time-to-information, and
repeats-after-dismissal. The current prototype records only global shown/evaluated counts; those
three evaluation metrics are not implemented yet.

**3 · "Why the cursor? Why not another dashboard?"**
In 2018 Cerner Millennium logs from U.S. adult nonsurgical ambulatory practices, physicians
averaged 16 minutes 14 seconds of EHR time per encounter, a third of it chart review
(TIME-01, internal tier B). The same task can cost nine-fold more time across
EHR systems (TIME-03, B), so navigation is a real, measured tax. Attention is already at the
cursor: we move context to attention instead of opening one more window that competes for it.

**4 · "What about privacy?"**
The buddy consumes derived signals only: raw note text is stripped before anything crosses
between tabs, and all events stay on this machine. A live model lane sees a card's structured
context only when the clinician explicitly invokes it — and today every patient is synthetic,
so no real patient data existed at any point in this demo.

**5 · "Why show the panel's dissent instead of one clean answer?"**
Because consensus theater is how clinical tools lose trust: we show any support count as positions,
never a confidence percentage the math cannot back. Holloway's scripted pack has three seats
requesting data and one opposing, so the aggregate refuses outright: UNDERDETERMINED. A refusal
that names its needs is more useful to a doctor than a confident guess.

**6 · "What breaks at scale — and what's fake today?"**
Fake today, plainly: five scripted synthetic patients, regex-derived note signals, a localhost
relay, and panel seats that are one model in four isolated contexts — the on-screen receipt
discloses that. Demo pacing too: the depth prompt fires after 8 seconds of stillness instead of
90. Scale behavior — real signal extraction, per-day nudge budgets across a whole panel,
off-hours escalation, integration with a real EHR — is HYPOTHESIZED and labeled that way; none
of it is demonstrated by this rig.
