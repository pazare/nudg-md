# Formal Specification — Evidence Claim Registry, Boundary-Rule Type System, and ROI Arithmetic

Specification 2 of 2. Extracted from source on 2026-07-18 for re-implementation inside a
production host-API application (with an the gateway provider registry and a
a policy firewall). Data files are ground truth; documentation is intent. Numbering is local
to this file: definitions D*n*, invariants INV*n*, lemmas L*n*, theorems T*n*, corollaries
C*n*, typing rules R-*, worked examples E*n*, proposals P*n*, findings F*n*, discrepancies
DISC-*n*. Every lemma and theorem is proved or marked CONJECTURE; every behavioral or
numerical claim cites `file:line`. All recomputations in §4 were machine-executed against
the stated factors; verdicts are exact-vs-displayed comparisons.

## 0. Sources and citation convention

| Short cite | Absolute path |
|---|---|
| `evidence.json` | `/Users/pablo/Desktop/Summer 2026/nudg-md/data/evidence.json` |
| `PACK.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/evidence/EVIDENCE_PACK_2026-07-18.md` |
| `ROI.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/ROI_MODEL.md` |
| `JUDGE_QA.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/JUDGE_QA.md` |
| `DESIGN.md` | `/Users/pablo/Desktop/Summer 2026/nudg-md/docs/design/NUDGE_CARDS_DESIGN.md` |
| `nudges.js` | `/Users/pablo/Desktop/Summer 2026/nudg-md/shared/nudges.js` |
| `bus.js` | `/Users/pablo/Desktop/Summer 2026/nudg-md/shared/bus.js` |

## 1. The claim registry as a schema

D1 (claim record). `evidence.json` is an array of exactly 36 objects, each with key set
exactly:

```
{ id, claim, effect_size_or_number_with_n_N, population, source, year,
  doi_or_url, study_type, quality_grade, exact_quotable_line_le_25_words }
```

(build instruction `PACK.md:57`; machine-verified over all 36 records: no missing, no
extra keys). Field types as **observed in data** (not merely as documented):

- `id : WS × ℕ` where WS ∈ {NUT, CKD, CDS, TIME, COST}; populations of ids: NUT-01..09,
  CKD-01..05, CDS-01..06, TIME-01..08, COST-01..08 (9+5+6+8+8 = 36); ids unique
  (machine-verified).
- `year : ℤ ∪ {"UNVERIFIED"}` — 34 integers, 2 strings (`evidence.json:104,164`).
- `source, study_type, doi_or_url, exact_quotable_line_le_25_words :
  Text ∪ {"UNVERIFIED"}`.
- `quality_grade : {A, B, C, U}` (D2).
- `effect_size_or_number_with_n_N : Text` — semi-structured; may embed n/N, CIs, p-values,
  currency-year tags, and **coordinate-level** UNVERIFIED tokens (see D5-remark), e.g.,
  "PFS/OS magnitudes UNVERIFIED" (`evidence.json:77`), "price-year UNVERIFIED"
  (`evidence.json:341`), "dollar-year UNVERIFIED" (`evidence.json:377`).
- `population : Text` — the population index consumed by typing rule R-AUTH (§2).

F1 (data/intent divergence, year field). The pack's build instruction assigns
`year = 2026` to NUT-09 and CKD-05 and reserves "UNVERIFIED" for `doi_or_url`, grade, and
the quotable line (`PACK.md:57`). The shipped data instead sets `year = "UNVERIFIED"` for
both, and extends "UNVERIFIED" to `source` and `study_type`
(`evidence.json:98-109,158-169`). The data is strictly more conservative than the intent;
under the ground-truth rule the normative type is the observed sum type
`ℤ ∪ {"UNVERIFIED"}`. A production schema must adopt the sum type or normalize the two
records — silently coercing "UNVERIFIED" to an integer is prohibited by R-UNV (§2).

D2 (grade chain). Grade set G = {A, B, C, U}, defined (`PACK.md:4`): A "authoritative
guideline/RCT/systematic review"; B "peer-reviewed with
indirectness/heterogeneity/bias/observational"; C "older canonical, simulation,
single-center QI, or cost model"; U "unverified — never present as fact". Order by
evidential standing: U ⊏ C ⊏ B ⊏ A — a total order, hence a (degenerate) lattice with
join = max, meet = min. Two glosses bind the semantics: the tiers are the research run's
internal **source-type** tiers, "not formal GRADE certainty, recommendation strength, or
patient-level confidence" (`JUDGE_QA.md:3`; `DESIGN.md:205`); therefore the order licenses
display discipline, not probabilistic weighting.

Observed census (machine-verified):
A = 8: {NUT-01, NUT-02, NUT-03, NUT-04, CKD-01, CKD-02, CDS-04, CDS-05};
B = 16: {NUT-05, NUT-06, NUT-07, NUT-08, CKD-03, CKD-04, CDS-01, CDS-02, TIME-01,
TIME-02, TIME-03, TIME-04, TIME-05, COST-02, COST-03, COST-04};
C = 10: {CDS-03, CDS-06, TIME-06, TIME-07, TIME-08, COST-01, COST-05, COST-06, COST-07,
COST-08};
U = 2: {NUT-09, CKD-05}.

