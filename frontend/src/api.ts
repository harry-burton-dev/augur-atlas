import type { MountContext } from '@augur/mfe-sdk';

export interface DetailDef {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'date';
  identity: boolean;
  pattern?: string;
  hint?: string;
  /** False when it's known only through facts, not typed on the entity. */
  onEntity?: boolean;
  /** The pack term it was adopted from, by IRI. */
  packIri?: string;
}

/** A kind of link from one entity to another, read forwards (`label`) or backwards (`inverse`). */
export interface RelationDef {
  key: string;
  label: string;
  inverse: string;
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
  parent?: string;
  abstract: boolean;
  icon: string;
  pack: string;
  packTerm: string;
  packIri?: string;
  details: DetailDef[];
}

/** One change an admin makes to the ontology: kinds, details and links are added or renamed, never taken away. */
export type OntologyChange =
  | { op: 'add-type'; type: Omit<TypeDef, 'details'> }
  | { op: 'edit-type'; key: string; label?: string; plural?: string; icon?: string }
  | { op: 'add-detail'; type: string; detail: DetailDef }
  | { op: 'edit-detail'; type: string; key: string; label?: string; hint?: string }
  | { op: 'add-relation'; relation: RelationDef }
  | { op: 'edit-relation'; key: string; label?: string; inverse?: string; from?: string[]; to?: string[] };

/** Whether the person may change the ontology, and why not. */
export interface Governs {
  govern: boolean;
  why?: string;
}

export interface PackSummary {
  id: string;
  name: string;
  version: string;
  licence: string;
  source: string;
  terms: number;
  builtIn: boolean;
  loadedBy?: string;
  loadedAt: string;
}

export interface PackTerm {
  iri: string;
  kind: 'class' | 'relation' | 'detail';
  label: string;
  parent?: string;
  domain?: string[];
  range?: string[];
  note?: string;
  /** Where it's kept here, when it has been adopted: a kind's or link's key, or kind.detail. */
  adopted?: string;
}

export interface Pack extends Omit<PackSummary, 'terms' | 'loadedBy' | 'loadedAt'> {
  terms: PackTerm[];
}

export interface OntologyVersion {
  version: number;
  note: string;
  changedBy?: string;
  changes: OntologyChange[];
  madeAt: string;
}

/** A word sources keep asking for that the ontology hasn't got, and where adopting it would start. */
export interface TermCandidate {
  kind: 'type' | 'detail' | 'relation';
  name: string;
  asked: number;
  firstAt: string;
  lastAt: string;
  parents: string[];
  note?: string;
  start: OntologyChange;
}

/** What an admin says when adopting a pack term, over what the pack gives. */
export interface Adoption {
  pack: string;
  iri: string;
  label?: string;
  plural?: string;
  icon?: string;
  parent?: string;
  type?: string;
  kind?: DetailDef['kind'];
  from?: string[];
  to?: string[];
  inverse?: string;
}

export interface Ontology {
  version: number;
  types: TypeDef[];
  relations: RelationDef[];
}

/** What the caller may do with an entity, and why not when they can't. */
export interface EntityRights {
  edit: boolean;
  retire: boolean;
  why?: string;
}

export interface Entity {
  id: string;
  type: string;
  label: string;
  aliases: string[];
  description: string;
  details: Record<string, string>;
  workspace: string;
  floor: string;
  /** Where it's kept, as people know it: "Org", "You", a team's name. */
  floorName: string;
  state: 'active' | 'retired';
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  can: EntityRights;
}

export interface EntityFields {
  type?: string;
  label?: string;
  aliases?: string[];
  description?: string;
  details?: Record<string, string>;
}

/** The entity at the other end of a link, or why it doesn't show from here. */
export type OtherEnd =
  | { kind: 'entity'; id: string; type: string; label: string; state: Entity['state']; floorName: string }
  | { id: string; hidden: true; reason: 'elsewhere' | 'kept'; floor: string; message: string }
  | { id: string; missing: true };

