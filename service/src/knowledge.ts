import type { People } from './people.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OnFloor } from './app.ts';
import type { Audit } from './audit.ts';
import { floorPrincipal, type Unseen } from './floors.ts';
import { checkDetail, detailsOf, isA, normaliseDetail, relationsFrom, withSubtypes, type DetailDef, type Ontology, type RelationDef } from './ontology.ts';
import { refOf, type Entity, type Fact, type KeyTakenError, type Observation, type PgAtlasStore, type Source } from './store.ts';
import type { Resolver } from './resolve.ts';

/**
 * What is known about entities: observations (what someone saw or read, as
 * they said it) and facts (what a floor accepts as so, on two clocks). Both are
 * fenced by floor like entities are, and a lead raises an observation to a
 * floor above, where it is worth more (Harry's Q2 answer). Links between
 * entities are facts whose value is another entity.
 */

/** What the knowledge routes need from the rest of the service. */
export interface Atlas {
  store: PgAtlasStore;
  onFloor(req: FastifyRequest, reply: FastifyReply): OnFloor | undefined;
  sight(caller: OnFloor): Promise<{ principals: string[]; floors: string[] }>;
  nameFloors(caller: OnFloor, floors: readonly string[]): Promise<(floor: string) => string>;
  seen(req: FastifyRequest, reply: FastifyReply, id: string): Promise<{ caller: OnFloor; entity: Entity } | undefined>;
  recorded(entry: Parameters<Audit>[0]): unknown;
  unseenFrom(caller: OnFloor, floor: string, principals: readonly string[], floorName: string): Unseen;
  /** Checks and tidies details against the ontology; the first problem, in words. */
  tidyDetails(ontology: Ontology, type: string, given: Record<string, string>): Record<string, string> | string;
  /** A refusal for an identity key another entity holds, naming it when the caller may see it. */
  keyTaken(caller: OnFloor, err: KeyTakenError): Promise<object>;
  /** Which existing entities a proposal's mentions may be (resolve.ts). */
  resolver: Resolver;
  people: People;
}

/** The other end of a link, as the caller may see it: the entity, or why not. */
export type OtherEnd =
  | { kind: 'entity'; id: string; type: string; label: string; state: Entity['state']; floorName: string }
  | ({ id: string; hidden: true } & Unseen)
  | { id: string; missing: true };

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

export const ID_PARAMS = { type: 'object', properties: { id: { type: 'string', maxLength: 64 } }, required: ['id'] } as const;
export const WHEN = { type: 'string', minLength: 10, maxLength: 40 } as const;
export const NOTE = { type: 'string', maxLength: 2000 } as const;
// One flat shape, checked further in code: Fastify's validator strips unknown properties, which breaks `oneOf`.
export const SOURCE = {
  type: 'object',
  properties: {
    kind: { enum: ['person', 'document', 'other'] },
    document: {
      type: 'object',
      properties: {
        app: { type: 'string', minLength: 1, maxLength: 40 },
        id: { type: 'string', minLength: 1, maxLength: 200 },
        version: { type: 'string', maxLength: 40 },
        title: { type: 'string', minLength: 1, maxLength: 300 },
      },
      required: ['app', 'id', 'title'],
      additionalProperties: false,
    },
    note: { type: 'string', minLength: 1, maxLength: 500 },
    // The block of the document it was read in.
    anchor: { type: 'string', minLength: 1, maxLength: 120 },
  },
  required: ['kind'],
  additionalProperties: false,
} as const;

/** A source as kept: only what its kind needs, or why it won't do. */
export const sourceOf = (given: { kind: Source['kind']; document?: { app: string; id: string; version?: string; title: string }; note?: string; anchor?: string }): Source | string => {
  if (given.kind === 'person') return { kind: 'person' };
  if (given.kind === 'document') return given.document ? { kind: 'document', document: given.document, ...(given.anchor ? { anchor: given.anchor } : {}) } : 'Say which document it came from.';
  return given.note?.trim() ? { kind: 'other', note: given.note.trim() } : 'Say where it came from.';
};

/** A time from a request, as ISO; undefined if absent, and `false` if it isn't a time. */
export const when = (value: string | undefined): string | undefined | false => {
  if (value === undefined || value === '') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? false : new Date(ms).toISOString();
};

/** A detail or a link an entity of this type can have. */
type Property = { kind: 'detail'; def: DetailDef } | { kind: 'relation'; def: RelationDef };

