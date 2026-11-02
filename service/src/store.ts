import pg from 'pg';
import { ulid } from 'ulid';
import { detailsOf, knowledgeSql, starterSql, type DetailDef, type Ontology, type OntologyChange, type RelationDef, type TypeDef } from './ontology.ts';
import { BUILT_IN_PACKS, type Pack } from './packs.ts';

/**
 * One real thing the organisation keeps track of: a ship, a port, a company.
 * It has one id for life, a kind (its type in the ontology), a name and the
 * other names it goes by, and the details that say which thing it is. It sits
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
  state: 'active' | 'retired';
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface NewEntity {
  type: string;
  label: string;
  aliases?: string[];
  description?: string;
  details?: Record<string, string>;
  workspace: string;
  floor: string;
  createdBy: string;
}

export type EntityChange = Partial<Pick<Entity, 'label' | 'aliases' | 'description' | 'details'>>;

export interface EntityQuery {
  /** Only entities kept on these floors. */
  floors: readonly string[];
  /** Words in its name, another name, or an identity key's value. */
  q?: string;
  /** Only these types (a kind's subtypes are the caller's to add). */
  types?: readonly string[];
  limit?: number;
  offset?: number;
}

/** Another entity already has that identity key: it's the same real thing, or the value is wrong. */
export class KeyTakenError extends Error {
  readonly detail: DetailDef;
  readonly value: string;
  readonly holder: Pick<Entity, 'id' | 'type' | 'label' | 'floor'>;
  constructor(detail: DetailDef, value: string, holder: Pick<Entity, 'id' | 'type' | 'label' | 'floor'>) {
    super(`${detail.label} ${value} is already ${holder.label}’s.`);
    this.detail = detail;
    this.value = value;
    this.holder = holder;
  }
}

/** Where an observation came from. A document is named by the SDK's DocumentRef (`folio` for Artifacts). */
export type Source =
  | { kind: 'person' }
  | { kind: 'document'; document: { app: string; id: string; version?: string; title: string }; anchor?: string }
  | { kind: 'other'; note: string };

/** Who or what made a proposal. Only people do in v1; the extractor and agent runs come later. */
export type Producer = { kind: 'person'; id: string } | { kind: 'extractor'; engine: string; model?: string } | { kind: 'run'; id: string };

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

export type MentionDecision = { as: 'link'; entity: string } | { as: 'new'; entity: string } | { as: 'drop' };
export type ObservationDecision = { as: 'seen'; observation: string } | { as: 'accepted'; observation: string; fact: string } | { as: 'drop' };
/** What an admin made of a term: adopted into a version of the ontology as `key`, or dismissed. */
export type TermDecision = { as: 'adopted'; version: number; key: string } | { as: 'dismissed'; note?: string };

export type ProposalItem =
  | { kind: 'mention'; key: string; body: Mention; matches: Match[]; decision?: MentionDecision; decidedBy?: string; decidedAt?: string }
  | { kind: 'observation'; key: string; body: ProposedObservation; matches: Match[]; decision?: ObservationDecision; decidedBy?: string; decidedAt?: string }
  | { kind: 'term'; key: string; body: ProposedTerm; matches: Match[]; decision?: TermDecision; decidedBy?: string; decidedAt?: string };

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

