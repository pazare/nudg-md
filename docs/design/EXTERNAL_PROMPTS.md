# External prompts — evidence pack & concept art

Two ready-to-paste prompts that complement the nudge-card design. Outputs feed the citation slots
(E1, research rows) and assumption tables (A1–A3, C1–C3) defined in `NUDGE_CARDS_DESIGN.md`.

---

## 1 · GPT-5.6 Pro — deep research: the evidence pack (run time ~10–60 min)

Paste verbatim:

```text
ROLE: You are compiling a rigorously sourced evidence pack for a clinical decision-support demo
(NUDG MD — a desktop buddy that nudges clinicians with research, guideline, and workflow context).
The demo itself uses synthetic patients; the CITATIONS must be real, current, and verifiable. Do not
fabricate or approximate any reference; if evidence is weak or contested, say so explicitly.

DELIVERABLE: A markdown report in five workstreams, followed by one consolidated JSON array.

WORKSTREAM 1 — Nutrition support in oncology (highest priority).
Evidence on structured nutrition intervention for patients with ≥5% weight loss during chemotherapy
(colon cancer / FOLFOX context preferred): guideline positions (ESPEN, ASPEN, ASCO), RCT and
meta-analytic effect sizes on treatment interruptions/dose reductions, weight trajectory, QoL, and
survival where available. Include screening thresholds (e.g., weight-loss % criteria) with exact
guideline wording.

WORKSTREAM 2 — NSAID avoidance in CKD.
Guideline lines (KDIGO and comparable) on NSAIDs at eGFR 30–60, the NSAID+ACEi(+diuretic)
"triple whammy" evidence, and AKI risk magnitudes with denominators.

WORKSTREAM 3 — Clinical decision support & alert design.
Evidence on alert fatigue (override rates with n), what makes interruptive vs passive nudges
effective, tiering strategies, and any RCTs of "specific, sourced, actionable" alert design.

WORKSTREAM 4 — Clinician time & EHR navigation.
Time-motion studies: minutes per day searching EHRs, time to find specific chart items, task-switch
costs, and documented time costs of referral coordination. Report medians/means with n.

WORKSTREAM 5 — Cost bases.
Published cost estimates usable in a transparent scenario model: malnutrition-related complication
and admission costs in oncology, AKI admission costs, medical nutrition therapy program costs,
referral no-show costs. Note year, country, and dollar-year for each.

FOR EVERY CLAIM: {id, claim (one sentence), effect size or number with n/N, population, source
(authors, journal), year, DOI or URL, study type, quality grade (high/moderate/low), one exact
quotable line ≤25 words}. Mark anything you could not verify as UNVERIFIED rather than guessing.
Prefer 2020+ unless a landmark is canonical. End with the consolidated JSON array of all claims.
```

Use: paste results into `docs/evidence/` (next step); each design citation slot references a claim id.

---

## 2 · ChatGPT image generation — concept render (optional, for deck/pitch only)

Paste verbatim:

```text
Clean editorial product-concept render, 16:9. A clinician's desktop with two browser windows side
by side: left, a modern minimalist clinical documentation app in warm cream tones with a soft red
accent; right, a deliberately outdated early-2000s hospital records screen in beveled gray with a
navy title bar. In the lower right corner floats a small, calm white circular badge with a thin
black ECG pulse line, casting a soft shadow. One refined white notification card tilts slightly
forward from the badge, showing abstract text lines, a small amber chip, and two rounded buttons —
formal, medical, trustworthy. Warm cream background, soft studio light, subtle grain, high-end
design-magazine aesthetic. No real brand logos, no readable text, no faces.
```

Note: concept art is for storytelling surfaces (deck, README hero). The UI truth is the HTML gallery.
