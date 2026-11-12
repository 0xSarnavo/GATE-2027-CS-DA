Gather data only. Do not write code for any app, and change nothing outside this folder.

Find official or reliable published data, and save it as `cutoffs.json` in this folder, plus `SOURCES.md` listing every URL with its access date.

1. GATE qualifying cutoff marks (out of 100) for the CS and DA papers for 2024, 2025 and 2026, split into General, OBC-NCL/EWS and SC/ST/PwD. Use the official GATE result press notes or brochures.
2. For each year and paper, the marks for top ranks where published (AIR 1, 100, 500, 1000, 2000 marks or scores), and the number of candidates appeared and qualified.
3. For the programmes listed in `inputs/06-ADMISSIONS.md` (IITM DS&AI, IISc MTech AI, IITH AI, IITG DS, IITR DS, IITKGP AI), any published GATE score or rank cutoffs for 2024–2026 admissions (COAP round cutoffs, institute lists).

Shape of `cutoffs.json`:
`{"qualifying":[{"year","paper","general","obc_ews","sc_st_pwd","source"}],"toppers":[{"year","paper","rank","marks","gate_score","source"}],"programmes":[{"institute","programme","year","paper","category":"GEN","cutoff_score","round","source","note"}]}`

Use null when you can't find a value, and never guess. Mark third-party sources (coaching sites) with `"note":"unofficial"`.