/** Something in another app that uses an entity, from that app's events: an intent bound to it, so far. */
export interface UsedBy {
  app: string;
  kind: string;
  id: string;
  entity: string;
  role: string;
  workspace: string;
  since: string;
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

/** A proposal as listed in Triage: how much of it is decided. */
export interface ProposalSummary extends Proposal {
  items: number;
  decided: number;
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

/** A pack as listed: what it is, without its terms. */
export type PackSummary = Omit<Pack, 'terms'> & { terms: number; builtIn: boolean; loadedBy?: string; loadedAt: string };

/** A term sources keep asking for that the ontology hasn't got, however many times, from wherever. */
export interface TermCandidate {
  kind: ProposedTerm['kind'];
  name: string;
  /** How many proposals asked for it, and when first and last. */
  asked: number;
  firstAt: string;
  lastAt: string;
  parents: string[];
  note?: string;
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

export type NewObservation = Omit<Observation, 'id' | 'createdAt'>;
export type NewFact = Omit<Fact, 'id' | 'recordedAt' | 'supersededAt' | 'supersededBy'>;

/** Which records show: those on these floors, true at `at` and recorded as of `known` (both default to now). */
export interface FactQuery {
  floors: readonly string[];
  at?: string;
  known?: string;
}

/** Each change to the database, in order. A shipped one never changes: add another. */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '001_entities',
    sql: `
      create table atlas.ontology_versions (
        version integer primary key,
        note text not null default '',
        made_at timestamptz not null default now()
      );
      -- The kinds of thing kept, as a tree. Each names the ontology pack it comes from and that pack's own term for it.
      create table atlas.ontology_types (
        key text primary key,
        parent text references atlas.ontology_types(key),
        label text not null,
        plural text not null,
        abstract boolean not null default false,
        icon text not null,
        pack text not null,
        pack_term text not null,
        pack_iri text,
        sort integer not null default 0
      );
      create table atlas.ontology_details (
        type text not null references atlas.ontology_types(key),
        key text not null,
        label text not null,
        kind text not null check (kind in ('text', 'number', 'date')),
        identity boolean not null default false,
        pattern text,
        hint text,
        sort integer not null default 0,
        primary key (type, key)
      );
      create table atlas.entities (
        id text primary key,
        type text not null references atlas.ontology_types(key),
        label text not null,
        aliases text[] not null default '{}',
        description text not null default '',
        details jsonb not null default '{}',
        workspace_id text not null,
        floor text not null,
        state text not null default 'active' check (state in ('active', 'retired')),
        -- Reserved for protective markings, should AUGUR take them up.
        marking jsonb,
        created_by text not null,
        created_at timestamptz not null default now(),
        updated_by text not null,
        updated_at timestamptz not null default now()
      );
      create index entities_floor on atlas.entities (floor) where state = 'active';
      create index entities_type on atlas.entities (type) where state = 'active';
      -- Identity keys, one row each, so no two entities share one whatever their floor.
      create table atlas.entity_keys (
        entity text not null references atlas.entities(id),
        type text not null,
        key text not null,
        value text not null,
        primary key (entity, key),
        unique (type, key, value)
      );
    `,
  },
  { id: '002_starter_ontology', sql: starterSql() },
  {
    id: '003_outbox',
    sql: `
      -- What Data Atlas tells other apps (atlas.entity.*), sent by the outbox relay once the change commits (docs/domain-events.md).
      create table atlas.outbox (
        id bigint generated always as identity primary key,
        event_id text not null unique default gen_random_uuid()::text,
        topic text not null,
        workspace_id text,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      );
      create index outbox_unsent on atlas.outbox (id) where sent_at is null;`,
  },
  {
    id: '004_knowledge',
    sql: `
      -- Details known only through facts, not typed on the entity.
      alter table atlas.ontology_details add column on_entity boolean not null default true;
      -- The kinds of link between entities.
      create table atlas.ontology_relations (
        key text primary key,
        label text not null,
        inverse text not null,
        from_types text[] not null,
        to_types text[] not null,
        pack text not null,
        pack_term text not null,
        pack_iri text,
        sort integer not null default 0
      );
      -- What people saw or read, as they said it. Rows are only ever added.
      create table atlas.observations (
        id text primary key,
        entity text not null references atlas.entities(id),
        property text not null,
        value text,
        target text references atlas.entities(id),
        observed_at timestamptz,
        floor text not null,
        workspace_id text not null,
        source jsonb not null,
        grade text check (grade ~ '^[A-F][1-6]$'),
        note text not null default '',
        reported_under jsonb,
        raised_from text references atlas.observations(id),
        -- Reserved for protective markings, should AUGUR take them up.
        marking jsonb,
        created_by text not null,
        created_at timestamptz not null default now(),
        check ((value is null) <> (target is null))
      );
      create index observations_entity on atlas.observations (entity, created_at desc);
      create index observations_target on atlas.observations (target) where target is not null;
      -- What a floor accepts as so, on two clocks. A record is never changed, only superseded by a later one.
      create table atlas.facts (
        id text primary key,
        entity text not null references atlas.entities(id),
        property text not null,
        value text,
        target text references atlas.entities(id),
        valid_from timestamptz,
        valid_to timestamptz,
        floor text not null,
        workspace_id text not null,
        backed_by text[] not null default '{}',
        note text not null default '',
        marking jsonb,
        created_by text not null,
        recorded_at timestamptz not null default clock_timestamp(),
        superseded_at timestamptz,
        superseded_by text,
        check ((value is null) <> (target is null)),
        check (valid_to is null or valid_from is null or valid_to > valid_from)
      );
      create index facts_entity on atlas.facts (entity) where superseded_at is null;
      create index facts_target on atlas.facts (target) where target is not null and superseded_at is null;
      create table atlas.fact_disputes (
        id text primary key,
        fact text not null references atlas.facts(id),
        floor text not null,
        note text not null,
        by_person text not null,
        at timestamptz not null default now(),
        cleared_by text,
        cleared_at timestamptz
      );
      create index fact_disputes_fact on atlas.fact_disputes (fact) where cleared_at is null;
      ${knowledgeSql()}
      insert into atlas.outbox (topic, payload) values ('atlas.ontology.changed', '{"version": 2}');`,
  },
  {
    id: '005_proposals',
    sql: `
      -- The ingest seam: everything a person didn't type straight in arrives as a proposal, one per source,
      -- and waits in its floor's Triage until that floor's leads decide each item.
      create table atlas.proposals (
        id text primary key,
        floor text not null,
        workspace_id text not null,
        source jsonb not null,
        producer jsonb not null,
        ontology_version integer not null,
        state text not null default 'open' check (state in ('open', 'finished', 'withdrawn')),
        created_by text not null,
        created_at timestamptz not null default clock_timestamp(),
        closed_by text,
        closed_at timestamptz
      );
      create index proposals_floor on atlas.proposals (floor, state, created_at desc);
      create table atlas.proposal_items (
        proposal text not null references atlas.proposals(id),
        key text not null,
        kind text not null check (kind in ('mention', 'observation', 'term')),
        body jsonb not null,
        -- Existing entities a mention may be, found when it arrived.
        matches jsonb not null default '[]',
        decision jsonb,
        decided_by text,
        decided_at timestamptz,
        sort integer not null default 0,
        primary key (proposal, key)
      );`,
  },
  {
    id: '006_resolve',
    sql: `
      -- How a proposal's mentions were matched, and why something wasn't tried (explain, never hide).
      alter table atlas.proposals add column matching jsonb;`,
  },
  {
    id: '007_studio',
    sql: `
      -- Who changed the ontology, and how: a version is the changes an admin made together.
      alter table atlas.ontology_versions add column changed_by text, add column changes jsonb not null default '[]';
      alter table atlas.ontology_details add column pack text, add column pack_term text, add column pack_iri text;
      -- Vocabularies to adopt terms from: those that come with Data Atlas, and Turtle an admin loads.
      create table atlas.ontology_packs (
        id text primary key,
        name text not null,
        version text not null,
        licence text not null,
        source text not null,
        terms jsonb not null,
        built_in boolean not null default false,
        loaded_by text,
        loaded_at timestamptz not null default now()
      );
      -- The starter kinds stand for CCO classes: say which, by IRI, so they show as adopted from the pack.
      update atlas.ontology_types set pack_iri = 'http://www.ontologyrepository.com/CommonCoreOntologies/' || replace(pack_term, ' ', '') where pack = 'cco';`,
  },
  {
    id: '008_used_by',
    sql: `
      -- What other apps use each entity, from their events (an intent bound to it). Theirs is the truth; this only follows it.
      create table atlas.used_by (
        app text not null,
        item_kind text not null,
        item_id text not null,
        entity text not null,
        role text not null,
        workspace_id text not null,
        since timestamptz not null default now(),
        primary key (app, item_kind, item_id, entity, role)
      );
      create index used_by_entity on atlas.used_by (entity);
      -- Where Data Atlas has read other apps' events up to.
      create table atlas.event_cursor (id integer primary key, seq text not null);
      -- An observation whose source was withdrawn stays, saying so, and stops counting as evidence.
      alter table atlas.observations add column retracted_at timestamptz, add column retracted_why text;
      create index observations_document on atlas.observations ((source->'document'->>'app'), (source->'document'->>'id')) where source->>'kind' = 'document';
      alter table atlas.proposals add column source_gone text;`,
  },
];

/**
 * What Data Atlas makes beside its migrations once the extensions they need are
 * there: the platform creates pg_trgm and pgvector in every app's database
 * (the storage service), which an app's own login can't do. Run at each start,
 * so a server that gains them later gains these too.
 */
const EXTRAS = {
  spelling: (x: string) => `create index if not exists entities_label_trgm on atlas.entities using gin (lower(label) ${x}.gin_trgm_ops)`,
  meaning: (x: string) => `create table if not exists atlas.entity_vectors (
      entity text primary key references atlas.entities(id),
      -- Vectors from different models don't compare: each is kept with the one that made it.
      model text not null,
      -- What was embedded, so a change to the entity is noticed.
      source text not null,
      embedding ${x}.vector not null,
      made_at timestamptz not null default now()
    )`,
};

interface ProposalRow {
  id: string;
  floor: string;
  workspace_id: string;
  source: Source;
  producer: Producer;
  ontology_version: number;
  state: Proposal['state'];
  created_by: string;
  created_at: Date;
  closed_by: string | null;
  closed_at: Date | null;
  matching: Matching | null;
  source_gone: string | null;
}

const fromProposalRow = (r: ProposalRow): Proposal => ({
  id: r.id,
  floor: r.floor,
  workspace: r.workspace_id,
  source: r.source,
  producer: r.producer,
  ontologyVersion: r.ontology_version,
  state: r.state,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  ...(r.closed_by ? { closedBy: r.closed_by } : {}),
  ...(r.closed_at ? { closedAt: r.closed_at.toISOString() } : {}),
  ...(r.matching ? { matching: r.matching } : {}),
  ...(r.source_gone ? { sourceGone: r.source_gone } : {}),
});

interface ItemRow {
  key: string;
  kind: ProposalItem['kind'];
  body: never;
  matches: Match[];
  decision: never | null;
  decided_by: string | null;
  decided_at: Date | null;
}

const fromItemRow = (r: ItemRow): ProposalItem =>
  ({
    kind: r.kind,
    key: r.key,
    body: r.body,
    matches: r.matches,
    ...(r.decision ? { decision: r.decision } : {}),
    ...(r.decided_by ? { decidedBy: r.decided_by } : {}),
    ...(r.decided_at ? { decidedAt: r.decided_at.toISOString() } : {}),
  }) as ProposalItem;

/** Decides every undecided ask for a term, by its kind and name in any case. */
const decideTerms = async (client: pg.PoolClient, kind: ProposedTerm['kind'], name: string, decision: TermDecision, by: string) => {
  const { rowCount } = await client.query(
    `update atlas.proposal_items set decision = $3, decided_by = $4, decided_at = now()
     where kind = 'term' and decision is null and body->>'kind' = $1 and lower(body->>'name') = lower($2)`,
    [kind, name, JSON.stringify(decision), by],
  );
  return rowCount ?? 0;
};

/** Writes one checked change to the ontology's tables. */
const applyChange = async (client: pg.PoolClient, c: OntologyChange) => {
  switch (c.op) {
    case 'add-type': {
      const t = c.type;
      await client.query(
        `insert into atlas.ontology_types (key, parent, label, plural, abstract, icon, pack, pack_term, pack_iri, sort)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, (select coalesce(max(sort), 0) + 1 from atlas.ontology_types))`,
        [t.key, t.parent ?? null, t.label, t.plural, t.abstract, t.icon, t.pack, t.packTerm, t.packIri ?? null],
      );
      return;
    }
    case 'edit-type':
      await client.query('update atlas.ontology_types set label = coalesce($2, label), plural = coalesce($3, plural), icon = coalesce($4, icon) where key = $1', [c.key, c.label ?? null, c.plural ?? null, c.icon ?? null]);
      return;
    case 'add-detail': {
      const d = c.detail;
      await client.query(
        `insert into atlas.ontology_details (type, key, label, kind, identity, pattern, hint, on_entity, pack_iri, sort)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, (select coalesce(max(sort), 0) + 1 from atlas.ontology_details where type = $1))`,
        [c.type, d.key, d.label, d.kind, d.identity, d.pattern ?? null, d.hint ?? null, d.onEntity !== false, d.packIri ?? null],
      );
      return;
    }
    case 'edit-detail':
      await client.query('update atlas.ontology_details set label = coalesce($3, label), hint = coalesce($4, hint) where type = $1 and key = $2', [c.type, c.key, c.label ?? null, c.hint ?? null]);
      return;
    case 'add-relation': {
      const r = c.relation;
      await client.query(
        `insert into atlas.ontology_relations (key, label, inverse, from_types, to_types, pack, pack_term, pack_iri, sort)
         values ($1, $2, $3, $4, $5, $6, $7, $8, (select coalesce(max(sort), 0) + 1 from atlas.ontology_relations))`,
        [r.key, r.label, r.inverse, r.from, r.to, r.pack, r.packTerm, r.packIri ?? null],
      );
      return;
    }
    case 'edit-relation':
      await client.query(
        'update atlas.ontology_relations set label = coalesce($2, label), inverse = coalesce($3, inverse), from_types = coalesce($4, from_types), to_types = coalesce($5, to_types) where key = $1',
        [c.key, c.label ?? null, c.inverse ?? null, c.from ?? null, c.to ?? null],
      );
      return;
  }
};

/** Adds an event to Data Atlas's outbox, inside the transaction that makes the change it tells of. Ids only, never names. */
const tell = (client: pg.PoolClient, what: 'created' | 'changed' | 'retired', e: EntityRow) =>
  client.query('insert into atlas.outbox (topic, workspace_id, payload) values ($1, $2, $3)', [`atlas.entity.${what}`, e.workspace_id, JSON.stringify({ entity: e.id, type: e.type })]);

interface EntityRow {
  id: string;
  type: string;
  label: string;
  aliases: string[];
  description: string;
  details: Record<string, string>;
  workspace_id: string;
  floor: string;
  state: Entity['state'];
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
}

const ENTITY_COLUMNS = 'id, type, label, aliases, description, details, workspace_id, floor, state, created_by, created_at, updated_by, updated_at';

interface ObservationRow {
  id: string;
  entity: string;
  property: string;
  value: string | null;
  target: string | null;
  observed_at: Date | null;
  floor: string;
  workspace_id: string;
  source: Source;
  grade: string | null;
  note: string;
  reported_under: unknown;
  raised_from: string | null;
  created_by: string;
  created_at: Date;
  retracted_at: Date | null;
  retracted_why: string | null;
}
const OBSERVATION_COLUMNS = 'id, entity, property, value, target, observed_at, floor, workspace_id, source, grade, note, reported_under, raised_from, created_by, created_at, retracted_at, retracted_why';
const fromObservationRow = (r: ObservationRow): Observation => ({
  id: r.id,
  entity: r.entity,
  property: r.property,
  ...(r.value !== null ? { value: r.value } : {}),
  ...(r.target !== null ? { target: r.target } : {}),
  ...(r.observed_at ? { observedAt: r.observed_at.toISOString() } : {}),
  floor: r.floor,
  workspace: r.workspace_id,
  source: r.source,
  ...(r.grade ? { grade: r.grade } : {}),
  note: r.note,
  ...(r.reported_under ? { reportedUnder: r.reported_under } : {}),
  ...(r.raised_from ? { raisedFrom: r.raised_from } : {}),
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  ...(r.retracted_at ? { retracted: { at: r.retracted_at.toISOString(), why: r.retracted_why ?? '' } } : {}),
});

interface FactRow {
  id: string;
  entity: string;
  property: string;
  value: string | null;
  target: string | null;
  valid_from: Date | null;
  valid_to: Date | null;
  floor: string;
  workspace_id: string;
  backed_by: string[];
  note: string;
  recorded_at: Date;
  superseded_at: Date | null;
  superseded_by: string | null;
  created_by: string;
}
const FACT_COLUMNS = 'id, entity, property, value, target, valid_from, valid_to, floor, workspace_id, backed_by, note, recorded_at, superseded_at, superseded_by, created_by';
const fromFactRow = (r: FactRow): Fact => ({
  id: r.id,
  entity: r.entity,
  property: r.property,
  ...(r.value !== null ? { value: r.value } : {}),
  ...(r.target !== null ? { target: r.target } : {}),
  ...(r.valid_from ? { validFrom: r.valid_from.toISOString() } : {}),
  ...(r.valid_to ? { validTo: r.valid_to.toISOString() } : {}),
  floor: r.floor,
  workspace: r.workspace_id,
  backedBy: r.backed_by,
  note: r.note,
  recordedAt: r.recorded_at.toISOString(),
  ...(r.superseded_at ? { supersededAt: r.superseded_at.toISOString() } : {}),
  ...(r.superseded_by ? { supersededBy: r.superseded_by } : {}),
  createdBy: r.created_by,
});

interface DisputeRow {
  id: string;
  fact: string;
  floor: string;
  note: string;
  by_person: string;
  at: Date;
  cleared_by: string | null;
  cleared_at: Date | null;
}
const fromDisputeRow = (r: DisputeRow): Dispute => ({
  id: r.id,
  fact: r.fact,
  floor: r.floor,
  note: r.note,
  by: r.by_person,
  at: r.at.toISOString(),
  ...(r.cleared_by ? { clearedBy: r.cleared_by } : {}),
  ...(r.cleared_at ? { clearedAt: r.cleared_at.toISOString() } : {}),
});

/** The SQL that keeps facts true at `at` ($2) and recorded as of `known` ($3). */
const FACT_IN_TIME = `(valid_from is null or valid_from <= $2) and (valid_to is null or valid_to > $2)
  and recorded_at <= $3 and (superseded_at is null or superseded_at > $3)`;

const fromRow = (r: EntityRow): Entity => ({
  id: r.id,
  type: r.type,
  label: r.label,
  aliases: r.aliases,
  description: r.description,
  details: r.details,
  workspace: r.workspace_id,
  floor: r.floor,
  state: r.state,
  createdBy: r.created_by,
  createdAt: r.created_at.toISOString(),
  updatedBy: r.updated_by,
  updatedAt: r.updated_at.toISOString(),
});

/** An entity as a link other apps keep (the SDK's EntityRef). */
export const refOf = (e: Entity) => ({ kind: 'entity' as const, id: e.id, type: e.type, label: e.label });


/** A new entity's id: `ent_` and a ULID, so ids sort by when they were made. */
export const newEntityId = () => `ent_${ulid()}`;

/** Data Atlas's tables, in its own schema. The graph lives in Postgres (decided 27 October 2026). */
export class PgAtlasStore {
  private readonly pool: pg.Pool;