export const propertyOf = (ontology: Ontology, type: string, key: string): Property | undefined => {
  const detail = detailsOf(ontology, type).find((d) => d.key === key);
  if (detail) return { kind: 'detail', def: detail };
  const relation = relationsFrom(ontology, type).find((r) => r.key === key);
  return relation && { kind: 'relation', def: relation };
};

/** Leads accept and raise for a floor; on your own floor, that's you. */
export const leadsHere = (caller: OnFloor) => caller.workspace.kind === 'personal' || caller.workspace.role === 'lead';
export const LEADS_ONLY = 'Only this floor’s leads accept what’s so here, and raise what’s seen to a floor above.';

/** The floors above the one the caller stands on: what an observation here may be raised to. */
const floorsAbove = (caller: OnFloor, floors: readonly string[]) => {
  const here = floorPrincipal(caller.id, caller.workspace);
  return floors.filter((f) => f !== here && !f.startsWith('person:'));
};

/** Names other entities as the caller may see them, saying why for any they can't. */
export const otherEnds = async (atlas: Atlas, caller: OnFloor, ids: readonly string[], sight: { principals: string[]; floors: string[] }) => {
  const found = new Map((await atlas.store.entitiesById([...new Set(ids)])).map((e) => [e.id, e]));
  const named = await atlas.nameFloors(caller, [...found.values()].map((e) => e.floor));
  return (id: string): OtherEnd => {
    const e = found.get(id);
    if (!e) return { id, missing: true };
    if (!sight.floors.includes(e.floor)) return { id, hidden: true, ...atlas.unseenFrom(caller, e.floor, sight.principals, named(e.floor)) };
    return { ...refOf(e), state: e.state, floorName: named(e.floor) };
  };
};

