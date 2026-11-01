# Data Atlas

It ships with AUGUR (a pillar app); [docs/atlas.md](../docs/atlas.md) covers running it in a deployment.

The things the organisation keeps track of (ships, ports, organisations, people, places, events) and what is known about them. Artifacts holds what was published, the intent app holds what people mean to do, and Data Atlas holds what those are about.

| Path | What it is |
| --- | --- |
| `manifest.json` | How the registry lists the app: its route, entry, the SDK range it works with |
| `frontend/` | The micro frontend the shell mounts at `/atlas` (`@apps/atlas-frontend`) |
| `service/` | The app's own API, reached through the gateway at `/api/atlas` (`@apps/atlas`) |

## What it keeps

- **Entities**, each with an `ent_` + ULID id for life, a kind from the ontology, a name, other names, a description and details. Details marked as identity keys (an IMO number, a UN/LOCODE) belong to one entity only, whatever its floor.
- **The ontology**: a starter profile of the [Common Core Ontologies](https://github.com/CommonCoreOntology/CommonCoreOntologies) (BSD-3). Each kind names the pack term it stands for, by IRI, so it exports as that. Admins change the ontology, for now, in the studio (see [The ontology](#the-ontology)).

## Fenced by floor

Every entity sits on the floor it was made on. A floor shows what is kept on it and on every floor above it, never below: the org floor shows only the org's, a team's floor its own, its parents' and the org's, and your own floor everything you can reach. Only the floor an entity is kept on can change it.

Nothing is hidden without saying so. Asking for an entity that doesn't show from where you stand answers 403 with `reason` (`elsewhere`: go to that floor; `kept`: not yours to see) and a sentence naming the floor and what to do. Adding an identity key someone else holds names the holder if you may see it, and otherwise says where it is kept.

## Running it

The graph lives in Postgres, in the `atlas` schema, and there is no in-memory stand-in: point `DATABASE_URL` at any Postgres 16 or later, then `pnpm dev:app atlas`. Tests need `DATABASE_URL` too (CI gives them one).

## API

Under `/api/atlas/v1`, on the floor in `X-Workspace-Id`:

| Route | |
| --- | --- |
| `GET /ontology` | The kinds of thing, their details and the ontology's version |
| `GET /entities/:id/used-by` | What uses an entity from here: intents bound to it (from Mandate's events, ids and roles, named by Mandate as the viewer) and the documents what's known of it came from |
| `GET /ontology/versions` | Every version: who made it, why, and the changes in it |
| `GET /ontology/owl` | The ontology as OWL in Turtle, each kind and link saying which pack term it is (`skos:exactMatch`) |
| `GET /ontology/packs`, `GET /ontology/packs/:id` | The packs to adopt from, and a pack's terms, each saying where it's kept here once adopted. Both say whether the caller may change the ontology, and why not |
| `POST /ontology/packs` | An admin loads a pack from OWL in Turtle (`turtle`, with `id`, `name`, `version`, `licence`); loading again under the same id replaces it |
| `POST /ontology/adopt` | An admin adopts a pack term (`pack`, `iri`) as a kind, detail or kind of link, saying what the pack doesn't (its parent, how a link reads backwards) |
| `POST /ontology/changes` | An admin adds or renames kinds, details and kinds of link: one new version |
| `GET /ontology/candidates` | Words sources asked for that the ontology hasn't got, most asked first; admins see them, everyone else how many wait |
| `POST /ontology/candidates/decide` | An admin adopts a candidate (as the change given) or dismisses it, for every proposal that asked |
| `GET /entities?q=&type=&limit=&offset=` | What shows from this floor, by name, other name or identity key; `type` takes its subtypes too. `seeing` names the floors it comes from |
| `POST /entities` | Adds one on this floor: `{ type, label, aliases?, description?, details? }` |
| `GET /entities/:id` | One entity, with `floorName` and `can` (`edit`, `retire`, and `why` when not) |
| `PATCH /entities/:id` | Changes it, from the floor it's kept on |
| `POST /entities/:id/retire` | Takes it out of use (that floor's leads, or whoever added it); its id stays and its keys are freed |
| `POST /entities/resolve` | For apps keeping entity links: `{ refs: [{ id }] }` (up to 200) → each as the caller sees it now: `{ id, ref, state, floorName }`, `{ id, hidden, reason, message }` or `{ id, missing }` |
| `POST /subgraph` | `{ seeds, depth ≤ 3, types?, relations?, asOf?, limitPerNode? }` → `{ nodes, edges, more, unseen, missing }` from this floor: links true at `asOf`, walked out to `depth` steps, at most `limitPerNode` from each entity, strongest first (the rest, and the links past the last ring, counted in `more` by relation and `direction`). Seeds always show; `types` narrows what the walk reaches. Each edge carries `disputed`, its open disputes. An entity at the far end that doesn't show from here is in `unseen`, with why and the shown entities it is `near` |
| `GET /entities/:id/knowledge?at=&known=` | What's known from this floor: `facts` (with `direction`, the `other` end of a link, `disputes`, and `can`), `observations` (with `can`: accept, raise and where to), and `here` (whether the caller may accept). `at` moves the valid clock, `known` the recorded one; both default to now |
| `POST /entities/:id/observations` | `{ property, value \| target, observedAt?, source, grade?, note?, accept? }`, recorded on this floor and never changed. `source` is `{ kind: 'person' }`, `{ kind: 'document', document: DocumentRef }` or `{ kind: 'other', note }`; `grade` is NATO style, such as `B2`; `accept` (leads) records it as a fact here in the same step |
| `POST /entities/:id/facts` | A lead accepts observations that agree as so on this floor: `{ backedBy, validFrom?, validTo?, note? }`. A detail has one value per floor at a time, so this replaces the floor's current record of it; links may be many |
| `POST /facts/:id/end` | A lead says when it stopped being so (`validTo`, default now): a new record, the old one superseded |
| `POST /facts/:id/withdraw` | A lead takes back a fact recorded in error; it stays on record as of before |
| `POST /facts/:id/disputes` | Anyone who sees a fact says why it may be wrong. Shown to those who see the disputer's floor, and to the fact's own floor |
| `POST /disputes/:id/clear` | Whoever raised it, or the fact's floor's leads |
| `POST /proposals` | A proposal from a source, filed in this floor's Triage: `{ source, mentions: [{ key, text, type?, anchor?, context?, keys? }], observations?: [{ key, about, property, value \| target, observedAt?, grade?, note?, anchor? }], terms? }`. Each mention comes back with the entities it may be (`matches`: by identity key, name or other name, a name spelt nearly alike (`similar`, with the name and a `score`), or meaning (`meaning`, with a `score`), from this floor), and the proposal says how they were found (`matching`, with `why` for anything not tried). Answers the proposal and the `queue` it went to |
| `GET /proposals?state=open\|closed` | This floor's Triage: `{ floorName, decide, why?, proposals }`, each with how many of its items are decided |
| `GET /proposals/:id` | One proposal: its `mentions` and `observations` with their decisions, `terms`, `left` to decide, and `can` (`decide`, `finish`, `withdraw`, and `why` when not) |
| `POST /proposals/:id/mentions/:key` | A lead decides what a mention names: `{ as: 'link', entity }`, `{ as: 'new', type, label? }` (made on this floor, with the mention's words as another name) or `{ as: 'drop' }` |
| `POST /proposals/:id/observations/:key` | A lead decides an observation once what it's about is decided: `{ as: 'accepted' \| 'seen' \| 'drop', grade?, observedAt?, note? }`. Accepted records an observation and a fact here; seen records the observation only |
| `POST /proposals/:id/match` | A lead looks again for what its undecided mentions may be, after entities were added or matching by meaning was turned on |
| `POST /proposals/:id/finish` | A lead closes it once nothing is left to decide |
| `POST /proposals/:id/withdraw` | Whoever made it, or a lead, takes it back; what was already decided stays |
| `POST /observations/:id/raise` | A lead copies an observation to a floor above that they're on: `{ to }`. The copy points back to it; the floor above decides whether to accept it |

Every change goes to the audit log as `entity.created`, `entity.changed` or `entity.retired`, and to other apps, through the outbox, as the domain events `atlas.entity.created`, `.changed` and `.retired` with `{ entity, type }`: ids only, so any follower may read them.

## What's known

Knowledge is fenced by floor like entities are (Harry, 27 October 2026). An **observation** is what someone saw or read, as they said it, with where it came from and an optional grade; it is never changed. A **fact** is what a floor's leads accept as so, resting on observations, on two clocks: when it is true in the world (`validFrom` to `validTo`) and when the floor recorded it (`recordedAt` until a later record supersedes it). A **link** is a fact whose value is another entity, of a kind the ontology allows (`operated-by`, `located-at`, …). Lower floors never leak up: a team's facts don't show on the org floor. A lead **raises** an observation to a floor above, where it is worth more, and that floor's leads decide whether to accept it. Ontology version 2 adds the starter links and details known only through facts (a vessel's flag), which can't be typed on the entity.

## Triage

Nothing becomes knowledge without a lead deciding (Harry, 27 October 2026; auto-accept waits for the agent runtime). Whatever reads a source, a person now and an extractor later, files a **proposal** in the Triage of the floor it's on: the source, the **mentions** it found (words that seem to name a thing, with the passage around them) and the **observations** it read about them. Data Atlas suggests what each mention may be, from what shows on that floor (**resolve**): by identity key, then the name or another name exactly, then names spelt nearly alike (pg_trgm, which the platform puts in every app's database), then meaning. Matching by meaning asks the model gateway for vectors (`models:use`, and an embedding model on the server: `MODEL_EMBEDDING_NAME`, see [docs/agents.md](../../docs/agents.md)) and keeps one per entity, from its name, kind, other names and description, beside the model that made it; it is done again when the entity changes. Each proposal says what was tried and, when matching by meaning or spelling wasn't, why (models off, no embedding model, Data Atlas not granted `models:use` on that floor). A lead of that floor says what each one is: one already known, a new one made on that floor, or nothing; then accepts each observation as so, keeps it as seen, or drops it, and finishes the proposal. Words the ontology hasn't got (`terms`) go to the admins as candidates in the studio and hold nothing up. In Artifacts, marking words in a document and choosing **Add to Data Atlas** sends a one-mention proposal through the `entity.propose` intent.

## Used by, and retraction

Data Atlas follows other apps' events (`events:subscribe`) and keeps its place in them. Mandate's `mandate.intent.entity-bound` and `-unbound` keep a **used by** index: Mandate's bindings stay the truth, and a binding never becomes a fact. The entity page asks Mandate to name those intents as the person (`POST /api/mandate/v1/refs/resolve`), so an intent they can't open still shows, saying which floor keeps it; when Mandate can't be asked, it says how many intents use the entity and why they can't be named.

When Artifacts withdraws or deletes a document (`folio.document.withdrawn`, `folio.document.deleted`), what was read from it is **retracted**: each observation stays as it was said, marked with why, and stops counting as evidence. It can't back a new fact; a fact resting only on retracted observations stays, saying so, until its floor's leads end or withdraw it; an entity whose only evidence was retracted is marked as having no current source and is never deleted. A proposal still waiting on that document says its source is gone, and what it says can only be dropped.

## The ontology

Everyone can read the ontology on its own page: the kinds, their details, the kinds of link, the packs they come from and every version. Admins change it there (Harry, 27 October 2026: admins govern it for now; more governance later), and anyone else sees the same page with the controls off and a line saying why. Kinds, details and kinds of link are only ever **added or renamed**, and a link's kinds only widen, so nothing already kept stops fitting. Each change is a new version, written to the audit log (`ontology.changed`) and told to other apps (`atlas.ontology.changed`).

**Packs** are vocabularies to adopt terms from (Harry's Q5: a military ontology, pluggable). A profile of CCO comes with Data Atlas; an org loads its own as OWL in Turtle, read with [N3.js](https://github.com/rdfjs/N3.js): the full CCO, or MIP MIM where it has it (MIP's licence is the org's to check, so it doesn't ship here). A pack's classes become kinds to adopt, its object properties kinds of link and its datatype properties details. Adopting fills in what the pack says (the parent, a link's kinds when they're kept here) and asks for the rest. **Candidates** are the words proposals asked for, gathered by kind and name however many times they were asked; adopting one tells every proposal that asked. The whole ontology exports as OWL, so it can go back into Protégé or another tool.

## Explore

`/explore/:id` draws the graph around one entity as seen from this floor, a ring at a time (one to three rings out). Each ring shows each entity's strongest links (those to the most linked entities) and folds the rest, and whatever lies past the last ring, into counts such as "+4 location of" that open in place; nothing loads the whole graph. An entity linked but not visible from here shows as "1 hidden" beside what it's linked to, with why. Kinds, links, "True on" and "Hide disputed" narrow it. Nodes are coloured by the floor they're kept on, as on the floor gauge. It is drawn with Sigma.js on graphology (WebGL), laid out by ForceAtlas2 in a Web Worker, and loaded only when the explorer opens; the same graph is always available as a list, which is also what browsers without WebGL get.

## Intents

Data Atlas handles the SDK's entity intents (SDK 1.5): `entity.pick` opens a picker over the asking app, narrowed to the `types` asked for, answering with one `EntityRef` (or a list, with `multiple`); `entity.open` opens the entity's page; `entity.explain` opens it with why it shows from this floor marked; `entity.propose` asks what kind of thing the marked words name and files them in the floor's Triage, answering with a `ProposalReceipt`. Everything is as seen from the floor the person stands on.