export type Source = { kind: 'person' } | { kind: 'document'; document: { app: string; id: string; version?: string; title: string }; anchor?: string } | { kind: 'other'; note: string };

export interface Dispute {
  id: string;
  fact: string;
  floorName: string;
  note: string;
  by: string;
  at: string;
  mine: boolean;
}

/** A fact as the caller sees it: what a floor accepts as so, on two clocks. */
export interface FactView {
  id: string;
  entity: string;
  property: string;
  value?: string;
  target?: string;
  /** `in` when this entity is the far end of someone else's link. */
  direction: 'out' | 'in';
  other?: OtherEnd;
  validFrom?: string;
  validTo?: string;
  floor: string;
  floorName: string;
  backedBy: string[];
  note: string;
  recordedAt: string;
  disputes: Dispute[];
  can: { end: boolean; withdraw: boolean; dispute: boolean; why?: string };
  /** Every observation it rests on was retracted, said in words. */
  unbacked?: string;
}

/** An observation as the caller sees it: what someone saw or read, as they said it. */
export interface ObservationView {
  id: string;
  entity: string;
  property: string;
  value?: string;
  target?: string;
  direction: 'out' | 'in';
  other?: OtherEnd;
  observedAt?: string;
  floor: string;
  floorName: string;
  source: Source;
  grade?: string;
  note: string;
  raisedFrom?: string;
  raisedTo: string[];
  createdBy: string;
  createdAt: string;
  can: { accept: boolean; raise: boolean; raiseTo: { floor: string; name: string }[]; why?: string };
  /** Its source was withdrawn or deleted: kept, no longer evidence. */
  retracted?: { at: string; why: string };
}

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

/** What uses an entity: intents bound to it (ids, named by Mandate) and documents what's known came from. */
export interface UsedBy {
  intents: { app: string; id: string; role: string; since: string; floorName?: string }[];
  documents: { app: string; id: string; title: string; observations: number; lastAt: string; withdrawn: boolean }[];
}

/** An intent as Mandate names it for this person: a title, or that they can't open it. */
export interface IntentName {
  id: string;
  label?: string;
  canOpen: boolean;
}

export interface NewObservation {
  property: string;
  value?: string;
  target?: string;
  observedAt?: string;
  source: Source;
  grade?: string;
  note?: string;
  accept?: boolean;
}

