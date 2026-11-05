---
'@apps/atlas': minor
'@apps/atlas-frontend': minor
---

Raising an entity card to a floor above (PER-326). A lead asks a floor above to keep an entity made on their floor ("Floors above" on the entity page). The request waits in that floor's Triage, "Asked to keep here", where its leads keep it, say it's one they already have (the two are merged there), or decline with a note that whoever asked sees. Only the card moves; what's known of it stays on the floors it was recorded on. Migration `010_raises` adds `atlas.raises`.
