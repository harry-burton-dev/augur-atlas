---
'@apps/atlas': minor
'@apps/atlas-frontend': minor
---

Data Atlas follows the entity bindings of every app the registry lists (SDK 2.1, ADR 0066) instead of only Mandate's and Artifacts', each app and type from its own place (migration `014_binding_cursors`). An entity's **Used by** shows what any other app binds to it. This needs AUGUR with SDK 2.1 and Mandate and Artifacts releases that declare their bindings: until both are installed, "used by" stops updating.
