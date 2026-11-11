# @apps/atlas

## 0.5.0

### Minor Changes

- 64a3094: Data Atlas starts again on the app contract (contract 3). It reads the knowledge graph as the person, through the gateway (`knowledge:read`), and shows each thing in the kit's one shape: what it is, the answer (Now, Next, What or When), what's wrong, key facts and what is around it, each line with whose report and when. A find box opens things by name. The SDK 1 and 2 app it replaces, with its own facts database, is gone: Data Atlas keeps none of the graph.
- a9286cf: A thing's page now leads one step on to everything known of it: what is known now, what it is linked to both ways, and what was true before, each line with when it was said and on how many reports. Its actions work. "Keep an eye on it" is kept in Data Atlas's own table, per floor, and the page says so. "Something's wrong" picks a line, takes a reason and disputes it in the knowledge graph as the person (`knowledge:act`), once per press. "Ask about it" and "Send this" stay on the page and say why they aren't here yet.

  The Backstage catalog now lists the knowledge API among what the service calls (app tools 0.6.0).

- bbec42c: Data Atlas opens on a door gallery: "What do you need?" on top finds a thing, and below it four ways in. "See what has changed" lights up when something you keep an eye on has new lines, "Put something right" when a thing on your floor has two answers at once, and "Keep an eye on something" lists what you follow. "Get ready for a meeting" stays and says AUGUR has no calendar yet. The shell lights each door from what Data Atlas read; the doors are configuration in `service/src/home.ts`, so adding one is adding it there. Finding a thing moves to `/find`.
- 9cd5e22: What is around a thing is now ranked by use too (Data Atlas PDR-002). When someone opens a thing from another thing's page, Data Atlas counts the link they followed, for that kind of thing on that floor. It keeps only counts, never who. Once things have been opened five times from a kind's pages, a link that led to them rises, up to three times its cold-start rank when it led to every one. Until then the cold-start ranking holds.

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