/** A refusal, in words people can act on, with what the service said about it. */
export class AtlasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Data Atlas's service, through the gateway, on the floor the person is standing on. */
export class AtlasApi {
  constructor(private readonly fetchOnFloor: MountContext['fetch']) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchOnFloor(`/api/atlas/v1${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new AtlasError(res.status >= 500 || !problem.message ? 'Data Atlas isn’t answering. Try again in a moment.' : problem.message, res.status, problem.error, problem);
    }
    return (await res.json()) as T;
  }

  ontology() {
    return this.call<Ontology>('GET', '/ontology');
  }

  /** What shows from this floor; `type` takes one kind or several, each with its subkinds. */
  entities(query: { q?: string; type?: string | string[]; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams(
      Object.entries(query).flatMap(([k, v]) => (v === undefined || v === '' ? [] : (Array.isArray(v) ? v : [v]).map((one) => [k, String(one)]))),
    );
    return this.call<{ entities: Entity[]; total: number; floors: string[]; seeing: string[] }>('GET', `/entities${params.size ? `?${params}` : ''}`);
  }

  entity(id: string) {
    return this.call<Entity>('GET', `/entities/${encodeURIComponent(id)}`);
  }

  createEntity(fields: Required<Pick<EntityFields, 'type' | 'label'>> & EntityFields) {
    return this.call<Entity>('POST', '/entities', fields);
  }

  updateEntity(id: string, fields: EntityFields) {
    return this.call<Entity>('PATCH', `/entities/${encodeURIComponent(id)}`, fields);
  }

  retireEntity(id: string) {
    return this.call<Entity>('POST', `/entities/${encodeURIComponent(id)}/retire`);
  }

  /** What's known about an entity: true at `at`, as recorded by `known` (both now when left out). */
  knowledge(id: string, when: { at?: string; known?: string } = {}) {
    const params = new URLSearchParams(Object.entries(when).filter((e): e is [string, string] => !!e[1]));
    return this.call<Knowledge>('GET', `/entities/${encodeURIComponent(id)}/knowledge${params.size ? `?${params}` : ''}`);
  }

  observe(id: string, observation: NewObservation) {
    return this.call<{ observation: ObservationView; fact?: FactView }>('POST', `/entities/${encodeURIComponent(id)}/observations`, observation);
  }

  acceptFact(id: string, fact: { backedBy: string[]; validFrom?: string; validTo?: string; note?: string }) {
    return this.call<FactView>('POST', `/entities/${encodeURIComponent(id)}/facts`, fact);
  }

  endFact(id: string, validTo?: string) {
    return this.call<FactView>('POST', `/facts/${encodeURIComponent(id)}/end`, validTo ? { validTo } : {});
  }

  withdrawFact(id: string) {
    return this.call<FactView>('POST', `/facts/${encodeURIComponent(id)}/withdraw`);
  }

  dispute(fact: string, note: string) {
    return this.call<Dispute>('POST', `/facts/${encodeURIComponent(fact)}/disputes`, { note });
  }

  clearDispute(id: string) {
    return this.call<Dispute>('POST', `/disputes/${encodeURIComponent(id)}/clear`);
  }

  raise(observation: string, to: string) {
    return this.call<ObservationView>('POST', `/observations/${encodeURIComponent(observation)}/raise`, { to });
  }

  /** This floor's Triage: open proposals, or those finished and withdrawn. */
  proposals(state: 'open' | 'closed' = 'open') {
    return this.call<Triage>('GET', `/proposals?state=${state}`);
  }

  proposal(id: string) {
    return this.call<ProposalView>('GET', `/proposals/${encodeURIComponent(id)}`);
  }

  propose(body: NewProposal) {
    return this.call<ProposalView & { queue: string }>('POST', '/proposals', body);
  }

  /** Looks again for what its undecided mentions may be. */
  matchProposal(id: string) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(id)}/match`);
  }

  decideMention(proposal: string, key: string, decision: { as: 'link'; entity: string } | { as: 'new'; type?: string; label?: string } | { as: 'drop' }) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(proposal)}/mentions/${encodeURIComponent(key)}`, decision);
  }

  decideObservation(proposal: string, key: string, decision: { as: 'accepted' | 'seen' | 'drop'; grade?: string }) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(proposal)}/observations/${encodeURIComponent(key)}`, decision);
  }

  finishProposal(id: string) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(id)}/finish`);
  }

  withdrawProposal(id: string) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(id)}/withdraw`);
  }

  packs() {
    return this.call<Governs & { packs: PackSummary[] }>('GET', '/ontology/packs');
  }

  pack(id: string) {
    return this.call<Pack>('GET', `/ontology/packs/${encodeURIComponent(id)}`);
  }

  /** Loads a pack from Turtle, or a newer copy of one loaded before. */
  loadPack(pack: { id: string; name: string; version: string; licence: string; source?: string; turtle: string }) {
    return this.call<PackSummary>('POST', '/ontology/packs', pack);
  }

  versions() {
    return this.call<{ versions: OntologyVersion[] }>('GET', '/ontology/versions');
  }

  candidates() {
    return this.call<Governs & { waiting: number; candidates: TermCandidate[] }>('GET', '/ontology/candidates');
  }

  changeOntology(changes: OntologyChange[], note?: string) {
    return this.call<{ version: number; ontology: Ontology }>('POST', '/ontology/changes', { changes, ...(note ? { note } : {}) });
  }

  adopt(adoption: Adoption) {
    return this.call<{ version: number; ontology: Ontology }>('POST', '/ontology/adopt', adoption);
  }

  /** Adopts a word sources asked for, as the change given, or dismisses it. */
  decideCandidate(c: Pick<TermCandidate, 'kind' | 'name'>, decision: { as: 'adopt'; change: OntologyChange } | { as: 'dismiss' }) {
    return this.call<{ version: number; ontology: Ontology } | { dismissed: number }>('POST', '/ontology/candidates/decide', { kind: c.kind, name: c.name, ...decision });
  }

  /** The ontology as OWL in Turtle, to save. */
  async owl() {
    const res = await this.fetchOnFloor('/api/atlas/v1/ontology/owl');
    if (!res.ok) throw new AtlasError('Data Atlas isn’t answering. Try again in a moment.', res.status);
    return res.text();
  }

  usedBy(id: string) {
    return this.call<UsedBy>('GET', `/entities/${encodeURIComponent(id)}/used-by`);
  }

  /** Asks Mandate, as the person, to name intents: those they can't open come back unnamed. */
  async nameIntents(ids: string[]): Promise<IntentName[]> {
    const res = await this.fetchOnFloor('/api/mandate/v1/refs/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) throw new AtlasError('Mandate isn’t open to you on this floor, so the intents can’t be named.', res.status);
    return ((await res.json()) as { refs: IntentName[] }).refs;
  }

  /** The graph around some entities from this floor, a ring at a time. */
  subgraph(query: SubgraphQuery) {
    return this.call<Subgraph>('POST', '/subgraph', { ...query, seeds: query.seeds.map((id) => ({ id })) });
  }
}

