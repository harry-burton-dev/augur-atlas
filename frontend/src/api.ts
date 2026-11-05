import { AppError, createAppClient, type AppClient, type AppFetcher } from '@augur/app-kit';
import { FLOOR_WORDS } from '../../service/src/api-types.js';

import type {
  Adoption,
  Alike,
  AlikeList,
  CheckFinding,
  EntityCheck,
  FloorCheck,
  CandidateDecision,
  Candidates,
  DetailDef,
  Dispute as DisputeRecord,
  DisputeView as Dispute,
  EntityFields,
  EntityList,
  EntityMerge,
  EntityMerges,
  EntityRaises,
  EntityUses as UsedBy,
  EntityView as Entity,
  Fact,
  FactBody,
  Knowledge,
  MapInfo,
  MapPoints,
  MentionDecisionBody,
  NewProposal,
  ObservationBody as NewObservation,
  ObservationDecisionBody,
  Observed,
  Ontology,
  OntologyChange,
  OntologyChanged,
  OntologyVersion,
  OtherEnd,
  PackLoaded,
  RaiseDecision,
  RaiseList,
  RaiseView,
  Packs,
  PackUpload,
  PackView as Pack,
  ProposalView,
  Raised,
  RelationDef,
  Source,
  Subgraph,
  SubgraphQuery,
  TermCandidate,
  Triage,
  TypeDef,
} from '../../service/src/api-types.js';

// The wire types are written once, in the service's api-types.ts, and shared with it. Where the service keeps a
// record under the same name, the page's shape is a `...View` there; the pages know it by the shorter name here.
export type { Alike, AlikeList, CheckFinding, EntityCheck, FloorCheck, EntityRaises, RaiseList, RaiseView, Dispute, Entity, EntityMerges, NewObservation, Pack, UsedBy };
export type {
  Adoption,
  DetailDef,
  DetailKind,
  EntityFields,
  EntityRights,
  FactRights,
  FactView,
  Fold,
  Governs,
  GraphEdge,
  GraphNode,
  GraphUnseen,
  Knowledge,
  MapInfo,
  MapPoint,
  MapPoints,
  MatchView,
  Matching,
  Mention,
  MentionView,
  NewProposal,
  ObservationRights,
  ObservationView,
  Ontology,
  OntologyChange,
  OntologyVersion,
  OtherEnd,
  PackSummary,
  PackTerm,
  ProposalObservationView,
  ProposalSummary,
  ProposalView,
  ProposedObservation,
  RelationDef,
  Source,
  Subgraph,
  SubgraphQuery,
  TermCandidate,
  Triage,
  TypeDef,
} from '../../service/src/api-types.js';

/** An intent as Mandate names it for this person: a title, or that they can't open it. */
export interface IntentName {
  id: string;
  label?: string;
  canOpen: boolean;
}

/** An intent as `aim.pick` answers it (Mandate's IntentRef). */
export interface PickedIntent {
  id: string;
  title: string;
}

/** What an intent binds, as Mandate tells this person: the explorer's lens. */
export interface IntentLens {
  intent: PickedIntent;
  /** Entity ids bound to the intent and to its parts one level down, each once. */
  entities: string[];
}

/** Whether an answer is an intent, as `aim.pick` gives one. */
export const isPickedIntent = (x: unknown): x is PickedIntent => {
  const r = x as { kind?: unknown; id?: unknown; title?: unknown } | null;
  return !!r && r.kind === 'intent' && typeof r.id === 'string' && !!r.id && typeof r.title === 'string';
};

/** What Data Atlas is called and where its API is, from its manifest. */
export interface AtlasNames {
  /** Its name as people read it, for "<name> isn't answering". */
  appName: string;
  /** Its API under the gateway, such as `/api/atlas/v1`. */
  base: string;
  /** Its id from the manifest, which other apps' entity refs carry as `app`. */
  appId?: string;
}

type Query = Record<string, string | number | string[] | undefined>;

/** Data Atlas's service, through the gateway, on the floor the person is standing on. Every refusal is an AppError. */
export class AtlasApi {
  private readonly client: AppClient;

  constructor(
    private readonly ctx: AppFetcher,
    private readonly names: AtlasNames,
  ) {
    this.client = createAppClient(ctx, names);
  }

