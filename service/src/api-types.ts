/**
 * Data Atlas's wire types: what crosses between its frontend and this service, written once.
 *
 * The service owns the API, so the file lives here; the frontend imports it with `import type` by relative
 * path (`../../service/src/api-types`). Types only: nothing here runs, so neither build changes. Keep it free
 * of imports, so the frontend's typecheck never pulls in the service's own modules.
 *
 * Where the service keeps a record under the same name as what the page is sent, the page's shape is a
 * `...View` here (`EntityView`, `DisputeView`); the frontend's api.ts gives it the shorter name it uses.
 */

// ---- the ontology ----

/** What a detail holds. More kinds (quantities, places, links) come with facts. */
export type DetailKind = 'text' | 'number' | 'date';

export interface DetailDef {
  key: string;
  label: string;
  kind: DetailKind;
  /** Says which real thing it is: no two entities may share a value, whatever their floor. */
  identity: boolean;
  /** What a value must look like, as a regular expression over the whole value. */
  pattern?: string;
  /** How a person would recognise one, shown under the field. */
  hint?: string;
  /**
   * False for a detail known only through facts, over time and floor by floor
   * (a vessel's flag), rather than typed on the entity itself. Absent means true.
   */
  onEntity?: boolean;
  /** The pack term it was adopted from, by IRI (AT7). */
  packIri?: string;
}

/**
 * A kind of link from one entity to another: "operated by", "located at". A
 * link is a fact whose value is an entity, so it has the same two clocks, floor
 * and backing as any fact. Read backwards, it uses `inverse`.
 */
export interface RelationDef {
  key: string;
  label: string;
  inverse: string;
  /** Kinds it may start from, and end at; each takes its subkinds too. */
  from: string[];
  to: string[];
  pack: string;
  packTerm: string;
  packIri?: string;
}

export interface TypeDef {
  key: string;
  label: string;
  plural: string;
  /** The kind it is a kind of. */
  parent?: string;
  /** Only a heading for the kinds below it: no entity is made of it directly. */
  abstract: boolean;
  /** A ui-kit icon name. */
  icon: string;
  /** The ontology pack it comes from, and the pack's own name for it. */
  pack: string;
  packTerm: string;
  packIri?: string;
  details: DetailDef[];
}

/**
 * One change an admin makes to the ontology in the studio (AT7). Kinds, details
 * and kinds of link are only ever added or renamed, never taken away or
 * narrowed, so nothing already kept stops fitting it.
 */
export type OntologyChange =
  | { op: 'add-type'; type: Omit<TypeDef, 'details'> }
  | { op: 'edit-type'; key: string; label?: string; plural?: string; icon?: string }
  | { op: 'add-detail'; type: string; detail: DetailDef }
  | { op: 'edit-detail'; type: string; key: string; label?: string; hint?: string }
  | { op: 'add-relation'; relation: RelationDef }
  | { op: 'edit-relation'; key: string; label?: string; inverse?: string; from?: string[]; to?: string[] };

/** `GET /ontology`. */
export interface Ontology {
  version: number;
  types: TypeDef[];
  relations: RelationDef[];
}

/** A version of the ontology: who made it, why, and what changed. */
export interface OntologyVersion {
  version: number;
  note: string;
  /** Absent for those that came with Data Atlas. */
  changedBy?: string;
  changes: OntologyChange[];
  madeAt: string;
}

/** What the ontology studio's changes answer: the new version, and the ontology as it now is. */
export interface OntologyChanged {
  version: number;
  ontology: Ontology;
}

/** Whether the person may change the ontology, and why not. */
export interface Governs {
  govern: boolean;
  why?: string;
}

