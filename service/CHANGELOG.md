# @apps/atlas

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
