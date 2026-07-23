# NUDG MD — full test script (validation round 3)

Written 2026-07-18 ~14:3x PT. Every step, in order. The buddy engine, rules, peek cards,
EHR commands, and AI lanes are live. This script reflects the post-validation safety fixes.

## Phase 0 · Setup (1 minute)

1. Check the static server: open http://localhost:4800/scribe/ — if it loads, it is up.
2. Check the AI relay: open http://127.0.0.1:4809/api/health — expect `{"ok": true, "lanes": {...}}`.
   `codex` should read `ready`; `claude` reads `no-key` until the Anthropic key is set (Phase 5).
3. If either is down: `cd "$HOME/Desktop/Summer 2026/nudg-md" && ./scripts/serve.sh` (starts both).
4. Hard-reload both app tabs: press **⌘⇧R** in the Scribe tab and in the LegacyChart tab
   (a normal reload can keep old JS cached).
5. Expect in each tab: the white pulse orb at its saved screen edge and, once per tab session, the
   onboarding toast. If rehearsal left the orb on the left, drag it right once for the stage layout.
6. Clean slate if you tested earlier: click **Reset demo** (Scribe: bottom-left; EHR: toolbar) and
   approve the confirmation. This clears worklist state, notes, orders, the event log, and nudge
   cooldowns in BOTH tabs; the session-only onboarding toast does not repeat.

## Phase 1 · Scenario 1 — the conflicting-impression catch (Scribe, ~2 minutes)

1. Scribe tab: click **James Okafor** (9:40 AM) in the worklist.
2. Click **Generate note** (bottom center). After ~1 s the scripted note appears;
   the header notes "Editable — verify before filing".
3. Click at the end of the Assessment & Plan section and TYPE, with your keyboard:
   `Impression: palpitations, likely anxiety related.`
4. Within ~1 second of pausing: the orb pulses, the badge shows 1, and a peek card slides in
   beside the orb: **"Anxiety can wait: Rule out recurrent AF first."**
5. Click **Open buddy** on the peek (or the primary button directly). The full card shows:
   Chart check + FOCUSED + patient chips; three facts, each with a source chip; the framed
   suggestion; and the "Why this, why now" trace ending in R-01.
6. Click **Open the rhythm note**. Switch to the EHR tab: it has opened Okafor's chart, jumped to
   the Notes tab, and opened + spotlighted (blue outline) the 05/12 note. A toast confirmed it
   in the Scribe tab.
7. Back in the buddy: the card is gone (acted). Open the **Activity** tab in the popover:
   the nudge and your actions are logged in plain language.
8. Repeat-respect: type "anxiety" again somewhere in the note — no second card appears.
9. Dismiss path (optional): Reset demo, redo steps 1–4, then click **Dismiss ▾** → pick
   "Already considered" → the card leaves, the reason is logged, and it cools down for 24 h
   (Reset demo clears cooldowns).

## Phase 2 · Scenario 2 — wayfinding (EHR, ~1 minute)

1. EHR tab: click the **HOLLOWAY** row in the schedule.
2. Quickly click four different chart tabs — Problems → Medications → Allergies → Labs —
   within ~30 seconds, without opening any document row.
3. On the fourth view: peek slides in: **"Find the progress note in 2 clicks."**
   The card lists numbered steps plus alternate targets.
4. Click **Show me**: the chart jumps to Notes and opens + spotlights the top document.
5. Self-expiry variant: trigger it again (four quick tab views), then ignore the card and open
   any Notes row yourself — the card leaves on its own (superseded, not dismissed).

## Phase 3 · Scenario 3 — depth + second opinion (EHR, ~4 minutes incl. live wait)

1. With Holloway's chart open, idle on Summary for ~8 seconds (demo pacing).
2. Peek: **"A1c rose to 8.4: The plan names no nutrition owner."**
3. Open the buddy: the Depth card shows a directly linked ADA–KDIGO source plus a patient-level
   applicability caveat, the in-network specialist, and **More specialists ▾** (three more, all
   marked Synthetic network). This is the live diabetes/CKD sample. A separate oncology template
   exists in the repo but is not live until its patient fields and source applicability are verified.