export interface PackTerm {
  iri: string;
  kind: 'class' | 'relation' | 'detail';
  label: string;
  /** For a class: the class it is a kind of, by IRI. */
  parent?: string;
  /** For a property: the classes it runs from and to, by IRI. */
  domain?: string[];
  range?: string[];
  /** What the pack says it is (rdfs:comment or skos:definition). */
  note?: string;
  /** Where it's kept here, when it has been adopted: a kind's or link's key, or kind.detail. Only on `GET /ontology/packs/:id`. */
  adopted?: string;
}

/** An ontology pack: a vocabulary admins adopt terms from. */
export interface Pack {
  /** Short and stable: "cco", "mip-mim". */
  id: string;
  name: string;
  version: string;
  /** What it may be used under, as the pack says, so admins can check before loading it. */
  licence: string;
  /** Where it came from: a URL, or "uploaded by an admin". */
  source: string;
  terms: PackTerm[];
}

/** `GET /ontology/packs/:id`: a pack with its terms, and whether it came with Data Atlas. */
export type PackView = Pack & { builtIn: boolean };

/** A pack as listed: what it is, without its terms. */
export type PackSummary = Omit<Pack, 'terms'> & { terms: number; builtIn: boolean; loadedBy?: string; loadedAt: string };

/** `GET /ontology/packs`. */
export type Packs = Governs & { packs: PackSummary[] };

/** What `POST /ontology/packs` answers: the pack loaded, with how many terms it has. */
export type PackLoaded = Omit<PackSummary, 'builtIn' | 'loadedBy' | 'loadedAt'>;

/** `POST /ontology/packs`: loads a pack from Turtle, or a newer copy of one loaded before. */
export interface PackUpload {
  id: string;
  name: string;
  version: string;
  licence: string;
  source?: string;
  turtle: string;
}

/** A term sources keep asking for that the ontology hasn't got, however many times, from wherever, and where adopting it would start. */
export interface TermCandidate {
  kind: ProposedTerm['kind'];
  name: string;
  /** How many proposals asked for it, and when first and last. */
  asked: number;
  firstAt: string;
  lastAt: string;
  parents: string[];
  note?: string;
  start: OntologyChange;
}

/** `GET /ontology/candidates`. Only admins see what the candidates are; everyone else is told how many wait. */
export type Candidates = Governs & { waiting: number; candidates: TermCandidate[] };

/** What an admin may say when adopting a pack term, over what the pack gives. */
export interface Adoption {
  pack: string;
  iri: string;
  key?: string;
  label?: string;
  plural?: string;
  icon?: string;
  parent?: string;
  /** For a detail: the kind it's of, and what it holds. */
  type?: string;
  kind?: DetailKind;
  from?: string[];
  to?: string[];
  inverse?: string;
}

/** `POST /ontology/candidates/decide`: adopts a candidate term as the change given, or dismisses it. */
export interface CandidateDecision {
  kind: TermCandidate['kind'];
  name: string;
  as: 'adopt' | 'dismiss';
  /** For `adopt`: the change to make. */
  change?: OntologyChange;
  note?: string;
}

// ---- entities ----

/**
 * A real thing Data Atlas keeps: a vessel, an organisation, a place. It's kept
 * on one floor (`floor`, a principal), which decides who sees it from where.
 */
