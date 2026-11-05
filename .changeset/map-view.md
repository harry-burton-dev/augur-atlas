---
'@apps/atlas-frontend': minor
---

The map view (augur ADR 0071). An entity whose kind can be placed has **Where it is** on its page, and the explorer offers **Show on a map** for what's around. MapLibre GL JS and PMTiles draw it from the deployment's own base map, loaded only when a map first opens. Without a base map the points go on a plain background, saying why, and the points are always listed below the map for keyboards, screen readers and browsers without WebGL.
