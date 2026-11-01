# @apps/atlas-frontend

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