export interface Mention {
  key: string;
  text: string;
  type?: string;
  anchor?: string;
  context?: string;
  keys?: Record<string, string>;
}

export interface ProposedObservation {
  key: string;
  about: string;
  property: string;
  value?: string;
  target?: string;
  observedAt?: string;
  grade?: string;
  note?: string;
  anchor?: string;
}

export interface NewProposal {
  source: Source;
  mentions: Mention[];
  observations?: ProposedObservation[];
}

/** An existing entity a mention may be, and why it was offered. */
export interface MatchView {
  entity: Extract<OtherEnd, { kind: 'entity' }>;
  /** An identity key, the name or another name exactly, a name spelt nearly alike, or meaning. */
  why: 'key' | 'name' | 'alias' | 'similar' | 'meaning';
  /** The key's name, or the name it's spelt like. */
  detail?: string;
  /** How close, 0 to 1, for spelling and meaning. */
  score?: number;
}

/** How a proposal's mentions were matched, and why something wasn't tried. */
export interface Matching {
  spelling: boolean;
  meaning: boolean;
  why?: string;
  at: string;
}

export type MentionView = Mention & {
  matches: MatchView[];
  decision?: { as: 'link' | 'new'; entity: OtherEnd } | { as: 'drop' };
  decidedBy?: string;
  decidedAt?: string;
};

export type ProposalObservationView = ProposedObservation & {
  decision?: { as: 'seen'; observation: string } | { as: 'accepted'; observation: string; fact: string } | { as: 'drop' };
  decidedAt?: string;
  /** Whether it can be decided yet, and why not. */
  ready: boolean;
  why?: string;
};

export interface ProposalSummary {
  id: string;
  source: Source;
  producer: { kind: 'person'; id: string } | { kind: string; [k: string]: unknown };
  state: 'open' | 'finished' | 'withdrawn';
  createdBy: string;
  createdAt: string;
  closedAt?: string;
  matching?: Matching;
  /** Its source was withdrawn or deleted while it waited. */
  sourceGone?: string;
  items: number;
  decided: number;
}