export interface Entity {
  /** `ent_` and a ULID. */
  id: string;
  type: string;
  label: string;
  /** Other names it goes by, such as a former name or a short one. */
  aliases: string[];
  description: string;
  /** Its details by key, as the ontology names them (`imo`, `mmsi`). */
  details: Record<string, string>;
  /** The floor it was made on. */
  workspace: string;
  /** Who that floor lets in: `person:<owner>`, `tree:<team>` or `org`. */
  floor: string;
  /** `merged`: found to be the same as another entity and placed under it (`GET /entities/:id/merges` says which, why and on what evidence). */
  state: 'active' | 'retired' | 'merged';
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

/** What the caller may do with an entity, so the app offers only what will work, and says why not otherwise. */
export interface EntityRights {
  /** Change its name, other names, description and details: anyone standing on the floor it's kept on. */
  edit: boolean;
  /** Take it out of use: that floor's leads, or whoever made it. */
  retire: boolean;
  /** When it can't be changed from here, why, in words. */
  why?: string;
}

/**
 * What kind of floor something is kept on, from where the caller stands: the
 * org's, their own, someone else's own, or a team's. Words and marks follow
 * this, never a floor's name, since names differ in every deployment.
 */
export type FloorKind = 'org' | 'own' | 'personal' | 'team';

/** The words for a floor that has no name of its own, or whose name couldn't be asked for. */
export const FLOOR_WORDS = {
  own: 'Your own floor',
  someonesOwn: 'Someone’s own floor',
  unnamedTeam: 'A team',
  unnamedOrg: 'The organisation',
} as const;

/** An entity as the caller sees it: with the name and kind of the floor it's kept on (the org's name, your own floor, a team's name) and what they may do. */
export type EntityView = Entity & { floorName: string; floorKind: FloorKind; can: EntityRights };

/** `GET /entities`: what shows from this floor. */
export interface EntityList {
  entities: EntityView[];
  total: number;
  floors: string[];
  seeing: string[];
}

/** `POST /entities` takes `type` and `label` too; `PATCH /entities/:id` takes any of the rest. */
export interface EntityFields {
  type?: string;
  label?: string;
  aliases?: string[];
  description?: string;
  details?: Record<string, string>;
}

/**
 * Why something can't be seen from here, said plainly, never hidden
 * (Harry's rule: explain, never hide).
 */
export interface Unseen {
  /** `elsewhere`: theirs to see from another floor; `kept`: not theirs to see. */
  reason: 'elsewhere' | 'kept';
  /** Where it is kept, as a principal. */
  floor: string;
  message: string;
}

/** The other end of a link, as the caller may see it: the entity, or why not. */
export type OtherEnd =
  | { kind: 'entity'; id: string; type: string; label: string; state: Entity['state']; floorName: string }
  | ({ id: string; hidden: true } & Unseen)
  | { id: string; missing: true };

// ---- what's known ----

/** Where an observation came from. A document is named by the SDK's DocumentRef (`folio` for Artifacts). */
export type Source =
  | { kind: 'person' }
  | { kind: 'document'; document: { app: string; id: string; version?: string; title: string }; anchor?: string }
  | { kind: 'other'; note: string };

/** What can be done with a fact from here, and why not. */
export interface FactRights {
  end: boolean;
  withdraw: boolean;
  dispute: boolean;
  why?: string;
}

/** What can be done with an observation from here, and why not. */
export interface ObservationRights {
  accept: boolean;
  raise: boolean;
  /** The floors above it can be raised to, by principal and name. */
  raiseTo: { floor: string; name: string }[];
  why?: string;
}

/**
 * Something someone saw or read about an entity, kept as it was said: never
 * changed, never removed. It sits on the floor it was recorded on; a lead may
 * raise a copy to a floor above, where it is worth more (Harry's Q2 answer).
 */
export interface Observation {
  /** `obs_` and a ULID. */
  id: string;
  entity: string;
  /** A detail's key, or a link's (`operated-by`). */
  property: string;
  /** For a detail. */
  value?: string;
  /** For a link: the entity at the other end. */
  target?: string;
  /** When it was seen to be so; without it, when it was recorded. */
  observedAt?: string;
  floor: string;
  workspace: string;
  source: Source;
  /** NATO-style grading: the source's reliability (A to F), then the information's credibility (1 to 6), such as "B2". */
  grade?: string;
  note: string;
  /** The intent it was reported under (an intent app's ref), reserved for the intent app. */
  reportedUnder?: unknown;
  /** The observation this is a raised copy of. */
  raisedFrom?: string;
  createdBy: string;
  createdAt: string;
  /** Its source was withdrawn or deleted: it's kept, but no longer counts as evidence. */
  retracted?: { at: string; why: string };
  /** It misled a merge that was undone: it's kept where it is, saying who found it wrong and why. */
  discredited?: { at: string; by: string; why: string };
}

/**
 * What a floor accepts as so, with two clocks: when it is true in the world
 * (`validFrom` to `validTo`, either open) and when the floor recorded it
 * (`recordedAt`, until `supersededAt` when a later record replaces it). Records
 * are never changed: ending or correcting one writes a new record.
 */
export interface Fact {
  /** `fct_` and a ULID. */
  id: string;
  entity: string;
  property: string;
  value?: string;
  target?: string;
  validFrom?: string;
  validTo?: string;
  floor: string;
  workspace: string;
  /** The observations it rests on. */
  backedBy: string[];
  note: string;
  recordedAt: string;
  supersededAt?: string;
  supersededBy?: string;
  createdBy: string;
}

/** Someone saying a fact may be wrong, and why. It stays until they, or the fact's floor's leads, clear it. */
export interface Dispute {
  id: string;
  fact: string;
  floor: string;
  note: string;
  by: string;
  at: string;
  clearedBy?: string;
  clearedAt?: string;
}

/** Someone saying a fact may be wrong, as the caller sees it. */
export type DisputeView = Dispute & {
  floorName: string;
  /** The caller raised it. */
  mine: boolean;
};

/** A fact as the caller sees it: what a floor accepts as so, on two clocks. */
export type FactView = Fact & {
  /** `in` when this entity is the far end of someone else's link. */
  direction: 'out' | 'in';
  other?: OtherEnd;
  floorName: string;
  disputes: DisputeView[];
  can: FactRights;
  /** Every observation it rests on was retracted, said in words. */
  unbacked?: string;
};

/** An observation as the caller sees it: what someone saw or read, as they said it. */
export type ObservationView = Observation & {
  direction: 'out' | 'in';
  other?: OtherEnd;
  floorName: string;
  /** The floors it has been raised to, by name. */
  raisedTo: string[];
  can: ObservationRights;
};

/** `GET /entities/:id/knowledge`: what's known about an entity, true at `at`, as recorded by `known`. */
export interface Knowledge {
  at: string | null;
  known: string | null;
  /** What the person may do on the floor they stand on: leads accept and raise. */
  here: { floorName: string; accept: boolean; why?: string };
  facts: FactView[];
  observations: ObservationView[];
  /** Everything known of it here came from sources since withdrawn. */
  noCurrentSource?: string;
}

/** `POST /entities/:id/observations`: what someone saw or read. A lead may accept it as a fact in the same step. */
export interface ObservationBody {
  property: string;
  value?: string;
  target?: string;
  observedAt?: string;
  source: Source;
  grade?: string;
  note?: string;
  reportedUnder?: unknown;
  accept?: boolean;
}

/** What `POST /entities/:id/observations` answers: the record, and the fact when a lead accepted it in the same step. */
export interface Observed {
  observation: Observation;
  fact?: Fact;
}

/** What `POST /observations/:id/raise` answers: the raised copy, and the name of the floor it went to. */
export type Raised = Observation & { floorName: string };

/** `POST /entities/:id/facts`: a fact accepted on the floor the caller stands on. */
export interface FactBody {
  backedBy: string[];
  validFrom?: string;
  validTo?: string;
  note?: string;
}

/** A document observations of an entity came from, as far as the caller can see. */
export interface MentionedIn {
  app: string;
  id: string;
  title: string;
  observations: number;
  lastAt: string;
  /** Every observation from it was retracted: it was withdrawn or deleted. */
  withdrawn: boolean;
}

/** `GET /entities/:id/used-by`: intents bound to it (ids, named by Mandate) and documents what's known came from. */
/** An observation a merge rests on, or one that weighs against it. */
export interface MergeCite {
  observation: string;
  stance: 'for' | 'against';
  note: string;
}

/**
 * Two entities found to be the same thing (PER-319, augur-atlas decision 0001).
 * The junior is placed under the senior and nothing moves: its facts,
 * observations, links and keys stay its own, so undoing the merge brings it
 * back exactly as it was, with the same id. The merge keeps who decided, why
 * and on what evidence, for and against; an undo keeps who and why too.
 */
export interface EntityMerge {
  /** `mrg_` and a ULID. */
  id: string;
  junior: string;
  senior: string;
  /** The floor it was decided on (the junior's). */
  floor: string;
  why: string;
  cites: MergeCite[];
  decidedBy: string;
  decidedAt: string;
  undone?: { by: string; at: string; why: string; discredited: string[] };
}

export interface MergeBody {
  /** The entity it is the same as, which stays. */
  into: string;
  why: string;
  cites?: { observation: string; stance: 'for' | 'against'; note?: string }[];
}

export interface UndoMergeBody {
  why: string;
  /** Observations the merge cited for it that turned out to mislead: marked, never removed. */
  discredit?: string[];
}

/** An entity's merges, either way: what was placed under it, and what it is placed under. */
export interface EntityMerges {
  /** The standing merge that placed it under another entity, if any. */
  placedUnder?: EntityMerge;
  merges: EntityMerge[];
}

export interface EntityUses {
  intents: { app: string; id: string; role: string; since: string; floorName?: string }[];
  /** Records in another app linked to it: a library, folder or document, by its level of the shape (a file is a document). */
  records: { app: string; id: string; level: string; role: string; since: string; floorName?: string }[];
  documents: MentionedIn[];
}

// ---- Triage ----

/** Words in a source that seem to name a thing. */
export interface Mention {
  key: string;
  text: string;
  /** What kind of thing the source seems to say it is. */
  type?: string;
  /** The block it's in, by its anchor. */
  anchor?: string;
  /** The words around it. */
  context?: string;
  /** Identity keys the source gives, e.g. { imo: "9400117" }. */
  keys?: Record<string, string>;
}

/** Something the source seems to say about a mention: a detail, or a link to another mention. */
export interface ProposedObservation {
  key: string;
  /** The mention it's about, by key. */
  about: string;
  property: string;
  value?: string;
  /** The mention it links to, by key. */
  target?: string;
  observedAt?: string;
  grade?: string;
  note?: string;
  anchor?: string;
}

/** Vocabulary the source wanted that the ontology hasn't got: for admins, in the studio's candidates (AT7). */
export interface ProposedTerm {
  key: string;
  kind: 'type' | 'detail' | 'relation';
  name: string;
  parent?: string;
  note?: string;
}

/** `POST /proposals`: one source's worth of what it seems to say. */
export interface NewProposal {
  source: Source;
  mentions: Mention[];
  observations?: ProposedObservation[];
  terms?: ProposedTerm[];
}

/** An existing entity a mention may be, and why it was offered. */
export interface Match {
  entity: string;
  /** In the order they're tried: an identity key, the name or another name exactly, a name spelt nearly alike, or meaning. */
  why: 'key' | 'name' | 'alias' | 'similar' | 'meaning';
  /** For a key: which one, e.g. "IMO number". For a similar spelling: the name it's like. */
  detail?: string;
  /** For similar spelling and meaning: how close, from 0 to 1. */
  score?: number;
}

/** A match as the caller sees it: the entity named. Those not showing from here, or retired, aren't offered. */
export type MatchView = Omit<Match, 'entity'> & { entity: Extract<OtherEnd, { kind: 'entity' }> };

/** How a proposal's mentions were matched, so Triage can say what was and wasn't tried, and why. */
export interface Matching {
  /** Names spelt nearly alike (pg_trgm). */
  spelling: boolean;
  /** Meaning (embeddings through the model gateway). */
  meaning: boolean;
  /** Why something wasn't tried, in words. */
  why?: string;
  at: string;
}

/** Who or what made a proposal. Only people do in v1; the extractor and agent runs come later. */
export type Producer = { kind: 'person'; id: string } | { kind: 'extractor'; engine: string; model?: string } | { kind: 'run'; id: string };

/** One source's worth of what it seems to say, waiting on a floor's leads in Triage. */
export interface Proposal {
  id: string;
  floor: string;
  workspace: string;
  source: Source;
  producer: Producer;
  ontologyVersion: number;
  state: 'open' | 'finished' | 'withdrawn';
  createdBy: string;
  createdAt: string;
  closedBy?: string;
  closedAt?: string;
  /** How its mentions were last matched; absent on proposals from before matching was said. */
  matching?: Matching;
  /** Its source was withdrawn or deleted while it waited, said in words. */
  sourceGone?: string;
}

/** A proposal as listed in Triage: how much of it is decided. */
export interface ProposalSummary extends Proposal {
  items: number;
  decided: number;
}

/** `GET /proposals`: this floor's Triage. */
export interface Triage {
  floorName: string;
  decide: boolean;
  why?: string;
  proposals: ProposalSummary[];
}

/** What can be done with a proposal from here, and why not. */
export interface ProposalRights {
  decide: boolean;
  finish: boolean;
  withdraw: boolean;
  why?: string;
}

export type MentionView = Mention & {
  matches: MatchView[];
  decision?: { as: 'link' | 'new'; entity: OtherEnd } | { as: 'drop' };
  decidedBy?: string;
  decidedAt?: string;
};

export type ProposalObservationView = ProposedObservation & {
  decision?: { as: 'seen'; observation: string } | { as: 'accepted'; observation: string; fact: string } | { as: 'drop' };
  decidedBy?: string;
  decidedAt?: string;
  /** Whether it can be decided yet, and why not. */
  ready: boolean;
  why?: string;
};

/** `GET /proposals/:id`, and what each decision answers: the proposal as the caller sees it. */
export interface ProposalView extends Proposal {
  floorName: string;
  left: number;
  mentions: MentionView[];
  observations: ProposalObservationView[];
  terms: ProposedTerm[];
  can: ProposalRights;
}

/** `POST /proposals/:id/mentions/:key`: which entity a mention is, a new one, or none. */
export type MentionDecisionBody = { as: 'link'; entity: string } | { as: 'new'; type?: string; label?: string } | { as: 'drop' };

/** `POST /proposals/:id/observations/:key`. */
export interface ObservationDecisionBody {
  as: 'accepted' | 'seen' | 'drop';
  grade?: string;
  observedAt?: string;
  note?: string;
}

// ---- the graph ----

/** `POST /subgraph` (the page sends `seeds` as `{ id }` refs). */
export interface SubgraphQuery {
  seeds: string[];
  depth?: number;
  types?: string[];
  relations?: string[];
  asOf?: string;
  limitPerNode?: number;
}

export interface GraphNode {
  ref: { kind: 'entity'; id: string; type: string; label: string };
  state: Entity['state'];
  floorName: string;
  floorKind: FloorKind;
  depth: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  floorName: string;
  validFrom?: string;
  validTo?: string;
  /** Its open disputes that show from here. */
  disputed: number;
}

/** Links of one relation from an entity that weren't drawn: too many, or past the last ring. */
export interface Fold {
  entity: string;
  relation: string;
  /** `out` when the entity is the link's subject ("operated by"), `in` when it's the object ("operates"). */
  direction: 'out' | 'in';
  count: number;
}

export interface GraphUnseen extends Unseen {
  id: string;
  /** The shown entities it is linked to. */
  near: string[];
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  more: Fold[];
  unseen: GraphUnseen[];
  missing: string[];
}

/** What the service sends when it refuses: a code and words people can act on, sometimes with more said about it. */
export interface Problem {
  error: string;
  message: string;
}