  private call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, query?: Query): Promise<T> {
    const options = { ...(body === undefined ? {} : { body }), ...(query ? { query: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== '')) } : {}) };
    const send = method === 'GET' ? this.client.get : method === 'POST' ? this.client.post : this.client.patch;
    return (send as (p: string, o: object) => Promise<unknown>)(path, options) as Promise<T>;
  }

  ontology() {
    return this.call<Ontology>('GET', '/ontology');
  }

  /** What shows from this floor; `type` takes one kind or several, each with its subkinds. */
  entities(query: { q?: string; type?: string | string[]; limit?: number; offset?: number } = {}) {
    return this.call<EntityList>('GET', '/entities', undefined, query);
  }

  entity(id: string) {
    return this.call<Entity>('GET', `/entities/${encodeURIComponent(id)}`);
  }

  createEntity(fields: Required<Pick<EntityFields, 'type' | 'label'>> & EntityFields) {
    return this.call<Entity>('POST', '/entities', fields);
  }

  updateEntity(id: string, fields: Omit<EntityFields, 'type'>) {
    return this.call<Entity>('PATCH', `/entities/${encodeURIComponent(id)}`, fields);
  }

  retireEntity(id: string) {
    return this.call<Entity>('POST', `/entities/${encodeURIComponent(id)}/retire`);
  }

  /** What's known about an entity: true at `at`, as recorded by `known` (both now when left out). */
  knowledge(id: string, when: { at?: string; known?: string } = {}) {
    return this.call<Knowledge>('GET', `/entities/${encodeURIComponent(id)}/knowledge`, undefined, when);
  }

  observe(id: string, observation: NewObservation) {
    return this.call<Observed>('POST', `/entities/${encodeURIComponent(id)}/observations`, observation);
  }

  acceptFact(id: string, fact: FactBody) {
    return this.call<Fact>('POST', `/entities/${encodeURIComponent(id)}/facts`, fact);
  }

  endFact(id: string, validTo?: string) {
    return this.call<Fact>('POST', `/facts/${encodeURIComponent(id)}/end`, validTo ? { validTo } : {});
  }

  withdrawFact(id: string) {
    return this.call<Fact>('POST', `/facts/${encodeURIComponent(id)}/withdraw`);
  }

  dispute(fact: string, note: string) {
    return this.call<DisputeRecord>('POST', `/facts/${encodeURIComponent(fact)}/disputes`, { note });
  }

  clearDispute(id: string) {
    return this.call<DisputeRecord>('POST', `/disputes/${encodeURIComponent(id)}/clear`);
  }

  raise(observation: string, to: string) {
    return this.call<Raised>('POST', `/observations/${encodeURIComponent(observation)}/raise`, { to });
  }

  /** This floor's Triage: open proposals, or those finished and withdrawn. */
  proposals(state: 'open' | 'closed' = 'open') {
    return this.call<Triage>('GET', '/proposals', undefined, { state });
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

  decideMention(proposal: string, key: string, decision: MentionDecisionBody) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(proposal)}/mentions/${encodeURIComponent(key)}`, decision);
  }

  decideObservation(proposal: string, key: string, decision: ObservationDecisionBody) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(proposal)}/observations/${encodeURIComponent(key)}`, decision);
  }

  finishProposal(id: string) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(id)}/finish`);
  }

  withdrawProposal(id: string) {
    return this.call<ProposalView>('POST', `/proposals/${encodeURIComponent(id)}/withdraw`);
  }

  packs() {
    return this.call<Packs>('GET', '/ontology/packs');
  }

  pack(id: string) {
    return this.call<Pack>('GET', `/ontology/packs/${encodeURIComponent(id)}`);
  }

  /** Loads a pack from Turtle, or a newer copy of one loaded before. */
  loadPack(pack: PackUpload) {
    return this.call<PackLoaded>('POST', '/ontology/packs', pack);
  }

  versions() {
    return this.call<{ versions: OntologyVersion[] }>('GET', '/ontology/versions');
  }

  candidates() {
    return this.call<Candidates>('GET', '/ontology/candidates');
  }

  changeOntology(changes: OntologyChange[], note?: string) {
    return this.call<OntologyChanged>('POST', '/ontology/changes', { changes, ...(note ? { note } : {}) });
  }

  adopt(adoption: Adoption) {
    return this.call<OntologyChanged>('POST', '/ontology/adopt', adoption);
  }

  /** Adopts a word sources asked for, as the change given, or dismisses it. */
  decideCandidate(c: Pick<TermCandidate, 'kind' | 'name'>, decision: { as: 'adopt'; change: OntologyChange } | { as: 'dismiss' }) {
    return this.call<OntologyChanged | { dismissed: number }>('POST', '/ontology/candidates/decide', { kind: c.kind, name: c.name, ...decision } satisfies CandidateDecision);
  }

  /** The ontology as OWL in Turtle, to save. */
  async owl() {
    const res = await this.ctx.fetch(`${this.names.base}/ontology/owl`).catch((err: unknown) => {
      throw AppError.from(err, this.names);
    });
    if (!res.ok) throw await AppError.fromResponse(res, this.names);
    return res.text();
  }

  /** The ontology as SHACL shapes in Turtle, to save or check against elsewhere (ADR 0062). */
  async shacl() {
    const res = await this.ctx.fetch(`${this.names.base}/ontology/shacl`).catch((err: unknown) => {
      throw AppError.from(err, this.names);
    });
    if (!res.ok) throw await AppError.fromResponse(res, this.names);
    return res.text();
  }

  /** What about this entity doesn't fit the ontology's shapes, as it stands now. */
  checkEntity(id: string) {
    return this.call<EntityCheck>('GET', `/entities/${encodeURIComponent(id)}/check`);
  }

  /** A page of the entities in sight, checked against the ontology's shapes. */
  checks(query: { type?: string; limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
    return this.call<FloorCheck>('GET', `/checks${q.size ? `?${q}` : ''}`);
  }

  /** Where an entity may be raised to from here, and the requests made for it. */
  entityRaises(id: string) {
    return this.call<EntityRaises>('GET', `/entities/${encodeURIComponent(id)}/raises`);
  }

  /** Asks a floor above to keep this entity card there. */
  askRaise(id: string, to: string, note: string) {
    return this.call<RaiseView>('POST', `/entities/${encodeURIComponent(id)}/raise`, { to, ...(note.trim() ? { note } : {}) });
  }

  /** What's been asked of the floor the person stands on. */
  raises(state: 'waiting' | 'decided' = 'waiting') {
    return this.call<RaiseList>('GET', '/raises', undefined, { state });
  }

  decideRaise(id: string, decision: RaiseDecision) {
    return this.call<RaiseView>('POST', `/raises/${encodeURIComponent(id)}/decide`, decision);
  }

  withdrawRaise(id: string) {
    return this.call<RaiseView>('POST', `/raises/${encodeURIComponent(id)}/withdraw`);
  }

  /** Entities that might be the same real thing as this one, each saying why and whether it can be merged from here. */
  alike(id: string) {
    return this.call<AlikeList>('GET', `/entities/${encodeURIComponent(id)}/alike`);
  }

  /** Places this entity under another found to be the same thing, saying why. */
  merge(id: string, into: string, why: string) {
    return this.call<EntityMerge>('POST', `/entities/${encodeURIComponent(id)}/merge`, { into, why });
  }

  /** An entity's merges, either way, with who decided each, why and on what evidence. */
  merges(id: string) {
    return this.call<EntityMerges>('GET', `/entities/${encodeURIComponent(id)}/merges`);
  }

  usedBy(id: string) {
    return this.call<UsedBy>('GET', `/entities/${encodeURIComponent(id)}/used-by`);
  }

  /** Asks Mandate, as the person, to name intents: those they can't open come back unnamed. */
  async nameIntents(ids: string[]): Promise<IntentName[]> {
    const res = await this.ctx.fetch('/api/mandate/v1/refs/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) throw new AppError('Mandate isn’t open to you on this floor, so the intents can’t be named.', res.status);
    return ((await res.json()) as { refs: IntentName[] }).refs;
  }

  /**
   * Asks Mandate, as the person, what an intent binds: the entities on it and on
   * its parts one level down, as far as they can see it (Mandate's context API).
   */
  async intentLens(id: string): Promise<IntentLens> {
    const res = await this.ctx.fetch(`/api/mandate/v1/intents/${encodeURIComponent(id)}/context?depth=1`).catch(() => undefined);
    if (!res) throw new AppError('Mandate isn’t answering, so what the intent binds can’t be read. Try again in a moment.', 0);
    if (res.status === 403 || res.status === 404) throw new AppError('You can’t open that intent from this floor, so there’s nothing to explore within. Whoever holds it can share it with you.', res.status);
    if (!res.ok) throw new AppError(`Mandate couldn’t say what the intent binds (it answered ${res.status}). Try again in a moment.`, res.status);
    const body = (await res.json()) as { intent?: { id?: string; title?: string }; entities?: { ref?: { id?: string; app?: string } }[] };
    const ids = (body.entities ?? []).filter((e) => e.ref?.id && (!e.ref.app || e.ref.app === this.names.appId)).map((e) => e.ref!.id!);
    return { intent: { id: body.intent?.id ?? id, title: body.intent?.title ?? '' }, entities: [...new Set(ids)] };
  }

  /** The graph around some entities from this floor, a ring at a time. */
  subgraph(query: SubgraphQuery) {
    return this.call<Subgraph>('POST', '/subgraph', { ...query, seeds: query.seeds.map((id) => ({ id })) });
  }

  /** Whether this deployment has a base map, and the credit its data needs. */
  mapInfo() {
    return this.call<MapInfo>('GET', '/map');
  }

  /** Where these entities are, as seen from this floor (and at a time, when given). */
  mapPoints(entities: string[], at?: string) {
    return this.call<MapPoints>('POST', '/map/points', { entities, ...(at ? { at } : {}) });
  }

  /** Part of the deployment's base map file, for the map's PMTiles reader: through the gateway, as the person. */
  async mapBytes(offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await this.ctx.fetch(`${this.names.base.replace(/\/+$/, '')}/map/tiles`, { headers: { range: `bytes=${offset}-${offset + length - 1}` }, ...(signal ? { signal } : {}) });
    if (res.status !== 206 && res.status !== 200) throw new AppError(`The base map couldn’t be read (it answered ${res.status}).`, res.status);
    const data = await res.arrayBuffer();
    // A server that ignored the range sent the whole file: take the part asked for.
    return res.status === 200 ? data.slice(offset, offset + length) : data;
  }
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
      return `/entities/${encodeURIComponent(place.id)}${place.explain ? '?explain=true' : ''}`;
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
/** A detail's value as people read it: a quantity with its unit. */
export const detailText = (d: Pick<DetailDef, 'kind' | 'unit'>, value: string | undefined) => (value && d.kind === 'quantity' && d.unit ? `${value} ${d.unit}` : (value ?? ''));

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
  const team = e.floorName === FLOOR_WORDS.unnamedTeam ? 'a team' : e.floorName;
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

/** A floor's name in a sentence: "your own floor", the organisation's or the team's name, or what it is when it has none. */
export const floorWords = (name: string) =>
  name === FLOOR_WORDS.own
    ? 'your own floor'
    : name === FLOOR_WORDS.someonesOwn
      ? 'someone’s own floor'
      : name === FLOOR_WORDS.unnamedTeam
        ? 'a team’s floor'
        : name === FLOOR_WORDS.unnamedOrg
          ? 'the organisation'
          : name;

/** A property's name, read from this entity's side: a link that comes in reads backwards. */
export const propertyLabel = (ontology: Ontology | undefined, entityType: string, key: string, direction: 'out' | 'in' = 'out') => {
  const relation = ontology?.relations.find((r) => r.key === key);
  if (relation) return direction === 'in' ? relation.inverse : relation.label;
  return (ontology && detailsOf(ontology, entityType).find((d) => d.key === key)?.label) ?? key;
};

/** What a fact or observation says, from this entity's side: "Flag state: Panama", "Operated by Northwind". */
export const saying = (ontology: Ontology | undefined, entityType: string, x: { property: string; value?: string; other?: OtherEnd; direction: 'out' | 'in' }) => {
  const label = propertyLabel(ontology, entityType, x.property, x.direction);
  const detail = ontology && detailsOf(ontology, entityType).find((d) => d.key === x.property);
  if (x.value !== undefined) return `${label}: ${detail ? detailText(detail, x.value) : x.value}`;
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
