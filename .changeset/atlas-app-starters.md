---
'@apps/atlas-frontend': minor
---

Data Atlas's frontend now runs on the app starters: `defineReactApp` mounts it, its places are `placeRoutes` (so the address bar follows the page and `entity.explain` opens with `?explain=true`), and it talks to its service through `createAppClient`, reading AUGUR's problem bodies as `AppError`. Needs app kit 0.7.2.