D3 (interval tiers). The ROI model's new-bases registry uses interval-valued tiers:
NB-2 tier "B/C" and NB-3 tier "B / C" (`ROI.md:204-205`), i.e., elements [C, B] of the
interval lattice over the D2 chain. A production schema should type `tier` as
`G ∪ Interval(G)`.

INV1 (quotable-line interface invariant). For every record r:
`wordcount(r.exact_quotable_line_le_25_words) ≤ 25`, where wordcount is
whitespace-splitting. Machine-verified over all 36 records; observed maximum 21 words
(CKD-01, `evidence.json:120`); the two U records carry the 1-word placeholder
"UNVERIFIED". Intent statements: "Quoted lines ≤25 words" (`PACK.md:4`); "Each claim's
exact line is quoted once, ≤25 words, with its id" (`DESIGN.md:205`).
UI obligation (restated for every quoting surface): a surface quoting claim r must render
`r.exact_quotable_line_le_25_words` **verbatim**, exactly once, accompanied by `r.id`; it
must not synthesize, truncate, or paraphrase a quote. The invariant is enforced data-side
by construction (the field is the only quote available); the UI-side obligation is the
no-synthesis clause.

INV2 (id-resolution invariant). Every evidence id displayed anywhere resolves to
`evidence.json` (`JUDGE_QA.md:3`; `ROI.md:11-13`), and every number surfaced in ROI copy
carries "its id, tier, year, and lane" (`ROI.md:11-13`); "An unlabeled number is a bug"
(`ROI.md:15`). Formal lint rule for the production app: every numeric literal in surfaced
copy must parse to a pair (value, provenance-id ∈ ids(evidence.json) ∪ {NB-1..7} ∪
{A1..A11}); CI rejects otherwise. (Restated as the template's column contract in §6.)

## 2. Boundary rules as a type system

D4 (dimension). Dim = Construct × Population × CurrencyYear × Design, with
- Construct ∈ K = {PROGRAM-COST, CAPACITY-OPPORTUNITY, COST-OF-ILLNESS-ASSOC,
  REIMBURSEMENT, ORGANIZATIONAL}. The pack's display rule names the first four lanes
  (`PACK.md:55`: "four separate lanes (PROGRAM COST / CAPACITY OR OPPORTUNITY VALUE /
  COST-OF-ILLNESS ASSOCIATION / REIMBURSEMENT); never sum lanes"); the ROI model adds the
  organizational lane to the never-sum set (`ROI.md:8-10`).
- Population = the free-text population index of D1 (e.g., "VA outpatients",
  "Medicare cancer patients", "Hospitalized patients (modeled)").
- CurrencyYear ∈ (Currency × ℤ) ∪ {"UNVERIFIED"} (e.g., (USD, 2008) for COST-07
  `evidence.json:413`; (EUR, ⊥) for COST-01 `evidence.json:341`).
- Design = study_type (D1).

D5 (types). Money⟨δ⟩ for δ ∈ Dim; Rate⟨δ, u⟩ = Money⟨δ⟩ per unit u; Count⟨u, p⟩;
RiskRatio⟨p, x, o⟩ (population p, exposure x, outcome o); Prob⟨p, o | cond⟩;
Guideline⟨p, m, σ⟩ (population p, modality m ∈ {may, should, must}, strength σ);
Dimensionless; UNVERIFIED (distinguished terminal type).
Remark (coordinate-level UNVERIFIED). A Money value whose CurrencyYear coordinate is
"UNVERIFIED" (COST-01, COST-04) is well-formed as a **display object** but every operation
whose premise mentions that coordinate (R-ADD, R-YEAR) is blocked, because the required
equality/conversion judgment cannot be derived.

Typing rules (Γ a context of registry facts and discharged assumptions):

```
(R-ADD)    Γ ⊢ e1 : Money⟨δ⟩    Γ ⊢ e2 : Money⟨δ⟩
           ─────────────────────────────────────────   (identical FULL dimension δ)
           Γ ⊢ e1 + e2 : Money⟨δ⟩

(R-SCALE)  Γ ⊢ α : Dimensionless   Γ ⊢ e : τ
           ──────────────────────────────────
           Γ ⊢ α · e : τ

(R-RATE)   Γ ⊢ e : Rate⟨δ, u⟩   Γ ⊢ n : Count⟨u, p(δ)⟩
           ─────────────────────────────────────────────
           Γ ⊢ n · e : Money⟨δ⟩

(R-YEAR)   Γ ⊢ e : Money⟨c,p,(cur,y),d⟩   Γ ⊢ κ : Deflator⟨(cur,y) → (cur,y′)⟩
           ────────────────────────────────────────────────────────────────────
           Γ ⊢ κ · e : Money⟨c,p,(cur,y′),d⟩

(R-RR)     Γ ⊢ r : RiskRatio⟨p,x,o⟩   Γ ⊢ b : Prob⟨p,o | baseline⟩
           ─────────────────────────────────────────────────────────
           Γ ⊢ min(1, r·b) : Prob⟨p,o | x⟩

(R-AUTH)   Γ ⊢ g : Guideline⟨p,m,σ⟩
           ──────────────────────────    (assertable at index p only; m, σ fixed)
           Γ ⊢ assert(g) @ p

(R-UNV)    (no elimination rule for UNVERIFIED; every constructor containing an
            UNVERIFIED subterm — or an UNVERIFIED coordinate needed by the rule —
            types UNVERIFIED, and assert-as-fact(UNVERIFIED) is underivable)
```

Negative space (the rules that deliberately do not exist): no subtyping or coercion
between distinct Construct, Population, or CurrencyYear coordinates; no rule producing
Prob from RiskRatio alone (the base-rate premise b of R-RR is obligatory and must be
explicit — its absence is exactly the pack's law "Relative risks are not individual
probabilities", `PACK.md:4`); no rule rebinding a Guideline's population or strengthening
its modality (`PACK.md:4`: "Quoted guideline lines do not transfer authority to different
populations"; `DESIGN.md:221`); no coercion out of UNVERIFIED (`PACK.md:4`: "U unverified
— never present as fact"). A further semantic law rides on K: COST-OF-ILLNESS-ASSOC values
are associations and never denote achievable savings absent prospective causal evidence
(`PACK.md:46,55`; `JUDGE_QA.md:178,184`) — in this system, there is no rule mapping
Money⟨COST-OF-ILLNESS-ASSOC,…⟩ into any "savings" assertion.

T1 (never-sum = dimensional soundness). For any two well-typed money terms x, y with
construct(x) ≠ construct(y) (in particular, from different lanes of K), the term x + y is
untypable; hence every cross-lane "grand total" is ill-typed.
Proof. R-ADD is the unique rule whose conclusion contains +, and its premises require the
two operands to share the full dimension tuple δ, componentwise. construct(x) ≠
construct(y) contradicts equality on the first component, so no derivation of
Γ ⊢ x + y : Money⟨δ⟩ exists for any δ. Pairwise distinctness of the five lanes of K makes
this apply to every cross-lane pair. ∎
Corollary T1.1 (within-lane year blocking). Same-construct terms with different
CurrencyYear are likewise unsummable unless R-YEAR's deflator premise κ is discharged.
The model declares κ undischarged: A5 = "Inflation conversion of 2008/2016 USD bases —
NOT PERFORMED — figures stay in source-year dollars" (`ROI.md:30`). Hence e.g. COST-07
(USD 2008, opportunity, `evidence.json:413`) + COST-08 (USD 2016, opportunity,
`evidence.json:425`) is ill-typed *even inside one lane*. This reproduces exactly the
stated rationale: "different constructs, in different dollars, from different populations
and years (2008, 2012, 2016, and 2018 USD in the bases above)" (`JUDGE_QA.md:184`).

E1 (deliberate type error — R-ADD). Attempt:
$196 (COST-07: Money⟨CAPACITY-OPPORTUNITY, VA-outpatients, (USD,2008), cost-analysis⟩,
`evidence.json:410-421`) + $2,818 (COST-05: Money⟨PROGRAM-COST(modeled),
hospitalized-modeled, (USD,≈2021 model), modeled-cost-analysis⟩, `evidence.json:386-397`)
= "$3,014 of value per patient".
REJECTED: the operands differ in all four coordinates (construct: opportunity vs modeled
program; population: VA outpatient vs hospitalized; year: 2008 vs unspecified-model;
design: cost analysis vs model). No R-ADD instance applies; the sum "launders construct
error into false confidence" (`ROI.md:8-10`) and is the exact computation the display rule
forbids (`PACK.md:55`). Licensed alternative: juxtaposition without summation —
"Juxtaposition allowed, sum forbidden" (`ROI.md:167-169`).

E2 (deliberate type error — R-RR's missing premise). Attempt: from CKD-04, triple-therapy
AKI RR 1.64 (95% CI 1.25–2.14, `evidence.json:149`), conclude "this patient has a 64%
chance of AKI."
REJECTED: 1.64 : RiskRatio⟨NSAID-users-on-diuretic/RAAS, triple-therapy, AKI⟩; the term
"64%" reads off r − 1 = 0.64, a **relative excess**, and retypes it as
Prob⟨patient, AKI⟩ with no base-rate premise b — underivable, since R-RR is the only rule
producing Prob from RiskRatio and its second premise is absent. Quantified damage: were a
baseline b = 2%/yr supplied, the licensed conclusion would be r·b = 3.28%/yr (excess
1.28 pp), a fiftyfold smaller number than the fallacious 64 pp. Licensed forms as shipped:
the relative phrasing "studies found approximately 31%–64% relative AKI increases for
triple combinations, greatest early" (`PACK.md:24`; the endpoints are RR 1.31 of CKD-03,
`evidence.json:137`, and RR 1.64 of CKD-04) and the absolute population-level handle
NNH ≈ 158 per treatment-year (`evidence.json:149,156`). The prohibition is verbatim
intent: NEVER "64% chance of AKI" (`PACK.md:24`).

E3 (deliberate type error — R-AUTH). Attempt: from NUT-03 —
Guideline⟨advanced-cancer ∧ appetite-or-weight-loss, may, (low evidence, moderate
strength)⟩ (`evidence.json:26-37`) — conclude "ASCO mandates dietitian referral for
Ms. Holloway" (a synthetic T2DM/CKD-3a patient without cancer,
`/Users/pablo/Desktop/Summer 2026/nudg-md/data/patients.json:79-101`).
REJECTED twice: (i) population rebinding advanced-cancer → T2DM/CKD is outside R-AUTH's
conclusion, which is assertable at index p only; (ii) modality strengthening may → mandates
alters the fixed m coordinate. Both prohibitions are verbatim intent: "Quoted guideline
lines do not transfer authority to different populations" (`PACK.md:4`) and NEVER "ASCO
mandates referral at 5%" (`PACK.md:16`). Same rule, effect-size variant: CDS-04's −7.0-pt
DID (`evidence.json:209`) may motivate the dismiss-with-reason mechanism but its effect
size does not transfer — "our three-choice menu is not that trial's intervention and
inherits none of its effect size" (`JUDGE_QA.md:33`; `DESIGN.md` mapping items 1–8 repeat
the non-transfer clause per mechanism).

E4 (deliberate type error — R-UNV). Attempt: cite NUT-09 to assert "no RCT covers
colon-cancer/FOLFOX patients with ≥5% loss, so our intervention's benefit stands"; or
quote its line; or sum anything with a COST-04-derived figure normalized to 2026 dollars.
REJECTED: NUT-09 is grade U with source/year/doi/study_type/quotable all "UNVERIFIED"
(`evidence.json:98-109`); R-UNV admits no elimination, so neither affirmative nor negative
factual use is derivable; its quotable line is the placeholder "UNVERIFIED" and INV1's
verbatim clause makes any real-looking quote a fabrication. CKD-05 likewise: the sentence
"KDIGO forbids every NSAID at every eGFR 30–60" is registered only to be blocked —
"UNVERIFIED — do not claim" (`PACK.md:23`; `evidence.json:158-169`). Coordinate variant:
COST-04's $1.67B has dollar-year UNVERIFIED (`evidence.json:377`), so R-YEAR's premise is
underivable and any inflation-adjusted or summed use is ill-typed even though the raw
figure may be displayed with its caveat.

P1 (proposal, not extracted). Tier propagation for derived figures: tier(derived) =
meet (minimum in D2's chain) of constituent tiers, with any HYPOTHESIZED assumption
capping the result below A. The sources practice this implicitly (every §1 figure is
flagged by A1's HYPOTHESIZED status, `ROI.md:26,59`) but state no general rule; adopt P1
explicitly in the production registry.

## 3. The ROI ladder as a multiplicative chain

D6 (capacity-lane chain). The only priced lane (`ROI.md:43-57`) is the product
V = ∏ᵢ fᵢ over the factor vector:

| # | factor | value | type | provenance |
|---|---|---|---|---|
| f₁ | EHR seconds per encounter | 974 s | Rate | TIME-01, tier B, 2018 logs (`evidence.json:242-253`; `ROI.md:45-47`) |
| f₂ | chart-review share | 0.33 | Dimensionless | TIME-01 (`evidence.json:245`) |
| f₃ | review-time reduction | 0.18 | Dimensionless | **A1, HYPOTHESIZED** (TIME-06 transfer; `ROI.md:26,47`; `evidence.json:302-313`) |
| f₄ | price of clinician time | $150/h ÷ 3600 s/h | Rate | A3, stipulated, capacity lane only (`ROI.md:28`) |
| f₅ | encounters per clinician-day | 20 | Count | A2, stipulated (`ROI.md:27`) |
| f₆ | clinic days per year | 220 | Count | A6, stipulated (`ROI.md:31`) |
| f₇ | (per-patient view) panel size⁻¹ | 1/1500 | Count⁻¹ | A7, structural, tier B (= NB-6) (`ROI.md:32,208`) |
| f₈ | (community view) FTE per 100k | 65, interval [50, 80] | Count | A8, structural, tier C (= NB-7) (`ROI.md:33,209`) |

Each displayed figure of `ROI.md:50-57` is a prefix-product of this chain with exactly one
of {1, f₅, f₅f₆, f₅f₆f₇, 10·f₅f₆, f₈·f₅f₆} as its aggregation suffix; dimensional
bookkeeping is by R-RATE/R-SCALE of §2 (all factors positive).

L1 (unit elasticity). For V = ∏ᵢ fᵢ with fᵢ > 0: ∂ ln V / ∂ ln fⱼ = 1 for every j.
Proof. ln V = Σᵢ ln fᵢ, hence ∂ ln V/∂ ln fⱼ = ∂(Σᵢ ln fᵢ)/∂ ln fⱼ = 1. Moreover the
elasticity statement holds exactly, not to first order: V is homogeneous of degree 1 in
each factor separately, V(f₁,…,αfⱼ,…) = α·V(f₁,…,fⱼ,…), an algebraic identity. ∎

C1 (exact halving — the sensitivity row). Setting f₃ = A1 to 9% (half of 18%) exactly
halves every figure in which A1 appears exactly once as a factor. By D6's table, A1
appears exactly once in every priced and every time figure of `ROI.md:50-57`; hence the
model's sentence "if A1's 18% is really 9%, every dollar halves" (`ROI.md:59`) is exact,
not approximate. Verified numerically in §4 (half-transfer column). Scope restatement
(preventing over-generalization): figures outside the capacity lane contain A1 zero times
— the AI-cost, no-show, burnout, and retrofit lanes are invariant under A1 — matching the
one-screen table, which attaches "halves if the transfer halves" to the capacity row only
(`ROI.md:224`).

C2 (log-additivity of relative errors). For perturbations fᵢ → fᵢ(1+εᵢ):
Δ ln V = Σᵢ ln(1+εᵢ), exactly; to first order δV/V ≈ Σᵢ εᵢ. Consequently multiplicative
chains accumulate relative uncertainty additively in log space, and a chain is dominated
by its widest factor. Proof: take logarithms of the identity in L1's proof. ∎

D7 (interval arithmetic). For positive intervals, [a,b]·[c,d] = [ac, bd]; a point scalar s
maps [a,b] to [sa, sb].
L2 (interval product correctness for positive factors). The product map on positive
intervals returns exactly the range of the product over the box: since multiplication is
monotone increasing in each positive argument, min and max are attained at the paired
endpoints (a,c) and (b,d). ∎

L3 (the community range is A8-driven). In the community figure
V = (f₁f₂f₃f₄f₅f₆) · f₈ every factor except f₈ is a point value; hence by L2 the displayed
interval is the scalar image of A8's interval: 10,606.86 × [50, 80] =
[$530,343, $848,549], and the interval's ratio 80/50 = 1.6 is preserved as
848,549/530,343 = 1.6. The model states this provenance in words: "The community range
comes from A8's 50–80 FTE spread, not from new evidence" (`ROI.md:60`). ∎
Worked extension (C2 in interval form): if A1 were additionally intervalized to
[0.09, 0.18], the community interval becomes [$265,171, $848,549] with log-width
ln 1.6 + ln 2 = ln 3.2 — the log-widths of independent factors add, the interval analogue
of C2.

## 4. Recomputation of every number in ROI_MODEL.md (and JUDGE_QA §6)

Method: recompute from the D6 factors and the §5-lane factors exactly as stated, compare
with the displayed value; verdict OK means agreement within nearest-displayed-unit
rounding. Machine-executed; values below are the script outputs, unrounded to the shown
precision.

Capacity lane (`ROI.md:45-57`; `JUDGE_QA.md:166`):

| figure | displayed (site) | recomputed | verdict |
|---|---|---|---|
| review s/encounter | 321 s; "5 min 21 s" (`ROI.md:46-47`; `JUDGE_QA.md:166`) | 974 × 0.33 = 321.42 s = 5 min 21.4 s | OK |
| saved s/encounter | ~58 s (`ROI.md:47,52`) | 321.42 × 0.18 = 57.86 s | OK |
| $/encounter | ~$2.41 (`ROI.md:52`) | 57.86 × 150/3600 = $2.4106 | OK |
| min/clinician-day | ~19.3 (`ROI.md:53`) | 57.86 × 20/60 = 19.285 min | OK |
| $/clinician-day | ~$48 (`ROI.md:53`; `JUDGE_QA.md:166`) | $48.21 | OK |
| h/clinician-yr | ~71 h (`ROI.md:54`) | 19.285 × 220/60 = 70.71 h | OK |
| $/clinician-yr | ~$10,600 (`ROI.md:54`) | 70.71 × 150 = $10,606.86 | OK (= $10,607 at unit precision) |
| min/patient-yr | ~2.8 (`ROI.md:55`) | 70.71 × 60/1500 = 2.828 min | OK |
| $/patient-yr | ~$7 (`ROI.md:55`) | 10,606.86/1500 = $7.0712 | OK (= $7.07) |
| clinic-10 h/day | ~3.2 (`ROI.md:56`) | 192.85 min = 3.214 h | OK |
| clinic-10 $/yr | ~$106k (`ROI.md:56`) | $106,069 | OK |
| community h/day (65) | ~21 (`ROI.md:57`) | 65 × 19.285/60 = 20.89 h | OK |
| community h/day range | 17–26 (`ROI.md:57`) | 50 → 16.07 h; 80 → 25.71 h | **DISC-1** (lower endpoint) |
| community $/yr | ~$0.7M; range $0.5–0.85M (`ROI.md:57`) | $530,343 / $689,446 / $848,549 at 50/65/80 | OK ($0.53M/$0.69M/$0.85M) |
| half-transfer column (A1 = 9%) | $1.20 · $24 · $5,300 · $3.50 · $53k · $0.35M (`ROI.md:52-57`) | $1.2053 · $24.11 · $5,303 · $3.536 · $53,034 · $344,723 | OK; last entry is half of the *displayed* $0.7M — exact half is $0.345M (half-of-rounded, within one display unit); the rest verify C1's exact halving |

DISC-1 (the single beyond-rounding discrepancy found). Displayed community-hours lower
bound 17 h/day (`ROI.md:57`) vs recomputed 50 × 19.285 min = 964.3 min/day = 16.07 h/day,
which rounds to 16, not 17. Magnitude: +0.93 h/day, +5.8% at the displayed endpoint. No
factor assignment consistent with the model's own chain reproduces 17 (using the rounded
19.3 min gives 16.08; scaling the displayed 21 h by 50/65 gives 16.15). Correction for the
port: display "16–26" (or "≈16–26") for the A8 50–80 range.

Follow-through lane (`ROI.md:70-81`; sanity `ROI.md:38-39`):

| figure | displayed (site) | recomputed | verdict |
|---|---|---|---|
| visits/clinician-yr | 4,400 (`ROI.md:71-72`) | 20 × 220 = 4,400 | OK exact |
| referrals/clinician-yr | ~409 (`ROI.md:72`) | 4,400 × 0.093 = 409.2 | OK |
| community referrals/yr | ~26,600 (`ROI.md:73`) | 65 × 409.2 = 26,598 | OK (= 26,598) |
| open loops/yr (25–50%) | ~6,700–13,300 (`ROI.md:74`) | 6,649.5 – 13,299.0 | OK-borderline: exact lower endpoint 6,649.5 sits at the half-way point of the hundreds grid and was rounded up; nearest-hundred is 6,600 by a 1.0 margin (Δ ≈ 0.76%) |
| recovered at A9 = 10% | ~670–1,330 (`ROI.md:74-75`) | 664.95 – 1,329.9 | OK-borderline: same knife-edge up-rounding at the tens grid (665 → 670) |
| sanity: visits/patient-yr | ≈2.9 (`ROI.md:38-39`) | 4,400/1500 = 2.933 | OK |

AI-cost lane (`ROI.md:36,162-169`):

| figure | displayed (site) | recomputed | verdict |
|---|---|---|---|
| $/patient-yr | ~$0.02 (`ROI.md:166-167`) | at the stated 2.9 enc/pt-yr: 0.29×$0.01 + 0.029×$0.45 = $0.01595; at exact 2.933: $0.01613 | OK: exact value $0.016; the display rounds **up** at one significant figure, overstating the system's own cost — conservative in the honest direction |
| community/yr (100k patients) | ~$1,600 (`ROI.md:167`) | $1,595 – $1,613 | OK |

Organizational, WATCH, and hardware lanes (`ROI.md:113-150`; `JUDGE_QA.md:172`):

| figure | displayed (site) | recomputed | verdict |
|---|---|---|---|
| burnout lane, community | ~$0.5M/yr (`ROI.md:117-118`) | 65 × $7,600 = $494,000 | OK (= $494k) |
| no-show shape | ≈$4,900/month at A4 = 25 (`JUDGE_QA.md:172`) | 25 × $196 = $4,900 | OK exact |
| retrofit hardware, 100 terminals | $10k–40k (`ROI.md:139`) | 100 × [$100, $400] = [$10,000, $40,000] | OK exact (L2) |
| retrofit-to-replacement ratio | ~0.1–1% (`ROI.md:144`) | $100k/$100M = 0.10%; $100k/$10M = 1.0% | OK exact |
| COST-02 "more than 2-fold" | (`PACK.md:48`; `evidence.json:353`) | 10,724/4,935 = 2.173 | OK |

Recomputation summary: 28 figures checked; 1 discrepancy beyond rounding (DISC-1); 3
knife-edge or half-of-rounded roundings documented (open-loop endpoints, half-transfer
community entry), each ≤ 1 unit in the last displayed digit; 1 deliberate conservative
up-rounding ($0.016 → $0.02, against the system's own favor). The commissioning brief's
own list (321 s, 57.9 s, 19.3 min, $48, 71 h, $10,607, $7.07, $106k, $0.53M/$0.69M/$0.85M,
409, 26,598, 6,650–13,299, 665–1,330, $0.016, $494k) matches the recomputed column
exactly at its stated precisions.

Boundary restatement at the point of maximal temptation (INV of T1, repeated
deliberately): the capacity figure $7.07/patient-yr and the AI-cost figure
$0.016/patient-yr may be **juxtaposed** but never subtracted or summed into a net-benefit
claim: "we may show both, we may not report the difference as savings" (`ROI.md:167-169`);
all figures are cost bases, not promised savings (`ROI.md:16`; `JUDGE_QA.md:190-192`).

## 5. The measurement plan as a KPI schema

D8 (metric record). Metric := (id, name, class, estimator, data source, falsifier,
status-today) with class ∈ {DIRECT, ADJUDICATED, ATTENTION-INSTRUMENT, RESTRAINT, TRUST,
COST-HONESTY, ORGANIZATIONAL}. Source tables: `ROI.md:179-192` (§7 scoreboard);
`JUDGE_QA.md:224` (the four §15 families: adjudicated appropriate acceptance and
appropriate override; downstream action completion; burden; time-to-information);
`PACK.md:33` ("Measure appropriate acceptance/override/downstream action/burden, not raw
click-through").

F2 (cross-reference drift). `ROI.md:180` cites "the pack's §15 measurement plan"; the
pack (58 lines) has no §15 — its measurement sentence is `PACK.md:33`. `JUDGE_QA.md:113,224`
cite "§15 of the design spec"; `DESIGN.md` §15 (`DESIGN.md:203`) is the *evidence mapping*,
not a measurement plan. The metric content is consistent across all three sites; only the
anchor is dangling. The production spec must bind metrics to a real, numbered section and
add a CI link-check for § anchors.

The schema instantiated (all eight rows of `ROI.md:182-191`, plus estimators and
falsifiers this specification derives; estimator event names are the bus taxonomy of
`nudges.js`/`bus.js`):

| id | metric (site) | class | estimator | falsifier | status today |
|---|---|---|---|---|---|
| M1 | adjudicated appropriate acceptance / appropriate override (`ROI.md:184`) | ADJUDICATED | clinician panel labels each logged (accept, dismiss+reason) pair appropriate/inappropriate; rates per rule id | appropriateness below pre-registered target falsifies "nudges deserved to exist"; raw override rate is inadmissible in either direction (CDS-01 ~90% override, CDS-02 appropriateness 29.4–100%; `evidence.json:170-193`; `JUDGE_QA.md:224`) | not built (`ROI.md:184`) |
| M2 | time-to-information; R-04 promise ≤ 2 clicks (`ROI.md:185`) | DIRECT | click count from card action to document open, via `nudg_cmd` → `ehr_command_ack`/`ehr_document_opened` (`nudges.js:297-332,866-888`) | median clicks > 2 falsifies the R-04 promise | event-loggable now |
| M3 | loop closure by due date, R-12 WATCH (`ROI.md:186`) | DIRECT | fraction of referral records closed before `due`; uplift vs baseline estimates A9 | measured recovery ≠ 10% falsifies A9 (today the demo "prevents zero", `JUDGE_QA.md:172`; `ROI.md:80-81`) | card exists; monitor not built |
| M4 | modal-minutes avoided; override rate under peripheral delivery (`ROI.md:187`) | ATTENTION-INSTRUMENT | interruption-time delta vs modal baseline; override rate by delivery mode | peripheral delivery failing to reduce interruption time falsifies the attention-lane mechanism (`ROI.md:95-102`) | pilot instrument |
| M5 | **nudges per encounter (target < 1) and % encounters fully silent** (`ROI.md:188`, bold in source) | RESTRAINT (first-class) | n̂ = shown/encounters from `nudg_metrics` counters (`nudges.js:60-65,78,106`) joined to encounter events; silence = fraction of encounters with zero cards | n̂ ≥ 1 falsifies the restraint claim; silence target: maximize, no numeric threshold stated in sources (`ROI.md:193-195`) | loggable now |
| M6 | dismiss-with-reason rate; UNDERDETERMINED refusal rate (`ROI.md:189`) | TRUST | reasons from `nudge_dismissed` events (`nudges.js:367-370`); refusal rate = fraction of panel renders with absten ≥ 1 (rule at `nudges.js:706,710-711`) | a refusal rate of 0 under missing-data scenarios falsifies the refusal mechanism's operation | loggable now |
| M7 | latency receipts per AI request (`ROI.md:190`) | COST-HONESTY | receipts `served_mode`/`latency_ms` per request (specification 1, D6/D13) | any AI response lacking a receipt falsifies the honesty rail | shipping today |
| M8 | burnout instrument, pilots ≥ 6 months (`ROI.md:191`) | ORGANIZATIONAL | validated instrument (e.g., MBI) longitudinal delta (`ROI.md:118-121`) | no pre-registered effect claim exists to falsify; the lane is sized, causal contribution "unmeasured and unclaimed" (`ROI.md:118-119`) | not started |

Assumption-level falsifiers (completing the register's sensitivity hooks): A1 — pilot A/B
of instrumented review time; any measured reduction ≠ 18% replaces f₃, with impact given
exactly by C1. A2/A6 — site telemetry (encounters/day, clinic days). A7/A8 — panel rosters
and workforce density; replacing A8's interval rescales the community figures per L3.
A9 — M3. A4 — WATCH monitor logs once built. A11 — lane invocations per encounter from
bus logs vs the stipulated 10%/1% ("usage rates are not measured", `ROI.md:36`).
NB-1/NB-2 — site referral rate and baseline closure rate.

Status honesty (restated): today only the global `{evaluated, shown}` counters exist
(`nudges.js:60-65`; `JUDGE_QA.md:85,224-226`); per-rule n/N and repeats-after-dismissal
are planned, not implemented (`JUDGE_QA.md:85`).

## 6. The assumption-register discipline, generalized

D9 (register record — reuse template for the production app).

```
Assumption := {
  id:          "A-<n>"            // stable, dense, cited at every use site
  statement:   Text               // one sentence, with units and scope
  status:      STIPULATED | HYPOTHESIZED | PURE-ASSUMPTION | STRUCTURAL
  provenance:  evidence id + tier | "none"
  sensitivity_hook:  elasticity (L1: exactly 1 per multiplicative use)
                     | interval [lo, hi] (L2/L3 semantics)
                     | switch (present/absent)
  falsifier:   KPI id (§5) or measurement description
  used_by:     [figure ids]       // every figure lists its assumptions; inverse index kept
}
```

Status semantics (normative):
- STIPULATED — a chosen operating point, not an empirical claim; contested by choosing a
  different point, not by evidence (A2 workload, A3 price, A6 calendar, A11 usage rates;
  `ROI.md:27-28,31,36`).
- HYPOTHESIZED — an empirical transfer claim, testable and untested; must name what would
  test it (A1; `ROI.md:26`; the EXHAUSTED-vs-HYPOTHESIZED limits discipline at
  `DESIGN.md` §10 and `JUDGE_QA.md:119-121`).
- PURE-ASSUMPTION — no evidential basis; exists only to size a lane; must be flagged at
  every use (A4 "the monitor isn't built; today it prevents zero", A9 "no basis; shown
  only to size the lane"; `ROI.md:29,34`).
- STRUCTURAL — an environment constant anchored in literature, expected stable across the
  argument's lifetime (A7 tier B, A8 tier C; `ROI.md:32-33`).

Mapping of the shipped register A1–A11 (`ROI.md:24-36`) into D9, with imperfect fits
flagged rather than smoothed:

| id | status (as shipped) | D9 status | note |
|---|---|---|---|
| A1 | HYPOTHESIZED | HYPOTHESIZED | hook: elasticity 1 (C1); falsifier: pilot A/B |
| A2 | Stipulated workload | STIPULATED | hook: elasticity 1 |
| A3 | Stipulated price | STIPULATED | scope clause "capacity lane only" is part of the statement (`ROI.md:28`) |
| A4 | PURE ASSUMPTION | PURE-ASSUMPTION | hook: switch (monitor absent ⇒ contribution 0) |
| A5 | NOT PERFORMED | STIPULATED | **imperfect fit**: a stipulated omission — "figures stay in source-year dollars" — i.e., R-YEAR's κ deliberately undischarged (T1.1); record the omission, not a value |
| A6 | Stipulated calendar | STIPULATED | hook: elasticity 1 |
| A7 | Structural constant, tier B | STRUCTURAL | aliases NB-6 (`ROI.md:208`) |
| A8 | Structural constant, tier C | STRUCTURAL | aliases NB-7; hook: interval [50,80] (L3) |
| A9 | PURE ASSUMPTION | PURE-ASSUMPTION | falsifier M3 |
| A10 | Order-of-magnitude engineering estimate | HYPOTHESIZED | **imperfect fit**: an estimate, not a transfer claim; if the four-status set is kept closed, classify HYPOTHESIZED with an "order-of-magnitude" qualifier in the statement |
| A11 | Stipulated usage | STIPULATED | falsifier: bus usage logs ("latency receipts are real, usage rates are not measured", `ROI.md:36`) |

New-bases sub-register NB-1..NB-7 (`ROI.md:199-215`): same record shape with
`provenance = source-type + year` in place of a pack id, tier ∈ G ∪ Interval(G) (D3), and
one additional mandatory field `promotion: pending-verification` — the shipped rule is
that NB bases "were *not* verified in today's 36-claim research run" (`ROI.md:11-13`) and
"before any use beyond judging conversation, they go through the same verification
pipeline as the pack" (`ROI.md:211-215`). A production registry must make `promotion` a
gate enforced by the a policy firewall: an NB-tier base is quotable in internal sizing
surfaces only, never in clinician-facing copy, until promoted.

Register coherence check (shipped practice worth porting): the model cross-validates its
stipulations against each other — 20 × 220 / 1,500 ≈ 2.9 visits/patient-yr, "consistent
with typical US primary-care utilization. The constants cohere." (`ROI.md:38-39`);
recomputed 2.933 (§4). Generalized rule: every register must include at least one
cross-constraint among its STIPULATED/STRUCTURAL entries, machine-checked in CI.

Lint rules carried into production (restating INV2 at its enforcement site):
1. Every numeric literal in surfaced copy parses to (value, provenance-id); otherwise the
   build fails ("An unlabeled number is a bug", `ROI.md:15`).
2. Every arithmetic combination of registry values must be derivable in §2's type system;
   the four checked error classes are E1 (cross-lane or cross-year addition), E2
   (ratio-to-probability without base rate), E3 (population/modality transfer), E4
   (UNVERIFIED elimination). The never-sum rule is not a style preference; by T1 it is
   dimensional soundness.
3. Every product-chain figure must list its factor vector; C1/C2 sensitivity lines are
   then generated, not hand-written (preventing DISC-1-class drift between endpoints and
   chains).

## 7. Findings register (file 2)

- F1 §1 — `evidence.json` year field is `ℤ ∪ {"UNVERIFIED"}` for NUT-09/CKD-05, diverging
  from the pack's build instruction (year 2026, `PACK.md:57`); data is stricter; adopt the
  sum type.
- F2 §5 — "§15 measurement plan" anchors are dangling (`ROI.md:180` → pack has no §15;
  `JUDGE_QA.md:113,224` → design-spec §15 is the evidence mapping, `DESIGN.md:203`);
  content consistent, anchor wrong.
- DISC-1 §4 — community hours/day lower bound displayed 17 (`ROI.md:57`), recomputed
  16.07 (rounds to 16): the single recomputation discrepancy beyond rounding across 28
  checked figures. Three knife-edge/half-of-rounded roundings and one deliberate
  self-disfavoring up-round ($0.016 → $0.02) documented, all ≤ 1 display unit.
- F3 §6 — A5 and A10 do not fit the four-status template cleanly (stipulated omission;
  order-of-magnitude estimate); mapped with explicit qualifiers rather than silently.
- Note §6 — A7/A8 alias NB-6/NB-7; single-source them in the production registry to
  prevent future divergence of value or tier.

## 8. Index

Definitions D1–D9; invariants INV1 (≤25-word verbatim quoting), INV2 (labeled-number
lint; restated in §6); typing rules R-ADD, R-SCALE, R-RATE, R-YEAR, R-RR, R-AUTH, R-UNV;
theorem T1 with corollary T1.1 (both proved); lemmas L1–L3 (proved); corollaries C1–C2
(proved); worked type errors E1–E4 (each shown, then rejected); proposal P1 (tier meet —
marked proposal, not extraction); findings F1–F3; discrepancy DISC-1. Grade census:
A = 8, B = 16, C = 10, U = 2 over 36 records; quotable-line maximum 21 words.
Companion file: `agentC_spec_ai_panel.md` (lane lifecycle LTS, monotone provenance,
receipts, cancellation, panel aggregation, gateway metadata schema).
