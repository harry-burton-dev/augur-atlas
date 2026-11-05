---
'@apps/atlas': minor
'@apps/atlas-frontend': minor
---

"Might be the same" on the entity page: up to five entities of its kind that may be the same real thing, found as Triage finds them (identity key, name, spelling, meaning), each saying why (`GET /v1/entities/:id/alike`). Whoever may decide what the entity is (its floor's leads, or whoever added it) can merge it into one from there, saying why; when they can't, the button stays and says why. Part of PER-326.