4. Click **Draft referral**: the Depth card leaves and an explicit **Referral draft saved locally:
   Nothing has been sent** card appears. Click **Simulate sign & send** only if you want to test
   R-12. A green WATCH card then appears and says the send was simulated; no external system was
   contacted and no deadline monitor runs. Read it, then click **Acknowledge**.
5. Back to Schedule → reopen Holloway → idle 8 s. Follow-up peek:
   **"Referral recorded. Review the decision in depth?"**
6. Click **Open second opinion**. The popover widens. Its follow-up question asks what the
   simulated handoff must still verify before any patient-specific plan changes. **Quick take** paints a scripted answer
   INSTANTLY, chipped "SCRIPTED · LIVE LANE DELIBERATING…". If Claude is ready, the live text
   usually replaces it within seconds; otherwise the Codex fallback can take ~60–90 s. Verify the
   served-mode chip and latency receipt instead of assuming which lane answered.
7. Click **Panel review**: four scripted seats paint instantly (same honest chip). After ~1–2
   minutes the LIVE seats replace them — expect real rationales and possibly real dissent
   (a seat may oppose or request data). If any seat requests missing data, the aggregate must read
   **UNDERDETERMINED**, regardless of the support count.
8. Honesty checks while you wait: every scripted surface is chipped; the receipt line shows the
   run mode and latency; the footer names the decision owner and states nothing is sent without you.
9. **← Back to nudges** returns to the card stack and normal width; the Depth card remains.
10. Cancellation check: reopen Second opinion, start Panel review, then immediately switch to Quick
    or click Back. The old Codex child should stop instead of continuing hidden paid work.

## Phase 4 · Variant B — the cursor companion (both tabs, ~2 minutes)

We may shift the default to B (the moat: integration with the cursor). Judge it hard.

1. Click anywhere outside a text field and press **Shift+B**. Toast: "Buddy style: cursor
   companion (Option B). Shift+P opens it." The orb disappears; a smaller circle now trails your cursor.
   The OTHER tab switches style too (synced over the bus).
2. Move the mouse: the companion follows with a soft lag, offset below-right. Start typing in
   any field: it fades to near-invisible. Stop: it returns.
3. To click it: stop moving for about half a second so it parks, then drift onto it — it freezes
   under your pointer. Click it (or press **Shift+P**) to open the popover.
4. Trigger any rule while in B (e.g., redo Phase 2): the peek slides in near the companion —
   the nudge arrives at your cursor. This is the moat moment.
5. **Shift+B** returns to the calm dock (A). In A, also try dragging the orb: it snaps to the
   nearest edge and remembers its spot.

## Phase 5 · Claude quick lane (once you have the API key, ~2 minutes)

1. In the terminal running `./scripts/serve.sh`, press **Ctrl+C**; the launcher also stops the relay it created.
2. In that same terminal: `export ANTHROPIC_API_KEY=sk-ant-...` (env only; never committed).
3. Restart both managed processes: `./scripts/serve.sh`.
4. Verify: http://127.0.0.1:4809/api/health now shows `"claude": "ready"`.
5. Rerun Phase 3 step 6: Quick take should answer within a few seconds, chipped
   "LIVE: CLAUDE (ANTHROPIC API)" with its measured latency receipt.

## Troubleshooting

- No orb after reload: hard-reload (⌘⇧R); check the console for errors and tell Claude.
- A rule will not fire: you may be inside a 24 h dismissal cooldown — click Reset demo.
- Panel stays scripted: the relay is down (health URL fails) — restart `./scripts/serve.sh`.
- Live lanes feel slow: codex carries ~30 s fixed CLI overhead; 1–2 minutes is normal, and the
  scripted content stays on screen the whole time, labeled.

## What to report

(a) Anything that felt un-nudgy or noisy; (b) copy that reads wrong (style: simple, direct,
strong verbs, colons); (c) A or B as default; (d) anything that did not fire, with what you did.