export const knowledgeRoutes = (app: FastifyInstance, atlas: Atlas) => {
  const { store, recorded } = atlas;

  /**
   * What uses an entity, from here (spec, "used by"): intents bound to it, from
   * Mandate's events, and documents what's known of it came from. Intents are
   * ids and roles: the page asks Mandate to name them as the viewer, so one the
   * viewer can't open still shows, saying where it's kept.
   */
  app.get<{ Params: { id: string } }>('/entities/:id/used-by', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const found = await atlas.seen(req, reply, req.params.id);
    if (!found) return reply;
    const { caller, entity } = found;
    const { floors } = await atlas.sight(caller);
    const [uses, documents] = await Promise.all([store.usedBy(entity.id), store.mentionedIn(entity.id, floors)]);
    // A team's workspace is the team: name it, so an intent the viewer can't open says where it's kept.
    const teams = await atlas.people.teamNames([...new Set(uses.map((u) => u.workspace))]).catch(() => new Map<string, string>());
    return {
      intents: uses.filter((u) => u.app === 'mandate').map((u) => ({ app: u.app, id: u.id, role: u.role, since: u.since, ...(teams.get(u.workspace) ? { floorName: teams.get(u.workspace) } : {}) })),
      documents,
    };
  });

  /** Everything known about an entity from here: facts true at `at` as recorded by `known`, its links both ways, and observations. */
  app.get<{ Params: { id: string }; Querystring: { at?: string; known?: string } }>(
    '/entities/:id/knowledge',
    { schema: { params: ID_PARAMS, querystring: { type: 'object', properties: { at: WHEN, known: WHEN } } } },
    async (req, reply) => {
      const found = await atlas.seen(req, reply, req.params.id);
      if (!found) return reply;
      const { caller, entity } = found;
      const at = when(req.query.at);
      const known = when(req.query.known);
      if (at === false || known === false) return reply.code(400).send({ error: 'bad-time', message: 'A time must be a date, such as 2026-10-01, or a date and time.' });
      const sight = await atlas.sight(caller);
      const [facts, observations] = await Promise.all([store.facts([entity.id], { floors: sight.floors, at, known }), store.observations(entity.id, sight.floors)]);
      const disputes = await store.openDisputes(facts.map((f) => f.id));
      const here = floorPrincipal(caller.id, caller.workspace);
      const above = floorsAbove(caller, sight.floors);
      const named = await atlas.nameFloors(caller, [...[...facts, ...observations, ...disputes].map((x) => x.floor), ...above, here]);
      const others = await otherEnds(
        atlas,
        caller,
        [...facts, ...observations].flatMap((x) => [x.entity, x.target].filter((id): id is string => !!id && id !== entity.id)),
        sight,
      );
      const raised = new Map<string, string[]>();
      for (const o of observations) if (o.raisedFrom) raised.set(o.raisedFrom, [...(raised.get(o.raisedFrom) ?? []), o.floor]);

      const factRights = (f: Fact): FactRights => {
        if (f.floor !== here) return { end: false, withdraw: false, dispute: true, why: `It’s ${named(f.floor) === 'Org' ? 'the org’s' : `kept on ${named(f.floor)}`}: its leads end or withdraw it there. You can dispute it from here.` };
        if (!leadsHere(caller)) return { end: false, withdraw: false, dispute: true, why: 'Only this floor’s leads end or withdraw what it accepts. You can dispute it.' };
        return { end: !f.validTo, withdraw: true, dispute: true, ...(f.validTo ? { why: 'It has already ended.' } : {}) };
      };
      // Facts whose every observation's source is gone stay, saying so (never silently dropped).
      const backing = new Map((await store.observationsById([...new Set(facts.flatMap((f) => f.backedBy))])).map((o) => [o.id, o]));
      const unbacked = (f: Fact) => f.backedBy.length > 0 && f.backedBy.every((id) => backing.get(id)?.retracted);
      const factView = (f: Fact) => ({
        ...f,
        ...(unbacked(f) ? { unbacked: 'Every source it rested on was withdrawn. It stands until this floor’s leads end or withdraw it.' } : {}),
        direction: f.entity === entity.id ? ('out' as const) : ('in' as const),
        ...(f.target ? { other: others(f.entity === entity.id ? f.target : f.entity) } : {}),
        floorName: named(f.floor),
        // A dispute shows to those who can see the floor it was raised on, and to the fact's own floor, whom it's for.
        disputes: disputes
          .filter((d) => d.fact === f.id && (sight.floors.includes(d.floor) || f.floor === here))
          .map((d) => ({ ...d, floorName: named(d.floor), mine: d.by === caller.id })),
        can: factRights(f),
      });
      const observationRights = (o: Observation): ObservationRights => {
        if (o.floor !== here) return { accept: false, raise: false, raiseTo: [], why: `It was recorded on ${named(o.floor) === 'Org' ? 'the org floor' : named(o.floor)}: go there to accept or raise it.` };
        if (!leadsHere(caller)) return { accept: false, raise: false, raiseTo: [], why: LEADS_ONLY };
        const raiseTo = above.filter((f) => !(raised.get(o.id) ?? []).includes(f)).map((f) => ({ floor: f, name: named(f) }));
        return { accept: true, raise: raiseTo.length > 0, raiseTo, ...(raiseTo.length ? {} : { why: above.length ? 'It’s already on every floor above this one.' : 'Nothing is above the org floor.' }) };
      };
      return {
        at: at ?? null,
        known: known ?? null,
        // What the caller may do on the floor they stand on, and why not.
        here: { floorName: named(here), accept: leadsHere(caller), ...(leadsHere(caller) ? {} : { why: LEADS_ONLY }) },
        facts: facts.map(factView),
        // An entity whose only evidence was withdrawn keeps its place, marked as having no current source.
        ...(observations.length && observations.every((o) => o.retracted) ? { noCurrentSource: 'Everything known of it here came from sources since withdrawn. It stays, with no current source.' } : {}),
        observations: observations.map((o) => ({
          ...o,
          direction: o.entity === entity.id ? ('out' as const) : ('in' as const),
          ...(o.target ? { other: others(o.entity === entity.id ? o.target : o.entity) } : {}),
          floorName: named(o.floor),
          raisedTo: (raised.get(o.id) ?? []).map(named),
          can: observationRights(o),
        })),
      };
    },
  );

  /** Records what someone saw or read about an entity, on the floor they stand on. */
  app.post<{
    Params: { id: string };
    Body: { property: string; value?: string; target?: string; observedAt?: string; source: Parameters<typeof sourceOf>[0]; grade?: string; note?: string; reportedUnder?: unknown; accept?: boolean };
  }>(
    '/entities/:id/observations',
    {
      schema: {
        params: ID_PARAMS,
        body: {
          type: 'object',
          properties: {
            property: { type: 'string', minLength: 1, maxLength: 64 },
            value: { type: 'string', maxLength: 200 },
            target: { type: 'string', maxLength: 64 },
            observedAt: WHEN,
            source: SOURCE,
            grade: { type: 'string', pattern: '^[A-F][1-6]$' },
            note: NOTE,
            reportedUnder: { type: 'object', maxProperties: 10 },
            // A lead may accept it as a fact on this floor in the same step.
            accept: { type: 'boolean' },
          },
          required: ['property', 'source'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const found = await atlas.seen(req, reply, req.params.id);
      if (!found) return reply;
      const { caller, entity } = found;
      if (entity.state !== 'active') return reply.code(409).send({ error: 'retired', message: 'It has been retired, so nothing more is recorded about it.' });
      if (req.body.accept && !leadsHere(caller)) return reply.code(403).send({ error: 'cannot-accept', message: LEADS_ONLY });
      const source = sourceOf(req.body.source);
      if (typeof source === 'string') return reply.code(400).send({ error: 'bad-source', message: source });
      const ontology = await store.ontology();
      const said = await sayable(atlas, caller, ontology, entity, req.body);
      if ('error' in said) return reply.code(said.status).send({ error: said.error, message: said.message });
      const observedAt = when(req.body.observedAt);
      if (observedAt === false) return reply.code(400).send({ error: 'bad-time', message: 'When it was seen must be a date, or a date and time.' });
      const observation = await store.addObservation({
        entity: entity.id,
        property: req.body.property,
        ...said.value,
        ...(observedAt ? { observedAt } : {}),
        floor: floorPrincipal(caller.id, caller.workspace),
        workspace: caller.workspace.id,
        source,
        ...(req.body.grade ? { grade: req.body.grade } : {}),
        note: req.body.note?.trim() ?? '',
        ...(req.body.reportedUnder ? { reportedUnder: req.body.reportedUnder } : {}),
        createdBy: caller.id,
      });
      void recorded({ actor: caller.id, action: 'observation.recorded', target: entity.id, workspace: caller.workspace.id, detail: { observation: observation.id, property: observation.property } });
      if (!req.body.accept) return reply.code(201).send({ observation });
      const fact = await accept(atlas, caller, entity, [observation], {});
      return reply.code(201).send({ observation, fact });
    },
  );

  /** A lead accepts what observations say as so on this floor: a fact, backed by them. */
  app.post<{ Params: { id: string }; Body: { backedBy: string[]; validFrom?: string; validTo?: string; note?: string } }>(
    '/entities/:id/facts',
    {
      schema: {
        params: ID_PARAMS,
        body: {
          type: 'object',
          properties: { backedBy: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', maxLength: 64 } }, validFrom: WHEN, validTo: WHEN, note: NOTE },
          required: ['backedBy'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const found = await atlas.seen(req, reply, req.params.id);
      if (!found) return reply;
      const { caller, entity } = found;
      if (!leadsHere(caller)) return reply.code(403).send({ error: 'cannot-accept', message: LEADS_ONLY });
      if (entity.state !== 'active') return reply.code(409).send({ error: 'retired', message: 'It has been retired, so nothing more is accepted about it.' });
      const { floors } = await atlas.sight(caller);
      const backing = await store.observationsById([...new Set(req.body.backedBy)]);
      const usable = backing.filter((o) => o.entity === entity.id && floors.includes(o.floor));
      if (usable.length !== new Set(req.body.backedBy).size) {
        return reply.code(400).send({ error: 'bad-backing', message: 'A fact rests on observations of this entity that show from this floor. One of those given isn’t.' });
      }
      const gone = usable.find((o) => o.retracted);
      if (gone) return reply.code(409).send({ error: 'source-gone', message: `${gone.retracted!.why} It’s kept, but can’t back a fact.` });
      if (new Set(usable.map((o) => `${o.property}|${o.value ?? ''}|${o.target ?? ''}`)).size > 1) {
        return reply.code(400).send({ error: 'mixed-backing', message: 'Those observations say different things. Accept the one this floor holds to be so.' });
      }
      const validFrom = when(req.body.validFrom);
      const validTo = when(req.body.validTo);
      if (validFrom === false || validTo === false) return reply.code(400).send({ error: 'bad-time', message: 'From and until must be dates, or dates and times.' });
      if (validFrom && validTo && validTo <= validFrom) return reply.code(400).send({ error: 'bad-time', message: 'Until must come after from.' });
      const fact = await accept(atlas, caller, entity, usable, { validFrom, validTo, note: req.body.note });
      if (!fact) return reply.code(409).send({ error: 'changed', message: 'This floor’s record of it changed while you were accepting it. Look again.' });
      return reply.code(201).send(fact);
    },
  );

  /** Says when a fact stopped being so: a new record with an end, replacing the old one on the recorded clock. */
  app.post<{ Params: { id: string }; Body: { validTo?: string; note?: string } }>(
    '/facts/:id/end',
    { schema: { params: ID_PARAMS, body: { type: 'object', properties: { validTo: WHEN, note: NOTE }, additionalProperties: false } } },
    async (req, reply) => {
      const mine = await ownFact(atlas, req, reply, req.params.id);
      if (!mine) return reply;
      const { caller, fact } = mine;
      if (fact.validTo) return reply.code(409).send({ error: 'ended', message: 'It has already ended.' });
      const validTo = when(req.body?.validTo) ?? new Date().toISOString();
      if (validTo === false) return reply.code(400).send({ error: 'bad-time', message: 'Until must be a date, or a date and time.' });
      if (fact.validFrom && validTo <= fact.validFrom) return reply.code(400).send({ error: 'bad-time', message: 'It can’t end before it began.' });
      const { id: _, recordedAt: __, supersededAt: ___, supersededBy: ____, ...rest } = fact;
      const ended = await store.addFact({ ...rest, validTo, note: req.body?.note?.trim() || fact.note, createdBy: caller.id }, [fact.id]);
      if (!ended) return reply.code(409).send({ error: 'changed', message: 'It was changed while you were ending it. Look again.' });
      void recorded({ actor: caller.id, action: 'fact.ended', target: fact.entity, workspace: caller.workspace.id, detail: { fact: ended.id, replaces: fact.id, property: fact.property } });
      return ended;
    },
  );

  /** Takes back a fact recorded in error. It stays in the record, as no longer held from now on. */
  app.post<{ Params: { id: string } }>('/facts/:id/withdraw', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const mine = await ownFact(atlas, req, reply, req.params.id);
    if (!mine) return reply;
    const { caller, fact } = mine;
    const done = await store.withdrawFact(fact.id);
    if (!done) return reply.code(409).send({ error: 'changed', message: 'It was changed while you were withdrawing it. Look again.' });
    void recorded({ actor: caller.id, action: 'fact.withdrawn', target: fact.entity, workspace: caller.workspace.id, detail: { fact: fact.id, property: fact.property } });
    return done;
  });

  /** Anyone who can see a fact may say it's wrong, and why. The dispute sits on their floor. */
  app.post<{ Params: { id: string }; Body: { note: string } }>(
    '/facts/:id/disputes',
    { schema: { params: ID_PARAMS, body: { type: 'object', properties: { note: { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' } }, required: ['note'], additionalProperties: false } } },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const fact = await store.fact(req.params.id);
      if (!fact) return reply.code(404).send({ error: 'not-found', message: 'There’s no such fact.' });
      const { principals, floors } = await atlas.sight(caller);
      if (!floors.includes(fact.floor)) {
        const named = await atlas.nameFloors(caller, [fact.floor]);
        return reply.code(403).send({ error: 'unseen', ...atlas.unseenFrom(caller, fact.floor, principals, named(fact.floor)) });
      }
      if (fact.supersededAt) return reply.code(409).send({ error: 'superseded', message: 'A later record has replaced it: dispute that one instead.' });
      const dispute = await store.addDispute({ fact: fact.id, floor: floorPrincipal(caller.id, caller.workspace), note: req.body.note.trim(), by: caller.id });
      void recorded({ actor: caller.id, action: 'fact.disputed', target: fact.entity, workspace: caller.workspace.id, detail: { fact: fact.id, dispute: dispute.id } });
      return reply.code(201).send(dispute);
    },
  );

  /** Clears a dispute: whoever raised it, or the disputed fact's floor's leads standing on it. */
  app.post<{ Params: { id: string } }>('/disputes/:id/clear', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const dispute = await store.dispute(req.params.id);
    if (!dispute) return reply.code(404).send({ error: 'not-found', message: 'There’s no such dispute.' });
    const fact = (await store.fact(dispute.fact))!;
    const leadOfFact = fact.floor === floorPrincipal(caller.id, caller.workspace) && leadsHere(caller);
    if (dispute.by !== caller.id && !leadOfFact) {
      return reply.code(403).send({ error: 'cannot-clear', message: 'Only whoever raised it, or the leads of the floor that holds the fact, can clear a dispute.' });
    }
    const cleared = await store.clearDispute(dispute.id, caller.id);
    if (!cleared) return reply.code(409).send({ error: 'cleared', message: 'It has already been cleared.' });
    void recorded({ actor: caller.id, action: 'dispute.cleared', target: fact.entity, workspace: caller.workspace.id, detail: { fact: fact.id, dispute: dispute.id } });
    return cleared;
  });

  /** A lead raises an observation to a floor above, as a copy that points back to it: higher floors are worth more. */
  app.post<{ Params: { id: string }; Body: { to: string } }>(
    '/observations/:id/raise',
    { schema: { params: ID_PARAMS, body: { type: 'object', properties: { to: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['to'], additionalProperties: false } } },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const observation = await store.observation(req.params.id);
      if (!observation) return reply.code(404).send({ error: 'not-found', message: 'There’s no such observation.' });
      const { principals, floors } = await atlas.sight(caller);
      const above = floorsAbove(caller, floors);
      const named = await atlas.nameFloors(caller, [observation.floor, req.body.to, ...above]);
      if (!floors.includes(observation.floor)) return reply.code(403).send({ error: 'unseen', ...atlas.unseenFrom(caller, observation.floor, principals, named(observation.floor)) });
      if (observation.floor !== floorPrincipal(caller.id, caller.workspace)) {
        return reply.code(403).send({ error: 'cannot-raise', message: `It was recorded on ${named(observation.floor)}: raise it from there.` });
      }
      if (!leadsHere(caller)) return reply.code(403).send({ error: 'cannot-raise', message: LEADS_ONLY });
      if (!above.includes(req.body.to)) {
        return reply.code(400).send({ error: 'not-above', message: above.length ? `It can go to ${above.map(named).join(', ')}: floors above this one that you’re on.` : 'Nothing is above the org floor.' });
      }
      const already = await store.raisedTo(observation.id, req.body.to);
      if (already) return reply.code(409).send({ error: 'raised', message: `It’s already on ${named(req.body.to)}.`, observation: already.id });
      const { id: _, createdAt: __, raisedFrom: ___, ...rest } = observation;
      const raised = await store.addObservation({ ...rest, floor: req.body.to, workspace: caller.workspace.id, raisedFrom: observation.id, createdBy: caller.id });
      void recorded({ actor: caller.id, action: 'observation.raised', target: observation.entity, workspace: caller.workspace.id, detail: { observation: observation.id, raised: raised.id, to: req.body.to } });
      return reply.code(201).send({ ...raised, floorName: named(raised.floor) });
    },
  );
};

/**
 * Checks what an observation says against the ontology: a detail's value,
 * tidied, or a link to another entity the caller can see, of a kind the link
 * goes to. A refusal, in words, when it won't do.
 */
export const sayable = async (
  atlas: Atlas,
  caller: OnFloor,
  ontology: Ontology,
  entity: Entity,
  body: { property: string; value?: string; target?: string },
): Promise<{ value: { value: string } | { target: string } } | { status: number; error: string; message: string }> => {
  const property = propertyOf(ontology, entity.type, body.property);
  const kind = ontology.types.find((t) => t.key === entity.type)?.label.toLowerCase() ?? entity.type;
  if (!property) return { status: 400, error: 'unknown-property', message: `A ${kind} has no detail or link called “${body.property}”.` };
  if (property.kind === 'detail') {
    if (body.target !== undefined || body.value === undefined) return { status: 400, error: 'bad-value', message: `${property.def.label} takes a value, not another entity.` };
    const value = normaliseDetail(property.def, body.value);
    const problem = checkDetail(property.def, value);
    return problem ? { status: 400, error: 'bad-value', message: problem } : { value: { value } };
  }
  if (body.value !== undefined || !body.target) return { status: 400, error: 'bad-value', message: `“${property.def.label}” links to another entity: say which.` };
  if (body.target === entity.id) return { status: 400, error: 'bad-value', message: 'It can’t link to itself.' };
  const target = await atlas.store.entity(body.target);
  if (!target) return { status: 400, error: 'bad-value', message: 'There’s no such entity to link to.' };
  const { principals, floors } = await atlas.sight(caller);
  if (!floors.includes(target.floor)) {
    const named = await atlas.nameFloors(caller, [target.floor]);
    return { status: 403, error: 'unseen', message: `The entity to link to doesn’t show from here. ${atlas.unseenFrom(caller, target.floor, principals, named(target.floor)).message}` };
  }
  if (target.state !== 'active') return { status: 409, error: 'retired', message: `${target.label} has been retired, so nothing new links to it.` };
  if (!property.def.to.some((k) => isA(ontology, target.type, k))) {
    const kinds = property.def.to.map((k) => ontology.types.find((t) => t.key === k)?.plural.toLowerCase() ?? k).join(' or ');
    return { status: 400, error: 'bad-value', message: `“${property.def.label}” links to ${kinds}, and ${target.label} isn’t one.` };
  }
  return { value: { target: target.id } };
};

/** Records a fact from observations that agree, on the caller's floor, replacing this floor's current record of a detail. */
export const accept = async (
  atlas: Atlas,
  caller: OnFloor,
  entity: Entity,
  backing: Observation[],
  { validFrom, validTo, note }: { validFrom?: string; validTo?: string; note?: string },
) => {
  const first = backing[0];
  const floor = floorPrincipal(caller.id, caller.workspace);
  const ontology = await atlas.store.ontology();
  // A detail has one value at a time on a floor; links may be many.
  const replaces = propertyOf(ontology, entity.type, first.property)?.kind === 'detail' ? (await atlas.store.currentFacts(entity.id, first.property, floor)).map((f) => f.id) : [];
  const fact = await atlas.store.addFact(
    {
      entity: entity.id,
      property: first.property,
      ...(first.target ? { target: first.target } : { value: first.value }),
      ...(validFrom ? { validFrom } : first.observedAt ? { validFrom: first.observedAt } : {}),
      ...(validTo ? { validTo } : {}),
      floor,
      workspace: caller.workspace.id,
      backedBy: backing.map((o) => o.id),
      note: note?.trim() ?? '',
      createdBy: caller.id,
    },
    replaces,
  );
  if (fact) void atlas.recorded({ actor: caller.id, action: 'fact.recorded', target: entity.id, workspace: caller.workspace.id, detail: { fact: fact.id, property: fact.property, replaces } });
  return fact;
};

/** A fact the caller may end or withdraw: on the floor they stand on, as one of its leads. Else a refusal, already sent. */
const ownFact = async (atlas: Atlas, req: FastifyRequest, reply: FastifyReply, id: string) => {
  const caller = atlas.onFloor(req, reply);
  if (!caller) return undefined;
  const fact = await atlas.store.fact(id);
  if (!fact) {
    reply.code(404).send({ error: 'not-found', message: 'There’s no such fact.' });
    return undefined;
  }
  const { principals, floors } = await atlas.sight(caller);
  const named = await atlas.nameFloors(caller, [fact.floor]);
  if (!floors.includes(fact.floor)) {
    reply.code(403).send({ error: 'unseen', ...atlas.unseenFrom(caller, fact.floor, principals, named(fact.floor)) });
    return undefined;
  }
  if (fact.floor !== floorPrincipal(caller.id, caller.workspace)) {
    reply.code(403).send({ error: 'cannot-change', message: `It’s kept on ${named(fact.floor)}: its leads change it there.` });
    return undefined;
  }
  if (!leadsHere(caller)) {
    reply.code(403).send({ error: 'cannot-change', message: 'Only this floor’s leads end or withdraw what it accepts.' });
    return undefined;
  }
  if (fact.supersededAt) {
    reply.code(409).send({ error: 'superseded', message: 'A later record has replaced it.' });
    return undefined;
  }
  return { caller, fact };
};

/**
 * The graph around some entities from where the caller stands: links true at
 * `asOf`, out to `depth` steps, at most `limitPerNode` links from each entity
 * (the rest counted in `more`, strongest links kept first, and the links past
 * the last ring counted there too). An entity at the far end of a link that
 * doesn't show from here is listed in `unseen` with why and what it is near,
 * never silently dropped. Each link says how many open disputes it has.
 */
export const subgraph = async (
  atlas: Atlas,
  caller: OnFloor,
  { seeds, depth = 1, types, relations, asOf, limitPerNode = 25 }: { seeds: string[]; depth?: number; types?: string[]; relations?: string[]; asOf?: string; limitPerNode?: number },
) => {
  const { store } = atlas;
  const sight = await atlas.sight(caller);
  const ontology = await store.ontology();
  const kinds = types?.length ? new Set(types.flatMap((t) => withSubtypes(ontology, t))) : undefined;
  const at = asOf ? new Date(asOf).toISOString() : undefined;
  const ids = [...new Set(seeds)];
  const entities = new Map((await store.entitiesById(ids)).map((e) => [e.id, e]));
  const shows = (e: Entity) => sight.floors.includes(e.floor);
  const keeps = (e: Entity) => shows(e) && (!kinds || kinds.has(e.type));

  const nodes = new Map<string, number>();
  // The seeds always show when they can be seen: `types` narrows what the walk reaches, not where it starts.
  for (const id of ids) if (entities.get(id) && shows(entities.get(id)!)) nodes.set(id, 0);
  const edges = new Map<string, Fact>();
  const more: { entity: string; relation: string; direction: 'out' | 'in'; count: number }[] = [];
  const hidden = new Set(ids.filter((id) => entities.get(id) && !shows(entities.get(id)!)));
  // Which shown entities each hidden one is linked to, so the explorer can say "1 hidden" beside them.
  const near = new Map<string, Set<string>>();

  let frontier = [...nodes.keys()];
  // One step past `depth` only counts: what lies beyond the last ring is folded into `more`, so the explorer can offer it.
  for (let step = 1; step <= depth + 1 && frontier.length; step++) {
    const beyond = step > depth;
    const links = (await store.facts(frontier, { floors: sight.floors, at })).filter((f) => f.target && (!relations?.length || relations.includes(f.property)));
    const ends = links.flatMap((f) => [f.entity, f.target!]).filter((id) => !entities.has(id));
    for (const e of await store.entitiesById([...new Set(ends)])) entities.set(e.id, e);
    // The strongest links first: those to the ends most linked from here.
    const degree = await store.linkCounts([...new Set(links.flatMap((f) => [f.entity, f.target!]))], { floors: sight.floors, at });
    const next: string[] = [];
    for (const id of frontier) {
      const otherOf = (f: Fact) => (f.entity === id ? f.target! : f.entity);
      const own = links.filter((f) => f.entity === id || f.target === id);
      const shown = own
        .filter((f) => {
          const other = entities.get(otherOf(f));
          if (other && !shows(other)) {
            hidden.add(other.id);
            near.set(other.id, (near.get(other.id) ?? new Set()).add(id));
          }
          return other && keeps(other);
        })
        .sort((a, b) => (degree.get(otherOf(b)) ?? 0) - (degree.get(otherOf(a)) ?? 0) || a.property.localeCompare(b.property) || a.id.localeCompare(b.id));
      const room = beyond ? 0 : limitPerNode;
      for (const f of shown.slice(0, room)) {
        edges.set(f.id, f);
        const other = f.entity === id ? f.target! : f.entity;
        if (!nodes.has(other)) {
          nodes.set(other, step);
          next.push(other);
        }
      }
      // Counted by relation and which way it points, so "+3 operates" and "+1 operated by" read right.
      const left = new Map<string, number>();
      for (const f of shown.slice(room)) {
        if (beyond && nodes.has(otherOf(f))) continue;
        const key = `${f.property} ${f.entity === id ? 'out' : 'in'}`;
        left.set(key, (left.get(key) ?? 0) + 1);
      }
      for (const [key, count] of left) {
        const [relation, direction] = key.split(' ') as [string, 'out' | 'in'];
        more.push({ entity: id, relation, direction, count });
      }
    }
    frontier = next;
  }
  // An edge counts only when both its ends are in the answer.
  const kept = [...edges.values()].filter((f) => nodes.has(f.entity) && nodes.has(f.target!));
  // Open disputes count on a link as they would on the entity page: those raised where the caller can see, or on the caller's floor's own facts.
  const here = floorPrincipal(caller.id, caller.workspace);
  const disputed = new Map<string, number>();
  for (const d of await store.openDisputes(kept.map((f) => f.id))) {
    const fact = edges.get(d.fact)!;
    if (sight.floors.includes(d.floor) || fact.floor === here) disputed.set(d.fact, (disputed.get(d.fact) ?? 0) + 1);
  }
  const named = await atlas.nameFloors(caller, [...[...nodes.keys()].map((id) => entities.get(id)!.floor), ...kept.map((f) => f.floor)]);
  const hiddenNamed = await atlas.nameFloors(caller, [...hidden].map((id) => entities.get(id)!.floor));
  return {
    nodes: [...nodes].map(([id, d]) => {
      const e = entities.get(id)!;
      return { ref: refOf(e), state: e.state, floorName: named(e.floor), depth: d };
    }),
    edges: kept.map((f) => ({ id: f.id, from: f.entity, to: f.target!, relation: f.property, floorName: named(f.floor), ...(f.validFrom ? { validFrom: f.validFrom } : {}), ...(f.validTo ? { validTo: f.validTo } : {}), disputed: disputed.get(f.id) ?? 0 })),
    more,
    // What doesn't show from here, and why: left out of the graph, never silently.
    unseen: [...hidden].map((id) => ({
      id,
      ...atlas.unseenFrom(caller, entities.get(id)!.floor, sight.principals, hiddenNamed(entities.get(id)!.floor)),
      near: [...(near.get(id) ?? [])].filter((n) => nodes.has(n)),
    })),
    missing: ids.filter((id) => !entities.has(id)),
  };
};

