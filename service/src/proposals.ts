import type { FastifyInstance, FastifyReply } from 'fastify';
import type { OnFloor } from './app.ts';
import { floorPrincipal } from './floors.ts';
import { ID_PARAMS, LEADS_ONLY, NOTE, SOURCE, WHEN, accept, leadsHere, otherEnds, sayable, sourceOf, when, type Atlas } from './knowledge.ts';
import { detailsOf } from './ontology.ts';
import { KeyTakenError, type Entity, type Mention, type Proposal, type ProposalItem, type ProposedObservation, type ProposedTerm, type Source } from './store.ts';

/**
 * The ingest seam (spec, "Ingest seam"): everything a person didn't type
 * straight in arrives as a proposal, one per source, and waits in its floor's
 * Triage. A floor's leads decide each mention (an entity already known, a new
 * one, or nothing) and each observation (accepted as so, kept as seen, or
 * dropped). Nothing becomes knowledge until they do; in v1 nothing skips
 * Triage (Harry's Q6). Today people make proposals by marking words in the
 * Artifacts reader; the extractor and agent runs will make the same shape later.
 */

const KEY = { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' } as const;
const ANCHOR = { type: 'string', minLength: 1, maxLength: 120 } as const;
const MENTION = {
  type: 'object',
  properties: {
    key: KEY,
    text: { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' },
    type: { type: 'string', minLength: 1, maxLength: 64 },
    anchor: ANCHOR,
    context: { type: 'string', maxLength: 4000 },
    keys: { type: 'object', maxProperties: 10, additionalProperties: { type: 'string', maxLength: 200 } },
  },
  required: ['key', 'text'],
  additionalProperties: false,
} as const;
const OBSERVATION = {
  type: 'object',
  properties: {
    key: KEY,
    about: KEY,
    property: { type: 'string', minLength: 1, maxLength: 64 },
    value: { type: 'string', maxLength: 200 },
    target: KEY,
    observedAt: WHEN,
    grade: { type: 'string', pattern: '^[A-F][1-6]$' },
    note: NOTE,
    anchor: ANCHOR,
  },
  required: ['key', 'about', 'property'],
  additionalProperties: false,
} as const;
const TERM = {
  type: 'object',
  properties: {
    key: KEY,
    kind: { enum: ['type', 'detail', 'relation'] },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    parent: { type: 'string', maxLength: 64 },
    note: NOTE,
  },
  required: ['key', 'kind', 'name'],
  additionalProperties: false,
} as const;

/** What can be done with a proposal from here, and why not. */
export interface ProposalRights {
  decide: boolean;
  finish: boolean;
  withdraw: boolean;
  why?: string;
}

/** Checks a proposal's parts point at each other properly; the first problem, in words. */
const shapeProblem = (mentions: Mention[], observations: ProposedObservation[], terms: ProposedTerm[]) => {
  const keys = [...mentions, ...observations, ...terms].map((x) => x.key);
  if (new Set(keys).size !== keys.length) return 'Each mention, observation and term needs its own key.';
  const named = new Set(mentions.map((m) => m.key));
  for (const o of observations) {
    if (!named.has(o.about)) return `Observation ${o.key} is about “${o.about}”, which isn’t one of the mentions.`;
    if (o.target !== undefined && !named.has(o.target)) return `Observation ${o.key} links to “${o.target}”, which isn’t one of the mentions.`;
    if ((o.value === undefined) === (o.target === undefined)) return `Observation ${o.key} needs either a value or a mention it links to.`;
  }
  return undefined;
};

export const proposalRoutes = (app: FastifyInstance, atlas: Atlas) => {
  const { store, recorded } = atlas;

  /** The proposal, if the caller can see it from where they stand: kept on their floor or one above. Else a refusal, already sent. */
  const visible = async (caller: OnFloor, reply: FastifyReply, id: string) => {
    const found = await store.proposal(id);
    if (!found) {
      reply.code(404).send({ error: 'not-found', message: 'There’s no such proposal.' });
      return undefined;
    }
    const { principals, floors } = await atlas.sight(caller);
    if (!floors.includes(found.proposal.floor)) {
      const named = await atlas.nameFloors(caller, [found.proposal.floor]);
      reply.code(403).send({ error: 'unseen', ...atlas.unseenFrom(caller, found.proposal.floor, principals, named(found.proposal.floor)), id });
      return undefined;
    }
    return found;
  };

  const rightsOn = (caller: OnFloor, p: Proposal, floorName: string, left: number): ProposalRights => {
    const here = floorPrincipal(caller.id, caller.workspace);
    if (p.state !== 'open') return { decide: false, finish: false, withdraw: false, why: p.state === 'finished' ? 'It’s finished: what was decided is in the model.' : 'It was withdrawn.' };
    if (p.floor !== here) {
      const where = floorName === 'Org' ? 'the org floor' : floorName === 'You' ? 'your own floor' : floorName;
      return { decide: false, finish: false, withdraw: false, why: `It waits in the Triage of ${where}: go there to work on it.` };
    }
    const lead = leadsHere(caller);
    const withdraw = lead || p.createdBy === caller.id;
    if (!lead) return { decide: false, finish: false, withdraw, why: 'Only this floor’s leads decide proposals. Whoever made one can withdraw it.' };
    return { decide: true, finish: left === 0, withdraw, ...(left ? { why: `${left} left to decide before it can be finished.` } : {}) };
  };

  /** The proposal as the caller sees it: each mention's matches and decided entities named, and what they may do. */
  const proposalView = async (caller: OnFloor, p: Proposal, items: ProposalItem[]) => {
    const sight = await atlas.sight(caller);
    const ids = items.flatMap((i) => [...i.matches.map((m) => m.entity), ...(i.kind === 'mention' && i.decision && i.decision.as !== 'drop' ? [i.decision.entity] : [])]);
    const others = await otherEnds(atlas, caller, ids, sight);
    const named = await atlas.nameFloors(caller, [p.floor]);
    const left = items.filter((i) => i.kind !== 'term' && !i.decision).length;
    const decided = new Map(items.filter((i) => i.kind === 'mention').map((i) => [i.key, i.decision]));
    return {
      ...p,
      floorName: named(p.floor),
      left,
      mentions: items
        .filter((i) => i.kind === 'mention')
        .map((i) => ({
          ...i.body,
          // A match no longer showing from here, or retired since, isn't offered.
          matches: i.matches.map((m) => ({ ...m, entity: others(m.entity) })).filter((m) => 'kind' in m.entity && m.entity.state === 'active'),
          ...(i.decision ? { decision: i.decision.as === 'drop' ? i.decision : { as: i.decision.as, entity: others(i.decision.entity) } } : {}),
          ...(i.decidedBy ? { decidedBy: i.decidedBy, decidedAt: i.decidedAt } : {}),
        })),
      observations: items
        .filter((i) => i.kind === 'observation')
        .map((i) => {
          const o = i.body as ProposedObservation;
          const waiting = [o.about, ...(o.target ? [o.target] : [])].filter((k) => !decided.get(k));
          const dropped = [o.about, ...(o.target ? [o.target] : [])].filter((k) => decided.get(k)?.as === 'drop');
          return {
            ...o,
            ...(i.decision ? { decision: i.decision } : {}),
            ...(i.decidedBy ? { decidedBy: i.decidedBy, decidedAt: i.decidedAt } : {}),
            // It can be decided once what it's about is; a dropped mention takes it with it.
            ready: !waiting.length && !dropped.length,
            ...(waiting.length ? { why: 'Decide what it’s about first.' } : dropped.length ? { why: 'What it’s about was dropped, so it can only be dropped too.' } : {}),
          };
        }),
      terms: items.filter((i) => i.kind === 'term').map((i) => i.body),
      can: rightsOn(caller, p, named(p.floor), left),
    };
  };

  /** A proposal from where the caller stands: one source, and what it seems to say. It waits in this floor's Triage. */
  app.post<{
    Body: { source: { kind: Source['kind']; document?: { app: string; id: string; version?: string; title: string }; note?: string; anchor?: string }; mentions: Mention[]; observations?: ProposedObservation[]; terms?: ProposedTerm[] };
  }>(
    '/proposals',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            source: SOURCE,
            mentions: { type: 'array', minItems: 1, maxItems: 100, items: MENTION },
            observations: { type: 'array', maxItems: 300, items: OBSERVATION },
            terms: { type: 'array', maxItems: 50, items: TERM },
          },
          required: ['source', 'mentions'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const source = sourceOf(req.body.source);
      if (typeof source === 'string') return reply.code(400).send({ error: 'bad-source', message: source });
      const mentions = req.body.mentions.map((m) => ({ ...m, text: m.text.trim(), ...(m.context ? { context: m.context.trim() } : {}) }));
      const observations = req.body.observations ?? [];
      const terms = req.body.terms ?? [];
      const problem = shapeProblem(mentions, observations, terms);
      if (problem) return reply.code(400).send({ error: 'bad-proposal', message: problem });
      const ontology = await store.ontology();
      const { floors } = await atlas.sight(caller);
      const { matches, matching } = await atlas.resolver.match(ontology, floors, mentions, caller.workspace.id);
      const items: ProposalItem[] = [
        ...mentions.map((m) => ({ kind: 'mention' as const, key: m.key, body: m, matches: matches.get(m.key) ?? [] })),
        ...observations.map((o) => ({ kind: 'observation' as const, key: o.key, body: o, matches: [] })),
        ...terms.map((t) => ({ kind: 'term' as const, key: t.key, body: t, matches: [] })),
      ];
      const floor = floorPrincipal(caller.id, caller.workspace);
      const proposal = await store.addProposal(
        { floor, workspace: caller.workspace.id, source, producer: { kind: 'person', id: caller.id }, ontologyVersion: ontology.version, createdBy: caller.id, matching },
        items,
      );
      void recorded({ actor: caller.id, action: 'proposal.received', target: proposal.id, workspace: caller.workspace.id, detail: { mentions: mentions.length, observations: observations.length } });
      const named = await atlas.nameFloors(caller, [floor]);
      return reply.code(201).send({ ...(await proposalView(caller, proposal, items)), queue: named(floor) });
    },
  );

  /** This floor's Triage: proposals kept here, open ones by default. */
  app.get<{ Querystring: { state?: 'open' | 'closed' } }>(
    '/proposals',
    { schema: { querystring: { type: 'object', properties: { state: { enum: ['open', 'closed'] } } } } },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const floor = floorPrincipal(caller.id, caller.workspace);
      const found = await store.proposals(floor, req.query.state ?? 'open');
      const named = await atlas.nameFloors(caller, [floor]);
      return {
        floorName: named(floor),
        // Who works the queue, said rather than left to be found out.
        decide: leadsHere(caller),
        ...(leadsHere(caller) ? {} : { why: 'Only this floor’s leads decide proposals. You can see what’s waiting.' }),
        proposals: found,
      };
    },
  );

  app.get<{ Params: { id: string } }>('/proposals/:id', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const found = await visible(caller, reply, req.params.id);
    if (!found) return reply;
    return proposalView(caller, found.proposal, found.items);
  });

  /** Opens a proposal to decide: visible, open, on the caller's floor, and the caller one of its leads. Else a refusal, already sent. */
  const workable = async (caller: OnFloor, reply: FastifyReply, id: string) => {
    const found = await visible(caller, reply, id);
    if (!found) return undefined;
    const named = await atlas.nameFloors(caller, [found.proposal.floor]);
    const can = rightsOn(caller, found.proposal, named(found.proposal.floor), 1);
    if (!can.decide) {
      reply.code(found.proposal.state === 'open' ? 403 : 409).send({ error: 'cannot-decide', message: can.why });
      return undefined;
    }
    return found;
  };

  /** Answers with the whole proposal as it now stands, so the screen redraws from one reply. */
  const after = async (caller: OnFloor, id: string) => {
    const found = (await store.proposal(id))!;
    return proposalView(caller, found.proposal, found.items);
  };

  /** Decides what a mention is: an entity already known, a new one made from it, or nothing. */
  app.post<{ Params: { id: string; key: string }; Body: { as: 'link' | 'new' | 'drop'; entity?: string; type?: string; label?: string } }>(
    '/proposals/:id/mentions/:key',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', maxLength: 64 }, key: KEY }, required: ['id', 'key'] },
        body: {
          type: 'object',
          properties: { as: { enum: ['link', 'new', 'drop'] }, entity: { type: 'string', maxLength: 64 }, type: { type: 'string', maxLength: 64 }, label: { type: 'string', maxLength: 200 } },
          required: ['as'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const found = await workable(caller, reply, req.params.id);
      if (!found) return reply;
      const item = found.items.find((i) => i.key === req.params.key && i.kind === 'mention');
      if (!item || item.kind !== 'mention') return reply.code(404).send({ error: 'not-found', message: 'The proposal has no such mention.' });
      if (item.decision) return reply.code(409).send({ error: 'decided', message: 'It has already been decided.' });
      const mention = item.body;
      let entity: Entity | undefined;
      if (req.body.as === 'link') {
        if (!req.body.entity) return reply.code(400).send({ error: 'bad-decision', message: 'Say which entity it is.' });
        entity = await store.entity(req.body.entity);
        const { principals, floors } = await atlas.sight(caller);
        if (!entity) return reply.code(400).send({ error: 'bad-decision', message: 'There’s no such entity.' });
        if (!floors.includes(entity.floor)) {
          const named = await atlas.nameFloors(caller, [entity.floor]);
          return reply.code(403).send({ error: 'unseen', message: `That entity doesn’t show from here. ${atlas.unseenFrom(caller, entity.floor, principals, named(entity.floor)).message}` });
        }
        if (entity.state !== 'active') return reply.code(409).send({ error: 'retired', message: `${entity.label} has been retired, so nothing new is said of it.` });
      }
      if (req.body.as === 'new') {
        const ontology = await store.ontology();
        const typeKey = req.body.type ?? mention.type;
        const type = ontology.types.find((t) => t.key === typeKey);
        if (!type) return reply.code(400).send({ error: 'unknown-type', message: typeKey ? `The ontology has no kind of thing called “${typeKey}”.` : 'Say what kind of thing it is.' });
        if (type.abstract) return reply.code(400).send({ error: 'abstract-type', message: `${type.label} is a heading for other kinds: pick one of those.` });
        const label = (req.body.label ?? mention.text).trim();
        if (!label) return reply.code(400).send({ error: 'bad-decision', message: 'Give it a name.' });
        // The identity keys the source gave come with it; any that don't fit the kind are left for later.
        const keys = Object.fromEntries(Object.entries(mention.keys ?? {}).filter(([k, v]) => v.trim() && detailsOf(ontology, type.key).some((d) => d.key === k && d.identity && d.onEntity !== false)));
        const details = atlas.tidyDetails(ontology, type.key, keys);
        try {
          entity = await store.createEntity(
            {
              type: type.key,
              label,
              aliases: label.toLowerCase() === mention.text.toLowerCase() ? [] : [mention.text],
              description: '',
              details: typeof details === 'string' ? {} : details,
              workspace: caller.workspace.id,
              floor: floorPrincipal(caller.id, caller.workspace),
              createdBy: caller.id,
            },
            ontology,
          );
        } catch (err) {
          if (err instanceof KeyTakenError) return reply.code(409).send(await atlas.keyTaken(caller, err));
          throw err;
        }
        void recorded({ actor: caller.id, action: 'entity.created', target: entity.id, workspace: caller.workspace.id, detail: { type: entity.type, label: entity.label, proposal: found.proposal.id } });
      }
      const decision = req.body.as === 'drop' ? { as: 'drop' as const } : { as: req.body.as, entity: entity!.id };
      const done = await store.decide(found.proposal.id, item.key, decision, caller.id);
      if (!done) return reply.code(409).send({ error: 'decided', message: 'Someone decided it while you were. Look again.' });
      void recorded({ actor: caller.id, action: 'proposal.decided', target: found.proposal.id, workspace: caller.workspace.id, detail: { key: item.key, as: req.body.as, ...(entity ? { entity: entity.id } : {}) } });
      return after(caller, found.proposal.id);
    },
  );

  /** Decides an observation: accepted as so on this floor, kept as seen, or dropped. Its source is the proposal's. */
  app.post<{ Params: { id: string; key: string }; Body: { as: 'accepted' | 'seen' | 'drop'; grade?: string; observedAt?: string; note?: string } }>(
    '/proposals/:id/observations/:key',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', maxLength: 64 }, key: KEY }, required: ['id', 'key'] },
        body: {
          type: 'object',
          properties: { as: { enum: ['accepted', 'seen', 'drop'] }, grade: { type: 'string', pattern: '^[A-F][1-6]$' }, observedAt: WHEN, note: NOTE },
          required: ['as'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const found = await workable(caller, reply, req.params.id);
      if (!found) return reply;
      const item = found.items.find((i) => i.key === req.params.key && i.kind === 'observation');
      if (!item || item.kind !== 'observation') return reply.code(404).send({ error: 'not-found', message: 'The proposal has no such observation.' });
      if (item.decision) return reply.code(409).send({ error: 'decided', message: 'It has already been decided.' });
      const o = item.body;
      // What was read from a source that's gone can't become evidence: it can only be dropped.
      if (found.proposal.sourceGone && req.body.as !== 'drop') return reply.code(409).send({ error: 'source-gone', message: `${found.proposal.sourceGone} What it says can only be dropped now.` });
      if (req.body.as === 'drop') {
        if (!(await store.decide(found.proposal.id, item.key, { as: 'drop' }, caller.id))) return reply.code(409).send({ error: 'decided', message: 'Someone decided it while you were. Look again.' });
        void recorded({ actor: caller.id, action: 'proposal.decided', target: found.proposal.id, workspace: caller.workspace.id, detail: { key: item.key, as: 'drop' } });
        return after(caller, found.proposal.id);
      }
      const entityOf = (key: string) => {
        const m = found.items.find((i) => i.key === key && i.kind === 'mention');
        return m?.kind === 'mention' ? m.decision : undefined;
      };
      const about = entityOf(o.about);
      const target = o.target ? entityOf(o.target) : undefined;
      if (!about || (o.target && !target)) return reply.code(409).send({ error: 'not-ready', message: 'Decide what it’s about first.' });
      if (about.as === 'drop' || target?.as === 'drop') return reply.code(409).send({ error: 'not-ready', message: 'What it’s about was dropped, so it can only be dropped too.' });
      const entity = await store.entity(about.entity);
      if (!entity || entity.state !== 'active') return reply.code(409).send({ error: 'retired', message: 'What it’s about has been retired, so nothing more is recorded about it.' });
      const ontology = await store.ontology();
      const said = await sayable(atlas, caller, ontology, entity, { property: o.property, ...(target ? { target: target.entity } : { value: o.value }) });
      if ('error' in said) return reply.code(said.status).send({ error: said.error, message: said.message });
      const observedAt = when(req.body.observedAt ?? o.observedAt);
      if (observedAt === false) return reply.code(400).send({ error: 'bad-time', message: 'When it was seen must be a date, or a date and time.' });
      const source: Source =
        found.proposal.source.kind === 'document' && (o.anchor ?? found.proposal.source.anchor)
          ? { ...found.proposal.source, anchor: o.anchor ?? found.proposal.source.anchor }
          : found.proposal.source;
      const grade = req.body.grade ?? o.grade;
      const observation = await store.addObservation({
        entity: entity.id,
        property: o.property,
        ...said.value,
        ...(observedAt ? { observedAt } : {}),
        floor: floorPrincipal(caller.id, caller.workspace),
        workspace: caller.workspace.id,
        source,
        ...(grade ? { grade } : {}),
        note: (req.body.note ?? o.note ?? '').trim(),
        createdBy: caller.id,
      });
      void recorded({ actor: caller.id, action: 'observation.recorded', target: entity.id, workspace: caller.workspace.id, detail: { observation: observation.id, property: observation.property, proposal: found.proposal.id } });
      const fact = req.body.as === 'accepted' ? await accept(atlas, caller, entity, [observation], {}) : undefined;
      const decision = fact ? { as: 'accepted' as const, observation: observation.id, fact: fact.id } : { as: 'seen' as const, observation: observation.id };
      if (!(await store.decide(found.proposal.id, item.key, decision, caller.id))) return reply.code(409).send({ error: 'decided', message: 'Someone decided it while you were. Look again.' });
      void recorded({ actor: caller.id, action: 'proposal.decided', target: found.proposal.id, workspace: caller.workspace.id, detail: { key: item.key, as: decision.as } });
      return after(caller, found.proposal.id);
    },
  );

  /** Looks again for what its undecided mentions may be: since it arrived, entities may have been added, or matching by meaning turned on. */
  app.post<{ Params: { id: string } }>('/proposals/:id/match', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const found = await workable(caller, reply, req.params.id);
    if (!found) return reply;
    const mentions = found.items.filter((i) => i.kind === 'mention' && !i.decision).map((i) => i.body as Mention);
    const { floors } = await atlas.sight(caller);
    const { matches, matching } = await atlas.resolver.match(await store.ontology(), floors, mentions, caller.workspace.id);
    await store.rematch(found.proposal.id, matches, matching);
    return after(caller, found.proposal.id);
  });

  /** Finishes a proposal once everything in it is decided. */
  app.post<{ Params: { id: string } }>('/proposals/:id/finish', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const found = await workable(caller, reply, req.params.id);
    if (!found) return reply;
    const left = found.items.filter((i) => i.kind !== 'term' && !i.decision).length;
    if (left) return reply.code(409).send({ error: 'undecided', message: `${left} left to decide before it can be finished.` });
    await store.closeProposal(found.proposal.id, 'finished', caller.id);
    void recorded({ actor: caller.id, action: 'proposal.finished', target: found.proposal.id, workspace: caller.workspace.id, detail: {} });
    return after(caller, found.proposal.id);
  });

  /** Takes a proposal out of Triage: its maker, or the floor's leads. What was decided already stays decided. */
  app.post<{ Params: { id: string } }>('/proposals/:id/withdraw', { schema: { params: ID_PARAMS } }, async (req, reply) => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const found = await visible(caller, reply, req.params.id);
    if (!found) return reply;
    const named = await atlas.nameFloors(caller, [found.proposal.floor]);
    const can = rightsOn(caller, found.proposal, named(found.proposal.floor), 1);
    if (!can.withdraw) return reply.code(found.proposal.state === 'open' ? 403 : 409).send({ error: 'cannot-withdraw', message: can.why ?? LEADS_ONLY });
    await store.closeProposal(found.proposal.id, 'withdrawn', caller.id);
    void recorded({ actor: caller.id, action: 'proposal.withdrawn', target: found.proposal.id, workspace: caller.workspace.id, detail: {} });
    return after(caller, found.proposal.id);
  });
};
