# Eligibility model (PRD §10)

Ana is India-based (Gurgaon). Judge every role's *practical* reachability.
JDs almost never mention visa sponsorship — **do not look for the word "visa".**

## Decision order

1. **India-based roles** (NCR/Gurgaon/Bengaluru, or India-remote): `eligible`.
2. **Global remote:** `eligible` if the JD/location doesn't restrict to countries
   excluding India AND the timezone is IST-compatible or genuinely async.
   If it restricts to e.g. "US only", "EU only", "Americas": `not_eligible`.
   US-company remote with no stated restriction: check dossier evidence; usually
   `unclear` (many US "remote" roles are US-remote implicitly — say so).
3. **Global onsite: DROPPED (preference update 2026-07-24).** The prefilter now
   kills non-remote roles located outside India before scoring. If one slips
   through anyway (missing/odd location data), mark it `not_eligible` — do not
   spend research on relocation plausibility anymore.

## Output states

- `eligible` — India-based or genuinely India-friendly remote
- `plausible` — global role where country + company evidence both lean yes
- `unlikely` — reachable in theory, evidence leans no (e.g. US onsite, no India office)
- `unclear` — no evidence either way. **Surface it anyway, flagged.** Honestly
  uncertain beats confidently wrong.
- `not_eligible` — explicitly excludes India (location restriction, local-auth
  requirement, contract requiring EU/US residency). **Only this state is
  suppressed from the digest** (still stored in the DB).

Contract/freelance roles restricted to a country (e.g. "German contract") are
`not_eligible` unless remote-from-India is explicit.