export interface Triage {
  floorName: string;
  decide: boolean;
  why?: string;
  proposals: ProposalSummary[];
}

export interface ProposalView extends Omit<ProposalSummary, 'items' | 'decided'> {
  floorName: string;
  ontologyVersion: number;
  left: number;
  mentions: MentionView[];
  observations: ProposalObservationView[];
  terms: { key: string; kind: 'type' | 'detail' | 'relation'; name: string; parent?: string; note?: string }[];
  can: { decide: boolean; finish: boolean; withdraw: boolean; why?: string };
}

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

export interface GraphUnseen {
  id: string;
  reason: 'elsewhere' | 'kept';
  floor: string;
  message: string;
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

/** Where the person is in Data Atlas, as its address has it. */
export type Place =
  | { page: 'entities' }
  | { page: 'new' }
  | { page: 'entity'; id: string; explain?: boolean }
  | { page: 'explore'; id: string }
  | { page: 'triage' }
  | { page: 'proposal'; id: string }
  | { page: 'ontology' };

export const placeFor = (path: string): Place => {
  const [first, second] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (first === 'entities' && second === 'new') return { page: 'new' };
  if (first === 'entities' && second) return { page: 'entity', id: second };
  if (first === 'explore' && second) return { page: 'explore', id: second };
  if (first === 'triage' && second) return { page: 'proposal', id: second };
  if (first === 'triage') return { page: 'triage' };
  if (first === 'ontology') return { page: 'ontology' };
  return { page: 'entities' };
};

export const pathFor = (place: Place) => {
  switch (place.page) {
    case 'entity':
      return `/entities/${encodeURIComponent(place.id)}`;
    case 'explore':
      return `/explore/${encodeURIComponent(place.id)}`;
    case 'proposal':
      return `/triage/${encodeURIComponent(place.id)}`;
    case 'triage':
      return '/triage';
    case 'ontology':
      return '/ontology';
    case 'new':
      return '/entities/new';
    default:
      return '/entities';
  }
};

/** A type's details, its own after those of the kinds above it. */
export const detailsOf = (ontology: Ontology, type: string): DetailDef[] => {
  const byKey = new Map(ontology.types.map((t) => [t.key, t]));
  const chain: TypeDef[] = [];
  for (let t = byKey.get(type); t; t = t.parent ? byKey.get(t.parent) : undefined) chain.unshift(t);
  return chain.flatMap((t) => t.details);
};

/** The details typed on the entity itself; the rest are known through facts. */
export const onEntity = (ontology: Ontology, type: string) => detailsOf(ontology, type).filter((d) => d.onEntity !== false);

/** Types in tree order, with how deep each sits, for a picker. */
export const typeTree = (ontology: Ontology): { type: TypeDef; depth: number }[] => {
  const out: { type: TypeDef; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const t of ontology.types.filter((t) => t.parent === parent)) {
      out.push({ type: t, depth });
      walk(t.key, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
};

/** One line saying what an entity is: its kind, its identity keys, where it's kept. */
export const entityLine = (ontology: Ontology | undefined, e: Entity) => {
  const type = ontology?.types.find((t) => t.key === e.type);
  const keys = ontology
    ? detailsOf(ontology, e.type)
        .filter((d) => d.identity && e.details[d.key])
        .map((d) => `${d.label} ${e.details[d.key]}`)
    : [];
  return [type?.label ?? e.type, ...keys, `Kept on ${e.floorName}`].join(' · ');
};

/** Why an entity shows from the floor the person stands on, in a sentence (explain, never hide). */
export const whyShown = (e: Pick<Entity, 'floor' | 'floorName'>, floorKind: string, floorName: string) => {
  if (e.floor === 'org') return 'It’s kept on the org floor, and what’s on the org floor shows on every floor.';
  if (e.floor.startsWith('person:')) return 'It’s kept on your own floor: only you see it.';
  const team = e.floorName === 'A team' ? 'a team' : e.floorName;
  if (floorKind === 'personal') return `It’s kept on ${team}, one of your teams. Your own floor shows everything you can reach.`;
  if (floorKind === 'team' && e.floorName === floorName) return 'It’s kept on this floor.';
  return `It’s kept on ${team}, a floor above this one, and what’s kept above shows below.`;
};

/** True when `type` is `kind` or a kind below it. */
export const isA = (ontology: Ontology, type: string, kind: string) => {
  const byKey = new Map(ontology.types.map((t) => [t.key, t]));
  for (let t = byKey.get(type); t; t = t.parent ? byKey.get(t.parent) : undefined) if (t.key === kind) return true;
  return false;
};

/**
 * What can be observed of an entity of this type: first the details known only
 * through facts, then the links it can start, then the details on the entity.
 */
export const propertiesOf = (ontology: Ontology, type: string) => {
  const details = detailsOf(ontology, type).map((d) => ({ key: d.key, label: d.label, link: undefined as RelationDef | undefined, detail: d as DetailDef | undefined }));
  return [
    ...details.filter((d) => d.detail?.onEntity === false),
    ...ontology.relations.filter((r) => r.from.some((k) => isA(ontology, type, k))).map((r) => ({ key: r.key, label: r.label, link: r as RelationDef | undefined, detail: undefined })),
    ...details.filter((d) => d.detail?.onEntity !== false),
  ];
};

/** A floor's name in a sentence: "your own floor", "the org floor", or the team's name. */
export const floorWords = (name: string) => (name === 'You' ? 'your own floor' : name === 'Org' ? 'the org floor' : name);

/** A property's name, read from this entity's side: a link that comes in reads backwards. */
export const propertyLabel = (ontology: Ontology | undefined, entityType: string, key: string, direction: 'out' | 'in' = 'out') => {
  const relation = ontology?.relations.find((r) => r.key === key);
  if (relation) return direction === 'in' ? relation.inverse : relation.label;
  return (ontology && detailsOf(ontology, entityType).find((d) => d.key === key)?.label) ?? key;
};

/** What a fact or observation says, from this entity's side: "Flag state: Panama", "Operated by Northwind". */
export const saying = (ontology: Ontology | undefined, entityType: string, x: { property: string; value?: string; other?: OtherEnd; direction: 'out' | 'in' }) => {
  const label = propertyLabel(ontology, entityType, x.property, x.direction);
  if (x.value !== undefined) return `${label}: ${x.value}`;
  const other = x.other;
  if (!other || 'missing' in other) return `${label} an entity that no longer exists`;
  if ('hidden' in other) return `${label} an entity you can’t see from here`;
  return `${label} ${other.label}`;
};

/** A day, as people write it: 1 Sep 2026. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The quick choices beside a day in the world that has already happened. */
export const PAST_DAYS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
];

/** When a fact holds, in words. */
export const span = (f: { validFrom?: string; validTo?: string }) =>
  f.validFrom && f.validTo ? `${day(f.validFrom)} to ${day(f.validTo)}` : f.validFrom ? `Since ${day(f.validFrom)}` : f.validTo ? `Until ${day(f.validTo)}` : 'No dates given';

/** Where an observation came from, in a few words. */
export const sourceLine = (s: Source) => (s.kind === 'person' ? 'Seen or heard by whoever recorded it' : s.kind === 'document' ? `From ${s.document.title}` : s.note);

/** A key from a name: "Patrol Boat" is patrol-boat. */
export const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, 'x-$1')
    .slice(0, 48) || 'term';

/** A plural for a kind's name, for a start the admin can change. */
export const pluralOf = (label: string) => (/[^aeiou]y$/i.test(label) ? `${label.slice(0, -1)}ies` : /(ss|us|x|z|ch|sh)$/i.test(label) ? `${label}es` : /s$/i.test(label) ? label : `${label}s`);
