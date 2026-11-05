---
'@apps/atlas': minor
'@apps/atlas-frontend': minor
---

An identity key can change hands over time, as a vessel's MMSI does. In the studio, a new detail of text or a number can say which thing it is: always the same thing, or whoever holds it at the time. A key that changes hands is known through facts with dates. Only one entity holds a value at any time: a fact that would overlap another entity's holding is refused, naming who holds it and when. Searching by the key finds whoever holds it now. Migration `015_changing_keys`.
