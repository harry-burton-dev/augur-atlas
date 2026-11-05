---
'@apps/atlas': minor
'@apps/atlas-frontend': minor
---

Data Atlas names the organisation's floor by the organisation's name, as Admin sets it (identity's `GET /v1/organisation`), instead of "Org", and your own floor as "Your own floor" instead of "You". Entities and explorer nodes carry `floorKind` (`org`, `own`, `personal`, `team`), and the words, rights and colours that depend on a floor follow its kind, never its name. When identity can't be asked, the floor is called "The organisation". Part of PER-325.