  /** Which of the extensions resolve uses this database has (see EXTRAS). */
  can = { spelling: false, meaning: false };
  /** The schema each is in, quoted: Data Atlas's connections only search its own. */
  private ext = { spelling: 'public', meaning: 'public' };

  private constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /** Makes what the extensions allow, and notes which there are. Locally, with a login that may, it creates them too. */
  async prepareExtras() {
    for (const [name, ext] of [['spelling', 'pg_trgm'], ['meaning', 'vector']] as const) {
      // Where the login may (a local Postgres); on a server the platform has made it already, or can't.
      await this.pool.query(`create extension if not exists ${ext} schema public`).catch(() => undefined);
      const { rows } = await this.pool.query<{ schema: string }>('select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = $1', [ext]);
      this.can[name] = !!rows.length;
      if (!rows.length) continue;
      this.ext[name] = pg.escapeIdentifier(rows[0].schema);
      await this.pool.query(EXTRAS[name](this.ext[name]));
    }
  }

  static async connect(connectionString: string) {
    const store = new PgAtlasStore(new pg.Pool({ connectionString, max: 4, options: '-c search_path=atlas' }));
    await store.migrate();
    await store.prepareExtras();
    await store.seedPacks();
    return store;
  }

  /** Brings the schema up to date. Safe to run from several instances at once. */
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('atlas.migrate'))");
      // On a server the platform makes the schema for Data Atlas's login, which may not create schemas
      // itself: Postgres checks that right even for "if not exists", so only ask when there is none.
      const { rowCount } = await client.query("select 1 from pg_namespace where nspname = 'atlas'");
      if (!rowCount) await client.query('create schema atlas');
      await client.query('create table if not exists atlas.migrations (id text primary key, applied_at timestamptz not null default now())');
      const { rows } = await client.query<{ id: string }>('select id from atlas.migrations');
      const applied = new Set(rows.map((r) => r.id));
      for (const m of migrations.filter((m) => !applied.has(m.id))) {
        await client.query(m.sql);
        await client.query('insert into atlas.migrations (id) values ($1)', [m.id]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }

  async ontology(): Promise<Ontology> {
    const [version, types, details] = await Promise.all([
      this.pool.query<{ version: number }>('select coalesce(max(version), 0) as version from atlas.ontology_versions'),
      this.pool.query<{ key: string; parent: string | null; label: string; plural: string; abstract: boolean; icon: string; pack: string; pack_term: string; pack_iri: string | null }>(
        'select key, parent, label, plural, abstract, icon, pack, pack_term, pack_iri from atlas.ontology_types order by sort, key',
      ),
      this.pool.query<{ type: string; key: string; label: string; kind: DetailDef['kind']; identity: boolean; pattern: string | null; hint: string | null; on_entity: boolean; pack_iri: string | null }>(
        'select type, key, label, kind, identity, pattern, hint, on_entity, pack_iri from atlas.ontology_details order by type, sort, key',
      ),
    ]);
    const relations = await this.pool.query<{ key: string; label: string; inverse: string; from_types: string[]; to_types: string[]; pack: string; pack_term: string; pack_iri: string | null }>(
      'select key, label, inverse, from_types, to_types, pack, pack_term, pack_iri from atlas.ontology_relations order by sort, key',
    );
    return {
      version: version.rows[0].version,
      types: types.rows.map(
        (t): TypeDef => ({
          key: t.key,
          label: t.label,
          plural: t.plural,
          ...(t.parent ? { parent: t.parent } : {}),
          abstract: t.abstract,
          icon: t.icon,
          pack: t.pack,
          packTerm: t.pack_term,
          ...(t.pack_iri ? { packIri: t.pack_iri } : {}),
          details: details.rows
            .filter((d) => d.type === t.key)
            .map((d) => ({
              key: d.key,
              label: d.label,
              kind: d.kind,
              identity: d.identity,
              ...(d.pattern ? { pattern: d.pattern } : {}),
              ...(d.hint ? { hint: d.hint } : {}),
              ...(d.on_entity ? {} : { onEntity: false }),
              ...(d.pack_iri ? { packIri: d.pack_iri } : {}),
            })),
        }),
      ),
      relations: relations.rows.map(
        (r): RelationDef => ({ key: r.key, label: r.label, inverse: r.inverse, from: r.from_types, to: r.to_types, pack: r.pack, packTerm: r.pack_term, ...(r.pack_iri ? { packIri: r.pack_iri } : {}) }),
      ),
    };
  }

  /** Keeps the packs that come with Data Atlas as this release has them. Run at each start. */
  async seedPacks() {
    for (const p of BUILT_IN_PACKS) {
      await this.pool.query(
        `insert into atlas.ontology_packs (id, name, version, licence, source, terms, built_in) values ($1, $2, $3, $4, $5, $6, true)
         on conflict (id) do update set name = $2, version = $3, licence = $4, source = $5, terms = $6 where atlas.ontology_packs.built_in`,
        [p.id, p.name, p.version, p.licence, p.source, JSON.stringify(p.terms)],
      );
    }
  }

  async packs(): Promise<PackSummary[]> {
    const { rows } = await this.pool.query<{ id: string; name: string; version: string; licence: string; source: string; terms: number; built_in: boolean; loaded_by: string | null; loaded_at: Date }>(
      'select id, name, version, licence, source, jsonb_array_length(terms) as terms, built_in, loaded_by, loaded_at from atlas.ontology_packs order by built_in desc, name',
    );
    return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, licence: r.licence, source: r.source, terms: Number(r.terms), builtIn: r.built_in, ...(r.loaded_by ? { loadedBy: r.loaded_by } : {}), loadedAt: r.loaded_at.toISOString() }));
  }

  async pack(id: string): Promise<(Pack & { builtIn: boolean }) | undefined> {
    const { rows } = await this.pool.query<{ id: string; name: string; version: string; licence: string; source: string; terms: Pack['terms']; built_in: boolean }>(
      'select id, name, version, licence, source, terms, built_in from atlas.ontology_packs where id = $1',
      [id],
    );
    return rows[0] && { id: rows[0].id, name: rows[0].name, version: rows[0].version, licence: rows[0].licence, source: rows[0].source, terms: rows[0].terms, builtIn: rows[0].built_in };
  }

  /** Loads a pack, or a newer copy of one an admin loaded before. False if the id is a built-in pack's. */
  async savePack(p: Pack, by: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `insert into atlas.ontology_packs (id, name, version, licence, source, terms, loaded_by) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set name = $2, version = $3, licence = $4, source = $5, terms = $6, loaded_by = $7, loaded_at = now() where not atlas.ontology_packs.built_in`,
      [p.id, p.name, p.version, p.licence, p.source, JSON.stringify(p.terms), by],
    );
    return !!rowCount;
  }

  async versions(limit = 100): Promise<OntologyVersion[]> {
    const { rows } = await this.pool.query<{ version: number; note: string; changed_by: string | null; changes: OntologyChange[]; made_at: Date }>(
      `select version, note, changed_by, changes, made_at from atlas.ontology_versions order by version desc limit ${Number(limit)}`,
    );
    return rows.map((r) => ({ version: r.version, note: r.note, ...(r.changed_by ? { changedBy: r.changed_by } : {}), changes: r.changes, madeAt: r.made_at.toISOString() }));
  }

  /**
   * Makes a new version of the ontology from changes already checked
   * (studio.ts), tells other apps, and decides the candidate terms it adopts.
   * The new version's number.
   */
  async changeOntology(changes: OntologyChange[], by: string, note: string, adopts: { kind: ProposedTerm['kind']; name: string; key: string }[] = []): Promise<number> {
    return this.inTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext('atlas.ontology'))");
      const { rows } = await client.query<{ version: number }>('select coalesce(max(version), 0) + 1 as version from atlas.ontology_versions');
      const version = rows[0].version;
      for (const c of changes) await applyChange(client, c);
      await client.query('insert into atlas.ontology_versions (version, note, changed_by, changes) values ($1, $2, $3, $4)', [version, note, by, JSON.stringify(changes)]);
      await client.query("insert into atlas.outbox (topic, payload) values ('atlas.ontology.changed', $1)", [JSON.stringify({ version })]);
      for (const a of adopts) await decideTerms(client, a.kind, a.name, { as: 'adopted', version, key: a.key }, by);
      return version;
    });
  }

  /** Terms sources asked for that no admin has decided yet, the most asked for first. */
  async termCandidates(limit = 200): Promise<TermCandidate[]> {
    const { rows } = await this.pool.query<{ kind: ProposedTerm['kind']; name: string; asked: string; first_at: Date; last_at: Date; parents: (string | null)[]; note: string | null }>(
      `select i.body->>'kind' as kind, min(i.body->>'name') as name, count(*) as asked, min(p.created_at) as first_at, max(p.created_at) as last_at,
              array_agg(distinct i.body->>'parent') as parents, max(i.body->>'note') as note
       from atlas.proposal_items i join atlas.proposals p on p.id = i.proposal
       where i.kind = 'term' and i.decision is null
       group by i.body->>'kind', lower(i.body->>'name')
       order by count(*) desc, max(p.created_at) desc limit ${Number(limit)}`,
    );
    return rows.map((r) => ({ kind: r.kind, name: r.name, asked: Number(r.asked), firstAt: r.first_at.toISOString(), lastAt: r.last_at.toISOString(), parents: r.parents.filter((x): x is string => !!x), ...(r.note ? { note: r.note } : {}) }));
  }

  /** Decides every undecided ask for a term at once. How many there were. */
  async decideTerm(kind: ProposedTerm['kind'], name: string, decision: TermDecision, by: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      return await decideTerms(client, kind, name, decision, by);
    } finally {
      client.release();
    }
  }

  /** Where Data Atlas has read other apps' events up to. */
  async eventCursor(): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ seq: string }>('select seq from atlas.event_cursor where id = 1');
    return rows[0]?.seq;
  }

  async saveEventCursor(seq: string) {
    await this.pool.query('insert into atlas.event_cursor (id, seq) values (1, $1) on conflict (id) do update set seq = $1', [seq]);
  }

  /** Notes that something in another app uses an entity. Doing it twice does no harm. */
  async bind(u: Omit<UsedBy, 'since'>) {
    await this.pool.query(
      'insert into atlas.used_by (app, item_kind, item_id, entity, role, workspace_id) values ($1, $2, $3, $4, $5, $6) on conflict do nothing',
      [u.app, u.kind, u.id, u.entity, u.role, u.workspace],
    );
  }

  /** Forgets that use; without a role, every role it had. */
  async unbind(u: { app: string; kind: string; id: string; entity: string; role?: string }) {
    await this.pool.query('delete from atlas.used_by where app = $1 and item_kind = $2 and item_id = $3 and entity = $4 and ($5::text is null or role = $5)', [u.app, u.kind, u.id, u.entity, u.role ?? null]);
  }

  async usedBy(entity: string): Promise<UsedBy[]> {
    const { rows } = await this.pool.query<{ app: string; item_kind: string; item_id: string; role: string; workspace_id: string; since: Date }>(
      'select app, item_kind, item_id, role, workspace_id, since from atlas.used_by where entity = $1 order by since desc limit 200',
      [entity],
    );
    return rows.map((r) => ({ app: r.app, kind: r.item_kind, id: r.item_id, entity, role: r.role, workspace: r.workspace_id, since: r.since.toISOString() }));
  }

  /** The documents observations of an entity came from, on these floors, the latest first. */
  async mentionedIn(entity: string, floors: readonly string[]): Promise<MentionedIn[]> {
    const { rows } = await this.pool.query<{ app: string; id: string; title: string; observations: string; last_at: Date; withdrawn: boolean }>(
      `select source->'document'->>'app' as app, source->'document'->>'id' as id, max(source->'document'->>'title') as title,
              count(*) as observations, max(created_at) as last_at, bool_and(retracted_at is not null) as withdrawn
       from atlas.observations
       where (entity = $1 or target = $1) and floor = any($2) and source->>'kind' = 'document'
       group by 1, 2 order by max(created_at) desc limit 100`,
      [entity, floors],
    );
    return rows.map((r) => ({ app: r.app, id: r.id, title: r.title, observations: Number(r.observations), lastAt: r.last_at.toISOString(), withdrawn: r.withdrawn }));
  }

  /**
   * A document was withdrawn or deleted in the app that keeps it: what was read
   * from it stops counting as evidence (it's kept, saying why), and proposals
   * still waiting on it say so. How many observations and proposals it touched.
   */
  async retractDocument(app: string, document: string, why: string): Promise<{ observations: number; proposals: number }> {
    return this.inTransaction(async (client) => {
      const observations = await client.query(
        `update atlas.observations set retracted_at = now(), retracted_why = $3
         where source->>'kind' = 'document' and source->'document'->>'app' = $1 and source->'document'->>'id' = $2 and retracted_at is null`,
        [app, document, why],
      );
      const proposals = await client.query(
        `update atlas.proposals set source_gone = $3
         where state = 'open' and source->>'kind' = 'document' and source->'document'->>'app' = $1 and source->'document'->>'id' = $2`,
        [app, document, why],
      );
      return { observations: observations.rowCount ?? 0, proposals: proposals.rowCount ?? 0 };
    });
  }

  async entity(id: string): Promise<Entity | undefined> {
    const { rows } = await this.pool.query<EntityRow>(`select ${ENTITY_COLUMNS} from atlas.entities where id = $1`, [id]);
    return rows[0] && fromRow(rows[0]);
  }

  /** Entities by id, active or retired, in no order; ids that aren't any are left out. */
  async entitiesById(ids: readonly string[]): Promise<Entity[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query<EntityRow>(`select ${ENTITY_COLUMNS} from atlas.entities where id = any($1)`, [ids]);
    return rows.map(fromRow);
  }

  /** Active entities kept on the given floors, by name. */
  async entities({ floors, q, types, limit = 50, offset = 0 }: EntityQuery): Promise<{ entities: Entity[]; total: number }> {
    const where = ["state = 'active'", 'floor = any($1)'];
    const params: unknown[] = [floors];
    if (types?.length) {
      params.push(types);
      where.push(`type = any($${params.length})`);
    }
    const words = q?.trim();
    if (words) {
      params.push(`%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, words.replace(/\s+/g, '').toUpperCase());
      const like = `$${params.length - 1}`;
      const key = `$${params.length}`;
      where.push(
        `(label ilike ${like} or exists (select 1 from unnest(aliases) a where a ilike ${like}) or exists (select 1 from atlas.entity_keys k where k.entity = entities.id and upper(k.value) = ${key}))`,
      );
    }
    const filter = where.join(' and ');
    const [found, count] = await Promise.all([
      this.pool.query<EntityRow>(`select ${ENTITY_COLUMNS} from atlas.entities where ${filter} order by lower(label), id limit ${Number(limit)} offset ${Number(offset)}`, params),
      this.pool.query<{ total: string }>(`select count(*) as total from atlas.entities where ${filter}`, params),
    ]);
    return { entities: found.rows.map(fromRow), total: Number(count.rows[0].total) };
  }

  async createEntity(e: NewEntity, ontology: Ontology): Promise<Entity> {
    const id = newEntityId();
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<EntityRow>(
        `insert into atlas.entities (id, type, label, aliases, description, details, workspace_id, floor, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning ${ENTITY_COLUMNS}`,
        [id, e.type, e.label, e.aliases ?? [], e.description ?? '', e.details ?? {}, e.workspace, e.floor, e.createdBy],
      );
      await this.keepKeys(client, id, e.type, e.details ?? {}, ontology);
      await tell(client, 'created', rows[0]);
      return fromRow(rows[0]);
    });
  }

  async updateEntity(id: string, change: EntityChange, by: string, ontology: Ontology): Promise<Entity | undefined> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<EntityRow>(
        `update atlas.entities set
           label = coalesce($2, label), aliases = coalesce($3, aliases), description = coalesce($4, description), details = coalesce($5, details),
           updated_by = $6, updated_at = now()
         where id = $1 and state = 'active' returning ${ENTITY_COLUMNS}`,
        [id, change.label ?? null, change.aliases ?? null, change.description ?? null, change.details ?? null, by],
      );
      if (!rows[0]) return undefined;
      if (change.details) await this.keepKeys(client, id, rows[0].type, change.details, ontology);
      await tell(client, 'changed', rows[0]);
      return fromRow(rows[0]);
    });
  }

  /** Takes an entity out of use. It keeps its id, so what points at it still says what it was. */
  async retireEntity(id: string, by: string): Promise<Entity | undefined> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<EntityRow>(
        `update atlas.entities set state = 'retired', updated_by = $2, updated_at = now() where id = $1 and state = 'active' returning ${ENTITY_COLUMNS}`,
        [id, by],
      );
      // Its identity keys are free again: a retired entity is no longer the thing they name.
      if (!rows[0]) return undefined;
      await client.query('delete from atlas.entity_keys where entity = $1', [id]);
      await tell(client, 'retired', rows[0]);
      return fromRow(rows[0]);
    });
  }

  /** Writes an entity's identity keys afresh, refusing one another entity holds. */
  private async keepKeys(client: pg.PoolClient, id: string, type: string, details: Record<string, string>, ontology: Ontology) {
    await client.query('delete from atlas.entity_keys where entity = $1', [id]);
    for (const detail of detailsOf(ontology, type).filter((d) => d.identity && details[d.key])) {
      const value = details[detail.key];
      const { rows } = await client.query<{ id: string; type: string; label: string; floor: string }>(
        `select e.id, e.type, e.label, e.floor from atlas.entity_keys k join atlas.entities e on e.id = k.entity where k.type = $1 and k.key = $2 and k.value = $3`,
        [type, detail.key, value],
      );
      if (rows[0]) throw new KeyTakenError(detail, value, rows[0]);
      await client.query('insert into atlas.entity_keys (entity, type, key, value) values ($1, $2, $3, $4)', [id, type, detail.key, value]);
    }
  }

  /** Records what someone saw or read. Observations are only ever added. */
  async addObservation(o: NewObservation): Promise<Observation> {
    const { rows } = await this.pool.query<ObservationRow>(
      `insert into atlas.observations (id, entity, property, value, target, observed_at, floor, workspace_id, source, grade, note, reported_under, raised_from, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning ${OBSERVATION_COLUMNS}`,
      [
        `obs_${ulid()}`,
        o.entity,
        o.property,
        o.value ?? null,
        o.target ?? null,
        o.observedAt ?? null,
        o.floor,
        o.workspace,
        JSON.stringify(o.source),
        o.grade ?? null,
        o.note,
        o.reportedUnder === undefined ? null : JSON.stringify(o.reportedUnder),
        o.raisedFrom ?? null,
        o.createdBy,
      ],
    );
    return fromObservationRow(rows[0]);
  }

  async observation(id: string): Promise<Observation | undefined> {
    const { rows } = await this.pool.query<ObservationRow>(`select ${OBSERVATION_COLUMNS} from atlas.observations where id = $1`, [id]);
    return rows[0] && fromObservationRow(rows[0]);
  }

  async observationsById(ids: readonly string[]): Promise<Observation[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query<ObservationRow>(`select ${OBSERVATION_COLUMNS} from atlas.observations where id = any($1)`, [ids]);
    return rows.map(fromObservationRow);
  }

  /** Observations about an entity, or naming it as a link's other end, on these floors, newest first. */
  async observations(entity: string, floors: readonly string[], limit = 100): Promise<Observation[]> {
    const { rows } = await this.pool.query<ObservationRow>(
      `select ${OBSERVATION_COLUMNS} from atlas.observations where (entity = $1 or target = $1) and floor = any($2) order by coalesce(observed_at, created_at) desc, id desc limit ${Number(limit)}`,
      [entity, floors],
    );
    return rows.map(fromObservationRow);
  }

  /** Whether a raised copy of this observation is already on that floor. */
  async raisedTo(observation: string, floor: string): Promise<Observation | undefined> {
    const { rows } = await this.pool.query<ObservationRow>(`select ${OBSERVATION_COLUMNS} from atlas.observations where raised_from = $1 and floor = $2`, [observation, floor]);
    return rows[0] && fromObservationRow(rows[0]);
  }

  /**
   * Records a fact. `replaces` are the floor's current records it takes over from
   * (on the recorded clock); if any was replaced meanwhile, nothing is recorded.
   */
  async addFact(f: NewFact, replaces: readonly string[] = []): Promise<Fact | undefined> {
    const id = `fct_${ulid()}`;
    return this.inTransaction(async (client) => {
      if (replaces.length) {
        const { rowCount } = await client.query(
          'update atlas.facts set superseded_at = clock_timestamp(), superseded_by = $2 where id = any($1) and superseded_at is null',
          [replaces, id],
        );
        if (rowCount !== replaces.length) return undefined;
      }
      const { rows } = await client.query<FactRow>(
        `insert into atlas.facts (id, entity, property, value, target, valid_from, valid_to, floor, workspace_id, backed_by, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning ${FACT_COLUMNS}`,
        [id, f.entity, f.property, f.value ?? null, f.target ?? null, f.validFrom ?? null, f.validTo ?? null, f.floor, f.workspace, f.backedBy, f.note, f.createdBy],
      );
      return fromFactRow(rows[0]);
    });
  }

  /** Takes a fact back from now on: its record is superseded by nothing. */
  async withdrawFact(id: string): Promise<Fact | undefined> {
    const { rows } = await this.pool.query<FactRow>(
      `update atlas.facts set superseded_at = clock_timestamp() where id = $1 and superseded_at is null returning ${FACT_COLUMNS}`,
      [id],
    );
    return rows[0] && fromFactRow(rows[0]);
  }

  async fact(id: string): Promise<Fact | undefined> {
    const { rows } = await this.pool.query<FactRow>(`select ${FACT_COLUMNS} from atlas.facts where id = $1`, [id]);
    return rows[0] && fromFactRow(rows[0]);
  }

  /** The floor's current records for one of an entity's details: what a new record of it replaces. */
  async currentFacts(entity: string, property: string, floor: string): Promise<Fact[]> {
    const { rows } = await this.pool.query<FactRow>(
      `select ${FACT_COLUMNS} from atlas.facts where entity = $1 and property = $2 and floor = $3 and superseded_at is null`,
      [entity, property, floor],
    );
    return rows.map(fromFactRow);
  }

  /** Facts about these entities, or linking to them, as the query has them in time. */
  async facts(entities: readonly string[], { floors, at, known }: FactQuery): Promise<Fact[]> {
    if (!entities.length) return [];
    const now = new Date().toISOString();
    const { rows } = await this.pool.query<FactRow>(
      `select ${FACT_COLUMNS} from atlas.facts
       where (entity = any($1) or target = any($1)) and floor = any($4) and ${FACT_IN_TIME}
       order by property, recorded_at desc`,
      [entities, at ?? now, known ?? now, floors],
    );
    return rows.map(fromFactRow);
  }

  /** How many links each of these entities has, as the query has them in time: how strongly each is tied in. */
  async linkCounts(entities: readonly string[], { floors, at, known }: FactQuery): Promise<Map<string, number>> {
    if (!entities.length) return new Map();
    const now = new Date().toISOString();
    const { rows } = await this.pool.query<{ id: string; n: string }>(
      `select id, count(*) as n from (
         select entity as id from atlas.facts where entity = any($1) and target is not null and floor = any($4) and ${FACT_IN_TIME}
         union all
         select target from atlas.facts where target = any($1) and floor = any($4) and ${FACT_IN_TIME}
       ) ends group by id`,
      [entities, at ?? now, known ?? now, floors],
    );
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  /** Every record a fact's line has had, oldest first: the recorded clock, for "as known on". */
  async factHistory(entity: string, floors: readonly string[]): Promise<Fact[]> {
    const { rows } = await this.pool.query<FactRow>(
      `select ${FACT_COLUMNS} from atlas.facts where (entity = $1 or target = $1) and floor = any($2) order by recorded_at, id`,
      [entity, floors],
    );
    return rows.map(fromFactRow);
  }

  async addDispute(d: Omit<Dispute, 'id' | 'at'>): Promise<Dispute> {
    const { rows } = await this.pool.query<DisputeRow>(
      'insert into atlas.fact_disputes (id, fact, floor, note, by_person) values ($1, $2, $3, $4, $5) returning *',
      [`dsp_${ulid()}`, d.fact, d.floor, d.note, d.by],
    );
    return fromDisputeRow(rows[0]);
  }

  async dispute(id: string): Promise<Dispute | undefined> {
    const { rows } = await this.pool.query<DisputeRow>('select * from atlas.fact_disputes where id = $1', [id]);
    return rows[0] && fromDisputeRow(rows[0]);
  }

  /** Disputes on these facts that no one has cleared. */
  async openDisputes(facts: readonly string[]): Promise<Dispute[]> {
    if (!facts.length) return [];
    const { rows } = await this.pool.query<DisputeRow>('select * from atlas.fact_disputes where fact = any($1) and cleared_at is null order by at', [facts]);
    return rows.map(fromDisputeRow);
  }

  async clearDispute(id: string, by: string): Promise<Dispute | undefined> {
    const { rows } = await this.pool.query<DisputeRow>('update atlas.fact_disputes set cleared_by = $2, cleared_at = now() where id = $1 and cleared_at is null returning *', [id, by]);
    return rows[0] && fromDisputeRow(rows[0]);
  }

  /** A connection pool whose search path is Data Atlas's schema, for the outbox relay, which names its table plainly. */
  static outboxPool(connectionString: string) {
    return new pg.Pool({ connectionString, max: 2, options: '-c search_path=atlas' });
  }

  /** Active entities on these floors that hold an identity key with this value, of any kind that has it. */
  async byKey(key: string, value: string, floors: readonly string[]): Promise<Entity[]> {
    const { rows } = await this.pool.query<EntityRow>(
      `select ${ENTITY_COLUMNS} from atlas.entities where state = 'active' and floor = any($3)
         and id in (select entity from atlas.entity_keys where key = $1 and upper(value) = upper($2))`,
      [key, value, floors],
    );
    return rows.map(fromRow);
  }

  /** Active entities on these floors called exactly this, by name or another name, ignoring case. */
  async byName(name: string, floors: readonly string[], types?: readonly string[]): Promise<Entity[]> {
    const { rows } = await this.pool.query<EntityRow>(
      `select ${ENTITY_COLUMNS} from atlas.entities where state = 'active' and floor = any($2) and ($3::text[] is null or type = any($3))
         and (lower(label) = lower($1) or exists (select 1 from unnest(aliases) a where lower(a) = lower($1)))
       order by lower(label), id limit 20`,
      [name, floors, types ?? null],
    );
    return rows.map(fromRow);
  }

  /**
   * Active entities on these floors whose name or another name is spelt nearly
   * like this (pg_trgm), closest first, with how close and the name that's close.
   * Empty where the database hasn't pg_trgm.
   */
  async bySpelling(name: string, floors: readonly string[], { types, without = [], limit = 5, least = 0.3 }: { types?: readonly string[]; without?: readonly string[]; limit?: number; least?: number } = {}) {
    if (!this.can.spelling) return [];
    const t = this.ext.spelling;
    const { rows } = await this.pool.query<EntityRow & { score: number; close: string }>(
      `select * from (
         select e.*, n.name as close, ${t}.similarity(lower(n.name), lower($1)) as score,
                row_number() over (partition by e.id order by ${t}.similarity(lower(n.name), lower($1)) desc) as nth
         from atlas.entities e cross join lateral (select e.label as name union all select unnest(e.aliases)) n
         where e.state = 'active' and e.floor = any($2) and ($3::text[] is null or e.type = any($3)) and not (e.id = any($4))
           and lower(n.name) operator(${t}.%) lower($1)
       ) found where nth = 1 and score >= $5 order by score desc, id limit ${Number(limit)}`,
      [name, floors, types ?? null, without, least],
    );
    return rows.map((r) => ({ entity: fromRow(r), score: Number(r.score), close: r.close }));
  }

  /** Active entities with no vector from this model, or one made from what they used to say: the next to embed. */
  async unembedded(model: string, limit = 64, skip: readonly string[] = []): Promise<Entity[]> {
    if (!this.can.meaning) return [];
    const { rows } = await this.pool.query<EntityRow>(
      `select ${ENTITY_COLUMNS.split(', ').map((c) => `e.${c}`).join(', ')} from atlas.entities e left join atlas.entity_vectors v on v.entity = e.id
       where e.state = 'active' and not (e.workspace_id = any($2)) and (v.entity is null or v.model <> $1 or v.made_at < e.updated_at) order by e.updated_at limit ${Number(limit)}`,
      [model, skip],
    );
    return rows.map(fromRow);
  }

  /** Keeps entities' vectors, replacing any older ones. */
  async saveVectors(model: string, vectors: { entity: string; source: string; embedding: number[] }[]) {
    for (const v of vectors) {
      await this.pool.query(
        `insert into atlas.entity_vectors (entity, model, source, embedding) values ($1, $2, $3, $4::${this.ext.meaning}.vector)
         on conflict (entity) do update set model = excluded.model, source = excluded.source, embedding = excluded.embedding, made_at = now()`,
        [v.entity, model, v.source, `[${v.embedding.join(',')}]`],
      );
    }
  }

  /** Active entities on these floors whose vector from this model is nearest this one, nearest first, with how near (cosine, 0 to 1). */
  async byMeaning(embedding: number[], model: string, floors: readonly string[], { types, without = [], limit = 5, least = 0.6 }: { types?: readonly string[]; without?: readonly string[]; limit?: number; least?: number } = {}) {
    if (!this.can.meaning) return [];
    const x = this.ext.meaning;
    const { rows } = await this.pool.query<EntityRow & { score: number }>(
      `select * from (
         select ${ENTITY_COLUMNS.split(', ').map((c) => `e.${c}`).join(', ')}, 1 - (v.embedding operator(${x}.<=>) $1::${x}.vector) as score
         from atlas.entity_vectors v join atlas.entities e on e.id = v.entity
         where v.model = $2 and ${x}.vector_dims(v.embedding) = $7 and e.state = 'active' and e.floor = any($3) and ($4::text[] is null or e.type = any($4)) and not (e.id = any($5))
         order by v.embedding operator(${x}.<=>) $1::${x}.vector limit ${Number(limit)}
       ) near where score >= $6 order by score desc`,
      [`[${embedding.join(',')}]`, model, floors, types ?? null, without, least, embedding.length],
    );
    return rows.map((r) => ({ entity: fromRow(r), score: Number(r.score) }));
  }

  async addProposal(p: Omit<Proposal, 'id' | 'state' | 'createdAt'>, items: ProposalItem[]): Promise<Proposal> {
    const id = `prp_${ulid()}`;
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<ProposalRow>(
        `insert into atlas.proposals (id, floor, workspace_id, source, producer, ontology_version, created_by, matching) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [id, p.floor, p.workspace, JSON.stringify(p.source), JSON.stringify(p.producer), p.ontologyVersion, p.createdBy, p.matching ? JSON.stringify(p.matching) : null],
      );
      for (const [n, item] of items.entries()) {
        await client.query('insert into atlas.proposal_items (proposal, key, kind, body, matches, sort) values ($1, $2, $3, $4, $5, $6)', [
          id,
          item.key,
          item.kind,
          JSON.stringify(item.body),
          JSON.stringify(item.matches),
          n,
        ]);
      }
      return fromProposalRow(rows[0]);
    });
  }

  async proposal(id: string): Promise<{ proposal: Proposal; items: ProposalItem[] } | undefined> {
    const [found, items] = await Promise.all([
      this.pool.query<ProposalRow>('select * from atlas.proposals where id = $1', [id]),
      this.pool.query<ItemRow>('select * from atlas.proposal_items where proposal = $1 order by sort', [id]),
    ]);
    return found.rows[0] && { proposal: fromProposalRow(found.rows[0]), items: items.rows.map(fromItemRow) };
  }

  /** A floor's proposals in one state, newest first, with how much of each is decided. */
  async proposals(floor: string, state: Proposal['state'] | 'closed', limit = 100): Promise<ProposalSummary[]> {
    const { rows } = await this.pool.query<ProposalRow & { items: string; decided: string }>(
      `select p.*,
         (select count(*) from atlas.proposal_items i where i.proposal = p.id and i.kind <> 'term') as items,
         (select count(*) from atlas.proposal_items i where i.proposal = p.id and i.kind <> 'term' and i.decision is not null) as decided
       from atlas.proposals p where p.floor = $1 and (p.state = $2 or ($2 = 'closed' and p.state <> 'open'))
       order by coalesce(p.closed_at, p.created_at) desc limit ${Number(limit)}`,
      [floor, state],
    );
    return rows.map((r) => ({ ...fromProposalRow(r), items: Number(r.items), decided: Number(r.decided) }));
  }

  /** Records a decision on an item still undecided in an open proposal. Undefined if someone decided it first. */
  async decide(proposal: string, key: string, decision: MentionDecision | ObservationDecision, by: string): Promise<ProposalItem | undefined> {
    const { rows } = await this.pool.query<ItemRow>(
      `update atlas.proposal_items set decision = $3, decided_by = $4, decided_at = now()
       where proposal = $1 and key = $2 and decision is null and exists (select 1 from atlas.proposals where id = $1 and state = 'open')
       returning *`,
      [proposal, key, JSON.stringify(decision), by],
    );
    return rows[0] && fromItemRow(rows[0]);
  }

  /** New matches for an open proposal's undecided mentions, and how they were found. */
  async rematch(proposal: string, matches: Map<string, Match[]>, matching: Matching): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const { rowCount } = await client.query(`update atlas.proposals set matching = $2 where id = $1 and state = 'open'`, [proposal, JSON.stringify(matching)]);
      if (!rowCount) return false;
      for (const [key, found] of matches) {
        await client.query(`update atlas.proposal_items set matches = $3 where proposal = $1 and key = $2 and kind = 'mention' and decision is null`, [proposal, key, JSON.stringify(found)]);
      }
      return true;
    });
  }

  /** Finishes or withdraws an open proposal. */
  async closeProposal(id: string, state: 'finished' | 'withdrawn', by: string): Promise<Proposal | undefined> {
    const { rows } = await this.pool.query<ProposalRow>(
      `update atlas.proposals set state = $2, closed_by = $3, closed_at = now() where id = $1 and state = 'open' returning *`,
      [id, state, by],
    );
    return rows[0] && fromProposalRow(rows[0]);
  }

  /** Events not yet sent, oldest first: for tests, and to see what's waiting. */
  async unsent(): Promise<{ topic: string; workspace: string | null; payload: unknown }[]> {
    const { rows } = await this.pool.query<{ topic: string; workspace_id: string | null; payload: unknown }>('select topic, workspace_id, payload from atlas.outbox where sent_at is null order by id');
    return rows.map((r) => ({ topic: r.topic, workspace: r.workspace_id, payload: r.payload }));
  }

  private async inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      // Two people adding the same key at once: the second hears who has it, as if they'd been second all along.
      if ((err as { code?: string }).code === '23505' && (err as { constraint?: string }).constraint === 'entity_keys_type_key_value_key') {
        throw new Error('That identity key was just given to another entity. Try again to see which.', { cause: err });
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
