---
"@apps/atlas": minor
---

Data Atlas's service starts the one way every app's does, on service kit 0.13: `startAppService` listens, gives the registry this version's frontend, puts Data Atlas in the catalogue and stops cleanly on SIGTERM, and `appServer` checks the gateway's signed caller, answers every error as problem details and serves /healthz. Its refusals for signing in and choosing a floor are now problem details too, with the same words.
