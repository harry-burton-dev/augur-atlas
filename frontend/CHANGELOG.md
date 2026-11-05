# @apps/atlas-frontend

## 0.5.0

### Minor Changes

- 74da8e7: Data Atlas's frontend now runs on the app starters: `defineReactApp` mounts it, its places are `placeRoutes` (so the address bar follows the page and `entity.explain` opens with `?explain=true`), and it talks to its service through `createAppClient`, reading AUGUR's problem bodies as `AppError`. Needs app kit 0.8.
- fe4e347: The explorer can explore within an intent (PER-327). **Within an intent…** asks Mandate for an intent, then starts the walk from what it binds, as well as the centre, and dims everything else. It says what of the intent can't be shown, and why. When Mandate can't be asked on this floor, the button stays visible and says why.
- 57baa8b: Data Atlas follows the entity bindings of every app the registry lists (SDK 2.1, ADR 0066) instead of only Mandate's and Artifacts', each app and type from its own place (migration `014_binding_cursors`). An entity's **Used by** shows what any other app binds to it. This needs AUGUR with SDK 2.1 and Mandate and Artifacts releases that declare their bindings: until both are installed, "used by" stops updating.
- 4e67992: An identity key can change hands over time, as a vessel's MMSI does. In the studio, a new detail of text or a number can say which thing it is: always the same thing, or whoever holds it at the time. A key that changes hands is known through facts with dates. Only one entity holds a value at any time: a fact that would overlap another entity's holding is refused, naming who holds it and when. Searching by the key finds whoever holds it now. Migration `015_changing_keys`.
- 357f818: A detail known through facts can hold several values at once, such as a person's languages. Each value is its own fact, and accepting one doesn't replace the others. In the studio, a new detail says where it's **known**: typed on the entity, or through facts with one value or several at a time. Migration `017_many_details`.
- 8e87162: The map view (augur ADR 0071). An entity whose kind can be placed has **Where it is** on its page, and the explorer offers **Show on a map** for what's around. MapLibre GL JS and PMTiles draw it from the deployment's own base map, loaded only when a map first opens. Without a base map the points go on a plain background, saying why, and the points are always listed below the map for keyboards, screen readers and browsers without WebGL.
- 5d6ad1f: "Might be the same" on the entity page: up to five entities of its kind that may be the same real thing, found as Triage finds them (identity key, name, spelling, meaning), each saying why (`GET /v1/entities/:id/alike`). Whoever may decide what the entity is (its floor's leads, or whoever added it) can merge it into one from there, saying why; when they can't, the button stays and says why. Part of PER-326.
- b60a35e: A kind can carry a military symbol code (APP-6 or MIL-STD-2525, ADR 0070). Admins set it in the studio with **Change…**, which says before saving when a code can't be drawn. The symbol shows on the kind's row and on each of its entities' pages, drawn by milsymbol, which is only downloaded when a symbol is on screen. Kinds without a code keep their icon.
- c31f7ca: Details can hold more (PER-328). A **quantity** is a number in a unit, such as a gross tonnage in t. A **choice** is one of a few values, such as a vessel's status. A **place** is written as words for now. The studio asks a quantity for its unit and a choice for its values, and the entity form offers a choice's values to pick from. Quantities show with their unit.
- b3d644f: Raising an entity card to a floor above (PER-326). A lead asks a floor above to keep an entity made on their floor ("Floors above" on the entity page). The request waits in that floor's Triage, "Asked to keep here", where its leads keep it, say it's one they already have (the two are merged there), or decline with a note that whoever asked sees. Only the card moves; what's known of it stays on the floors it was recorded on. Migration `010_raises` adds `atlas.raises`.
- 887181c: Data Atlas names the organisation's floor by the organisation's name, as Admin sets it (identity's `GET /v1/organisation`), instead of "Org", and your own floor as "Your own floor" instead of "You". Entities and explorer nodes carry `floorKind` (`org`, `own`, `personal`, `team`), and the words, rights and colours that depend on a floor follow its kind, never its name. When identity can't be asked, the floor is called "The organisation". Part of PER-325.
- 342baca: Data Atlas checks what it keeps against SHACL shapes written from its ontology (ADR 0062). The studio has a Checks tab that checks the entities in sight a page at a time and saves the shapes as Turtle, and an entity that doesn't fit says so on its page, in the same words the checks on writing use.
- 281ab14: Kinds and details can be kept for one team's floor. In the studio, an admin standing on a team's floor chooses **Kept for**: the whole organisation, or that team and the teams under it. A team's kind shows only from that team down, and nobody records one where it doesn't show. **Make it the organisation's** widens it, the only way it changes floor. Migration `016_team_terms`.
- c197322: In Triage, a lead can say that two of a mention's matches are the same thing (PER-326). **These two are the same…** asks which one stays, and why, then places the other under it. The mention then offers the one that stays, once. The merge can be undone from either entity's page.

### Patch Changes

- fe4e347: What Data Atlas knows "now" is read by the database's clock, the same one that stamps when a fact was recorded or withdrawn. A fact withdrawn a moment ago no longer shows as current for that moment.
- f4ad34e: A `run/` module for AUGUR's run suite: RUN-20 looks up each entity the seed puts on the organisation's floor by its name and other names, opens it, and checks it says what uses it.
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

## 0.2.2

### Patch Changes

- e26db4b: Data Atlas is built and released from its own repository now, signed by this repository's release workflow. Nothing changes for people using it.

## 0.2.1

### Patch Changes

- Updated dependencies [9e021dd]
  - @augur/app-kit@0.3.0

## 0.2.0

### Minor Changes

- ebd0cfb: Data Atlas is on React and Quill (PER-243): the list, an entity with what's known and what uses it, the explorer, Triage, the ontology, and its answers to `entity.pick` and `entity.propose`, with the same words and limits. It no longer uses the Lit kit, and it now has the rail every app has: Everything here, Triage and Ontology.

### Patch Changes

- Updated dependencies [527a413]
- Updated dependencies [f8e9b46]
- Updated dependencies [da54ae3]
- Updated dependencies [7c8027d]
- Updated dependencies [d500567]
- Updated dependencies [a8854e2]
- Updated dependencies [fccb126]
- Updated dependencies [d64d724]
  - @augur/app-kit@0.2.0
  - @augur/mfe-sdk@1.10.0

## 0.1.5

### Patch Changes

- Updated dependencies [2a05a51]
- Updated dependencies [4c1bb55]
- Updated dependencies [5ab5009]
  - @augur/ui-kit@1.8.0
  - @augur/mfe-sdk@1.9.0

## 0.1.4

### Patch Changes

- Updated dependencies [bb91780]
- Updated dependencies [bef7098]
- Updated dependencies [e0e9c83]
  - @augur/mfe-sdk@1.8.0
  - @augur/ui-kit@1.7.0

## 0.1.3

### Patch Changes

- Updated dependencies [5b2c80c]
  - @augur/mfe-sdk@1.7.0

## 0.1.2

### Patch Changes

- effebfe: App kit, part 2: the frame. New `ui-app-frame` (the slate ground, a rail, the main column and an aside), `ui-page-head` (the trail of what a page is inside, its title, one line of summary, and two actions with the rest in ⋯) and `ui-section` (a labelled part with its count, one action and a why, folding after five). New token `measure-rail` (240px). Type tokens are now emitted in rem, so a person's browser text size scales them. Artifacts, Mandate, Data Atlas and Auspex use the frame and page head instead of their own grids, heads and trails.
- 84fab17: App kit, part 3: more at a glance. New `ui-card` and `ui-cards` (one thing in a grid, its floor shown as a dot and a name, with at most one line that matters; unavailable cards stay and say why), `ui-tally` (counts as segments, saying only what needs attention), `ui-details` (label and value, unknowns said, folding after eight), `ui-timeline` (history grouped by day in words) and `ui-path` (line of sight down the floors). Mandate's intent cards drop the coloured edge stripe for the floor dot and gain a tally of the parts below; its line of sight and history use `ui-path` and `ui-timeline`. Data Atlas shows an entity's, a fact's and an observation's details with `ui-details`.
- 2c9caf0: App kit, part 1: nothing is obtuse. `ui-button` and `ui-icon-button` take a `reason`: disabled with one, they stay focusable and say why on hover and focus, and it's read aloud. List rows, list actions and menu entries take a `reason` too. The kit warns on localhost about a disabled control without one, and `pnpm check:reasons` fails a platform screen that has one. New parts: `ui-notice` (one sentence that needs attention, with one action), `ui-note` (a quiet line with its `why` one press away) and `ui-can` (what you can do here, and who can do the rest). Every disabled control in Admin, the shell, Artifacts, Mandate and Data Atlas now says why, and ones that were only waiting for a request show as busy instead.
- b716037: App kit, part 4: references. New `ui-ref` (a thing from any app as a chip: its kind's icon, its name, a floor dot when it's kept on another floor; it opens where you are, and can be removed) and `ui-refs` (a row of them, counting the ones you can't open with where they're kept and who to ask). Mandate's bound entities and context documents, and Data Atlas's links in the explorer and Triage's outcome, use them instead of underlined text buttons.
- 2487ae0: App kit, part 5: the writing kit. New `ui-date` (a day said and typed in words, with quick choices and the calendar one press away), `ui-people-picker` (people and teams by name; ones that can't be added stay and say why), `ui-editor` (Markdown without a toolbar at rest: a bar on a selection, Ctrl B and Ctrl I, `@` and `#` mentions saved as references, and a soft length guide) and `ui-prose` (shows what the editor writes, safely). Data Atlas's seven date fields and Mandate's "Done by" use `ui-date`, and Mandate says its dates in words. Artifacts' share dialog finds people with `ui-people-picker`. Mandate's statement, back-brief and concern are written in `ui-editor` and shown with `ui-prose`. Timeline days with a year no longer carry a stray comma.
- Updated dependencies [effebfe]
- Updated dependencies [84fab17]
- Updated dependencies [2c9caf0]
- Updated dependencies [b716037]
- Updated dependencies [2487ae0]
  - @augur/ui-kit@1.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [d68128b]
- Updated dependencies [7ee3531]
- Updated dependencies [d52bfce]
- Updated dependencies [a9cfcf7]
  - @augur/ui-kit@1.5.0
  - @augur/mfe-sdk@1.6.0

## 0.1.0

### Minor Changes

- d324552: Data Atlas, first step: entities on a Common Core Ontologies starter vocabulary, fenced by floor, added and changed by hand, with an entity page that says why something can't be seen or done. The kit gains icons for kinds of thing: atlas, vessel, aircraft, vehicle, place, port, facility and event.
- 5ff1f5e: Data Atlas explorer: walk the graph around an entity a ring at a time, drawn with Sigma.js and laid out in a worker, with folds that open, hidden counts that say why, kinds, links, "True on" and "Hide disputed", and the same graph as a list. The subgraph keeps the strongest links first, always keeps its seeds, counts what lies past the last ring by relation and direction, says how many open disputes each link has, and says what each hidden entity is near.
- 740d63b: Data Atlas knows things about entities, fenced by floor: observations (what someone saw or read, with its source and grade, never changed), facts a floor's leads accept from them on two clocks (true from and until, and when recorded), links between entities, disputes, and raising an observation to a floor above. The entity page shows what's known, "true on" and "as recorded by" any day, and the subgraph now walks links.
- 3c085c0: Data Atlas ontology studio: an Ontology page everyone can read (kinds, details, kinds of link, packs and every version) where admins adopt terms from packs, decide the words sources asked for, and add or rename their own. A profile of the Common Core Ontologies comes with it; an org loads its own pack (the full CCO, MIP MIM) as OWL in Turtle. The ontology exports as OWL.
- bbdad18: Data Atlas resolve: Triage suggests entities whose names are spelt nearly alike (pg_trgm) and, through the model gateway's embeddings, those close in meaning, after identity keys and exact names. Each proposal says how its mentions were matched and why anything wasn't tried, and a lead can look again. Data Atlas now asks for `models:use`.
- 778b6f9: Data Atlas keeps the shared entity contract: it handles `entity.pick` (a picker over the asking app), `entity.open` and `entity.explain`; answers `POST /v1/entities/resolve` and `POST /v1/subgraph` as seen from the caller's floor; finds several kinds at once; and tells other apps `atlas.entity.created`, `.changed` and `.retired` through its outbox.
- 513e2e9: Data Atlas Triage: proposals from a source (mentions and observations) are filed in the floor's Triage with suggested matches, and its leads decide what each mention names (one already known, a new one, or nothing) and whether each observation is accepted, kept as seen or dropped. Data Atlas handles `entity.propose`, asking what kind of thing the marked words name.
- 5c18768: Data Atlas used by and retraction: the entity page lists the intents bound to it (from Mandate's events, named by Mandate as the viewer, with the ones you can't open still shown) and the documents what's known of it came from. When Artifacts withdraws or deletes a document, what was read from it is kept but retracted, and says so. Data Atlas now asks for `events:subscribe`.

### Patch Changes

- 1580b6b: Menu icons no longer repeat what they sit under: each app's menu group and first page now have their own icon instead of the app's.
- Updated dependencies [1580b6b]
- Updated dependencies [d324552]
- Updated dependencies [18bf27c]
- Updated dependencies [f01fcea]
- Updated dependencies [8f69cb5]
- Updated dependencies [b556614]
- Updated dependencies [513e2e9]
- Updated dependencies [feeffdd]
- Updated dependencies [ae92eed]
- Updated dependencies [778b6f9]
- Updated dependencies [513e2e9]
- Updated dependencies [28d8775]
  - @augur/mfe-sdk@1.5.0
  - @augur/ui-kit@1.4.0
