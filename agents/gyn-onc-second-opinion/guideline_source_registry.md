---
purpose: >
  Source registry for the gynecological oncology second-opinion agent.
  Do NOT pre-download or store the content of these pages as static files.
  The agent fetches the relevant URL live, at the time it reasons about a
  case, and logs a snapshot of what it retrieved into that case's audit
  record. This file only tells the agent WHERE to look.
license_status: >
  All URLs below are NCI PDQ Health Professional Version pages
  (cancer.gov). Text is a US Government work, public domain, and
  explicitly reusable without permission (credit NCI) -- including for
  AI/agent use. This is the only guideline source confirmed clear for
  AI ingestion as of 2026-07-18. NCCN, ESMO, and ESGO guidelines are
  NOT included here because their terms currently restrict or prohibit
  use as AI input without a separate license -- add them only after
  a licensing agreement is in place.
last_verified: 2026-07-18
---

# Gynecological Oncology Guideline Source Registry

| cancer_type | subtype / decision_point | source | url |
|---|---|---|---|
| cervical | staging, in situ, stage IA, IB/IIA, IIB/III/IVA, IVB & recurrent | NCI PDQ | https://www.cancer.gov/types/cervical/hp/cervical-treatment-pdq |
| ovarian | epithelial / fallopian tube / primary peritoneal -- staging, first-line, recurrent, PARP/biomarker-driven maintenance | NCI PDQ | https://www.cancer.gov/types/ovarian/hp/ovarian-epithelial-treatment-pdq |
| ovarian | borderline tumors (low malignant potential) | NCI PDQ | https://www.cancer.gov/types/ovarian/hp/ovarian-low-malignant-treatment-pdq |
| ovarian | germ cell tumors (rare, younger patients) | NCI PDQ | https://www.cancer.gov/types/ovarian/hp/ovarian-germ-cell-treatment-pdq |
| endometrial | staging, surgery, adjuvant therapy by risk group, biomarker-driven immunotherapy | NCI PDQ | https://www.cancer.gov/types/uterine/hp/endometrial-treatment-pdq |
| uterine | uterine sarcoma (rare) | NCI PDQ | https://www.cancer.gov/types/uterine/hp/uterine-sarcoma-treatment-pdq |
| vulvar | staging, surgery, systemic therapy | NCI PDQ | https://www.cancer.gov/types/vulvar/hp/vulvar-treatment-pdq |
| vaginal | staging, surgery, systemic therapy (rare) | NCI PDQ | https://www.cancer.gov/types/vaginal/hp/vaginal-treatment-pdq |
| gestational trophoblastic disease | risk-stratified treatment, hCG monitoring | NCI PDQ | https://www.cancer.gov/types/gestational-trophoblastic/hp/gtd-treatment-pdq |

## How this should be used

1. Given a case's `cancer_type`, look up the matching row(s) above.
2. Fetch the URL live at reasoning time -- do not rely on a cached local copy older than the current session.
3. Extract only the sections relevant to the case's stage/subtype/biomarkers; do not load the entire page into every prompt.
4. Log the exact URL fetched, the retrieval timestamp, and (ideally) a hash or saved snapshot of the fetched content into that specific case's audit record. This is what satisfies "show your work" for compliance -- not a maintained local corpus.
5. Every citation the agent gives back to a clinician should reference the specific PDQ page/section it pulled from, not a vague "per guidelines."

## Adding NCCN / ESMO / ESGO later

Once you have a licensing agreement in place with any of these societies for AI/commercial use, add rows the same way (cancer_type | subtype | source | url), and note the license reference/agreement ID in a comment next to the row so it's auditable which sources are cleared and which aren't.
