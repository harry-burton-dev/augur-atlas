# @apps/atlas

## 0.5.0

### Minor Changes

- f4bf79d: The manifest says what kind of app this is (ADR 0032): a pillar app: part of the foundation of what AUGUR produces. Needs SDK 1.11 or later, the first that knows the kind, so an older AUGUR refuses it with a reason instead of failing to register it.
- fe4e347: The explorer can explore within an intent (PER-327). **Within an intent…** asks Mandate for an intent, then starts the walk from what it binds, as well as the centre, and dims everything else. It says what of the intent can't be shown, and why. When Mandate can't be asked on this floor, the button stays visible and says why.
- 57baa8b: Data Atlas follows the entity bindings of every app the registry lists (SDK 2.1, ADR 0066) instead of only Mandate's and Artifacts', each app and type from its own place (migration `014_binding_cursors`). An entity's **Used by** shows what any other app binds to it. This needs AUGUR with SDK 2.1 and Mandate and Artifacts releases that declare their bindings: until both are installed, "used by" stops updating.
- 4e67992: An identity key can change hands over time, as a vessel's MMSI does. In the studio, a new detail of text or a number can say which thing it is: always the same thing, or whoever holds it at the time. A key that changes hands is known through facts with dates. Only one entity holds a value at any time: a fact that would overlap another entity's holding is refused, naming who holds it and when. Searching by the key finds whoever holds it now. Migration `015_changing_keys`.
- 357f818: A detail known through facts can hold several values at once, such as a person's languages. Each value is its own fact, and accepting one doesn't replace the others. In the studio, a new detail says where it's **known**: typed on the entity, or through facts with one value or several at a time. Migration `017_many_details`.
- 5d6ad1f: "Might be the same" on the entity page: up to five entities of its kind that may be the same real thing, found as Triage finds them (identity key, name, spelling, meaning), each saying why (`GET /v1/entities/:id/alike`). Whoever may decide what the entity is (its floor's leads, or whoever added it) can merge it into one from there, saying why; when they can't, the button stays and says why. Part of PER-326.
- b60a35e: A kind can carry a military symbol code (APP-6 or MIL-STD-2525, ADR 0070). Admins set it in the studio with **Change…**, which says before saving when a code can't be drawn. The symbol shows on the kind's row and on each of its entities' pages, drawn by milsymbol, which is only downloaded when a symbol is on screen. Kinds without a code keep their icon.
- 8e87162: Where things are, for the map (augur ADR 0071). A `place` detail takes a point, latitude and longitude in decimal degrees ("57.70, 11.97"), as well as words. A point is kept in one form, and one out of range is refused with why. Places and facilities gain a Location detail (migration 013), unless an admin already made one. `POST /v1/map/points` places the entities seen from this floor, at their own point, a position known through facts, or the point of what they're located at. `GET /v1/map` and `GET /v1/map/tiles` serve the deployment's own base map, a PMTiles file named by `ATLAS_MAP_TILES`, a range at a time, and say why when there is none.
- c31f7ca: Details can hold more (PER-328). A **quantity** is a number in a unit, such as a gross tonnage in t. A **choice** is one of a few values, such as a vessel's status. A **place** is written as words for now. The studio asks a quantity for its unit and a choice for its values, and the entity form offers a choice's values to pick from. Quantities show with their unit.
- b3d644f: Raising an entity card to a floor above (PER-326). A lead asks a floor above to keep an entity made on their floor ("Floors above" on the entity page). The request waits in that floor's Triage, "Asked to keep here", where its leads keep it, say it's one they already have (the two are merged there), or decline with a note that whoever asked sees. Only the card moves; what's known of it stays on the floors it was recorded on. Migration `010_raises` adds `atlas.raises`.
- 887181c: Data Atlas names the organisation's floor by the organisation's name, as Admin sets it (identity's `GET /v1/organisation`), instead of "Org", and your own floor as "Your own floor" instead of "You". Entities and explorer nodes carry `floorKind` (`org`, `own`, `personal`, `team`), and the words, rights and colours that depend on a floor follow its kind, never its name. When identity can't be asked, the floor is called "The organisation". Part of PER-325.
- 0341e94: Data Atlas's service starts the one way every app's does, on service kit 0.13: `startAppService` listens, gives the registry this version's frontend, puts Data Atlas in the catalogue and stops cleanly on SIGTERM, and `appServer` checks the gateway's signed caller, answers every error as problem details and serves /healthz. Its refusals for signing in and choosing a floor are now problem details too, with the same words.
- 342baca: Data Atlas checks what it keeps against SHACL shapes written from its ontology (ADR 0062). The studio has a Checks tab that checks the entities in sight a page at a time and saves the shapes as Turtle, and an entity that doesn't fit says so on its page, in the same words the checks on writing use.
- 281ab14: Kinds and details can be kept for one team's floor. In the studio, an admin standing on a team's floor chooses **Kept for**: the whole organisation, or that team and the teams under it. A team's kind shows only from that team down, and nobody records one where it doesn't show. **Make it the organisation's** widens it, the only way it changes floor. Migration `016_team_terms`.
- c197322: In Triage, a lead can say that two of a mention's matches are the same thing (PER-326). **These two are the same…** asks which one stays, and why, then places the other under it. The mention then offers the one that stays, once. The merge can be undone from either entity's page.

### Patch Changes

- f5f6e6b: Data Atlas keeps its own entry in the Backstage catalog, `catalog-info.yaml`, written by `augur-app catalog` from the manifest and the package.json files. CI checks it is current, and Version packages rewrites it.
- fe4e347: What Data Atlas knows "now" is read by the database's clock, the same one that stamps when a fact was recorded or withdrawn. A fact withdrawn a moment ago no longer shows as current for that moment.
- 69a1abc: Data Atlas builds against SDK 2.0 and service kit 0.14 (PER-292). Nothing changes for people; the manifest still opens on a 1.11 shell or a 2.0 one.

## 0.4.0

### Minor Changes

- 0997959: Data Atlas can merge two entities found to be the same thing, keeping who decided it, why and the evidence for and against. Nothing moves, so a merge can be explained and undone exactly, and an undo marks what misled it as discredited.

## 0.3.0

### Minor Changes

- e467a3e: Data Atlas follows Artifacts' entity bindings (`folio.record.entity-bound` and `-unbound`): an entity's "Used by" now lists the libraries, folders and documents linked to it, and opening one asks Artifacts.

## 0.2.3

### Patch Changes

- 5d28a57: The wire types between the frontend and the service are written once, in the service's src/api-types.ts, and both sides use them. Types only: the frontend bundle and the service build don't change.
- 1e96fc9: The manifest's SDK range also accepts SDK 2. SDK 2 only stops serving Lit, which this app never used, so the
  app keeps opening when a deployment moves to an AUGUR shell built on SDK 2.
- d2716f3: The service stays up when Postgres restarts or drops an idle connection: its database pools log the lost connection (the service kit's `steadyPool`) instead of ending the process (PER-207).

## 0.2.2

### Patch Changes

- e26db4b: Data Atlas is built and released from its own repository now, signed by this repository's release workflow. Nothing changes for people using it.

## 0.1.2

### Patch Changes

- Updated dependencies [137791c]
- Updated dependencies [2021f8a]
  - @augur/service-kit@0.11.0

## 0.1.1

### Patch Changes

- Updated dependencies [ea41136]
  - @augur/service-kit@0.10.0

## 0.1.0

### Minor Changes

- d324552: Data Atlas, first step: entities on a Common Core Ontologies starter vocabulary, fenced by floor, added and changed by hand, with an entity page that says why something can't be seen or done. The kit gains icons for kinds of thing: atlas, vessel, aircraft, vehicle, place, port, facility and event.
- 5ff1f5e: Data Atlas explorer: walk the graph around an entity a ring at a time, drawn with Sigma.js and laid out in a worker, with folds that open, hidden counts that say why, kinds, links, "True on" and "Hide disputed", and the same graph as a list. The subgraph keeps the strongest links first, always keeps its seeds, counts what lies past the last ring by relation and direction, says how many open disputes each link has, and says what each hidden entity is near.
- 740d63b: Data Atlas knows things about entities, fenced by floor: observations (what someone saw or read, with its source and grade, never changed), facts a floor's leads accept from them on two clocks (true from and until, and when recorded), links between entities, disputes, and raising an observation to a floor above. The entity page shows what's known, "true on" and "as recorded by" any day, and the subgraph now walks links.
- 3c085c0: Data Atlas ontology studio: an Ontology page everyone can read (kinds, details, kinds of link, packs and every version) where admins adopt terms from packs, decide the words sources asked for, and add or rename their own. A profile of the Common Core Ontologies comes with it; an org loads its own pack (the full CCO, MIP MIM) as OWL in Turtle. The ontology exports as OWL.
- eef32c2: Data Atlas ships with AUGUR: its own container, schema and sign-in in every deployment, and the updater restarts it and waits for it to answer.
- bbdad18: Data Atlas resolve: Triage suggests entities whose names are spelt nearly alike (pg_trgm) and, through the model gateway's embeddings, those close in meaning, after identity keys and exact names. Each proposal says how its mentions were matched and why anything wasn't tried, and a lead can look again. Data Atlas now asks for `models:use`.
- 778b6f9: Data Atlas keeps the shared entity contract: it handles `entity.pick` (a picker over the asking app), `entity.open` and `entity.explain`; answers `POST /v1/entities/resolve` and `POST /v1/subgraph` as seen from the caller's floor; finds several kinds at once; and tells other apps `atlas.entity.created`, `.changed` and `.retired` through its outbox.
- 513e2e9: Data Atlas Triage: proposals from a source (mentions and observations) are filed in the floor's Triage with suggested matches, and its leads decide what each mention names (one already known, a new one, or nothing) and whether each observation is accepted, kept as seen or dropped. Data Atlas handles `entity.propose`, asking what kind of thing the marked words name.
- 5c18768: Data Atlas used by and retraction: the entity page lists the intents bound to it (from Mandate's events, named by Mandate as the viewer, with the ones you can't open still shown) and the documents what's known of it came from. When Artifacts withdraws or deletes a document, what was read from it is kept but retracted, and says so. Data Atlas now asks for `events:subscribe`.

### Patch Changes

- 5b0478e: Data Atlas's Postgres tests allow 20 seconds each, so a busy CI runner doesn't fail them.
- Updated dependencies [f0d02e2]
- Updated dependencies [bbdad18]
  - @augur/service-kit@0.9.0
