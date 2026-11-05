---
'@apps/atlas': minor
---

Where things are, for the map (augur ADR 0071). A `place` detail takes a point, latitude and longitude in decimal degrees ("57.70, 11.97"), as well as words. A point is kept in one form, and one out of range is refused with why. Places and facilities gain a Location detail (migration 013), unless an admin already made one. `POST /v1/map/points` places the entities seen from this floor, at their own point, a position known through facts, or the point of what they're located at. `GET /v1/map` and `GET /v1/map/tiles` serve the deployment's own base map, a PMTiles file named by `ATLAS_MAP_TILES`, a range at a time, and say why when there is none.
