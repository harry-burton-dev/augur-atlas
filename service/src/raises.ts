import type { FastifyInstance } from 'fastify';
import type { OnFloor } from '@augur/service-kit';
import type { EntityRaises, Raise, RaiseDecision, RaiseList, RaiseView } from './api-types.ts';
import { floorPrincipal } from './floors.ts';
import { floorsAbove, leadsHere, type Atlas } from './knowledge.ts';
import { MergeError, RaiseError, refOf } from './store.ts';

const ID = { type: 'string', minLength: 1, maxLength: 64 } as const;
const NOTE = { type: 'string', maxLength: 2000 } as const;
const LEADS_ASK = 'Only this floor’s leads ask a floor above to keep what’s kept here.';
const LEADS_DECIDE = 'Only this floor’s leads decide what is kept here.';

/**
 * Raising an entity card (PER-326): an entity made on a team floor, or on
 * someone's own, stays there until a lead asks a floor above to keep it and
 * that floor's leads agree. What's known of it (observations, facts) stays on
 * the floors it was recorded on; only the card moves. A floor above can also
 * find it's one it already has, and merge the two as it keeps it.
 */
export const raiseRoutes = (app: FastifyInstance, atlas: Atlas) => {
  const { store, recorded } = atlas;

  const views = async (caller: OnFloor, raises: Raise[]): Promise<RaiseView[]> => {
    const cards = new Map((await store.entitiesById([...new Set(raises.map((r) => r.entity))])).map((e) => [e.id, e]));
    const named = await atlas.nameFloors(caller, [...raises.flatMap((r) => [r.from, r.to]), ...[...cards.values()].map((e) => e.floor)]);
    const here = floorPrincipal(caller.id, caller.workspace);
    return raises.flatMap((r) => {
      const e = cards.get(r.entity);
      if (!e) return [];
      const waiting = r.state === 'waiting';
      const decide = waiting && r.to === here && leadsHere(caller);
      const withdraw = waiting && r.from === here && (leadsHere(caller) || r.askedBy === caller.id);
      const why = !waiting
        ? undefined
        : r.to !== here && r.from !== here
          ? `It waits for ${named(r.to)}’s leads.`
          : r.to === here && !decide
            ? LEADS_DECIDE
            : undefined;
      return [{ ...r, fromName: named(r.from), toName: named(r.to), card: { ...refOf(e), state: e.state, floorName: named(e.floor) }, can: { decide, withdraw, ...(why ? { why } : {}) } }];
    });
  };

  app.get<{ Params: { id: string } }>('/entities/:id/raises', { schema: { params: { type: 'object', properties: { id: ID }, required: ['id'] } } }, async (req, reply) => {
    const found = await atlas.seen(req, reply, req.params.id);
    if (!found) return reply;
    const { caller, entity } = found;
    const here = floorPrincipal(caller.id, caller.workspace);
    const sight = await atlas.sight(caller);
    const above = floorsAbove(caller, sight.floors);
    const raises = await store.raisesOf(entity.id);
    const named = await atlas.nameFloors(caller, [...above, entity.floor]);
    const waiting = raises.find((r) => r.state === 'waiting');
    const why =
      entity.state !== 'active'
        ? 'Only an entity in use can be raised.'
        : entity.floor !== here
          ? `It’s kept on ${named(entity.floor)}: raise it from there.`
          : !leadsHere(caller)
            ? LEADS_ASK
            : waiting
              ? `A request to keep it on ${named(waiting.to)} is waiting.`
              : !above.length
                ? 'Nothing is above this floor.'
                : undefined;
    return {
      to: above.map((f) => ({ floor: f, name: named(f), can: !why, ...(why ? { why } : {}) })),
      ask: !why,
      ...(why ? { why } : {}),
      raises: await views(caller, raises),
    } satisfies EntityRaises;
  });

  app.post<{ Params: { id: string }; Body: { to: string; note?: string } }>(
    '/entities/:id/raise',
    {
      schema: {
        params: { type: 'object', properties: { id: ID }, required: ['id'] },
        body: { type: 'object', additionalProperties: false, required: ['to'], properties: { to: { type: 'string', minLength: 1, maxLength: 80 }, note: NOTE } },
      },
    },
    async (req, reply) => {
      const found = await atlas.seen(req, reply, req.params.id);
      if (!found) return reply;
      const { caller, entity } = found;
      const here = floorPrincipal(caller.id, caller.workspace);
      const sight = await atlas.sight(caller);
      const above = floorsAbove(caller, sight.floors);
      const named = await atlas.nameFloors(caller, [entity.floor, ...above]);
      if (entity.state !== 'active') return reply.code(409).send({ error: 'not-active', message: 'Only an entity in use can be raised.' });
      if (entity.floor !== here) return reply.code(403).send({ error: 'cannot-raise', message: `It’s kept on ${named(entity.floor)}: raise it from there.` });
      if (!leadsHere(caller)) return reply.code(403).send({ error: 'cannot-raise', message: LEADS_ASK });
      if (!above.includes(req.body.to)) {
        return reply.code(400).send({ error: 'not-above', message: above.length ? `It can go to ${above.map(named).join(', ')}: floors above this one that you’re on.` : 'Nothing is above this floor.' });
      }
      try {
        const raise = await store.askRaise({ entity: entity.id, from: here, to: req.body.to, note: req.body.note?.trim() ?? '', by: caller.id, workspace: caller.workspace.id });
        void recorded({ actor: caller.id, action: 'entity.raise-asked', target: entity.id, workspace: caller.workspace.id, detail: { raise: raise.id, to: raise.to } });
        return reply.code(201).send((await views(caller, [raise]))[0]);
      } catch (err) {
        if (err instanceof RaiseError) return reply.code(409).send({ error: err.code, message: err.message });
        throw err;
      }
    },
  );

  app.get<{ Querystring: { state?: 'waiting' | 'decided' } }>(
    '/raises',
    { schema: { querystring: { type: 'object', additionalProperties: false, properties: { state: { enum: ['waiting', 'decided'] } } } } },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const here = floorPrincipal(caller.id, caller.workspace);
      const raises = await store.raisesTo(here, (req.query.state ?? 'waiting') === 'waiting');
      const decide = leadsHere(caller);
      return { raises: await views(caller, raises), decide, ...(decide ? {} : { why: LEADS_DECIDE }) } satisfies RaiseList;
    },
  );

  app.post<{ Params: { id: string }; Body: RaiseDecision }>(
    '/raises/:id/decide',
    {
      schema: {
        params: { type: 'object', properties: { id: ID }, required: ['id'] },
        // One flat shape, checked in code: Fastify's validator strips unknown properties, which breaks `oneOf`.
        body: { type: 'object', additionalProperties: false, required: ['as'], properties: { as: { enum: ['keep', 'decline', 'same'] }, note: NOTE, entity: ID, why: NOTE } },
      },
    },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const raise = await store.raise(req.params.id);
      if (!raise) return reply.code(404).send({ error: 'not-found', message: 'There’s no such request.' });
      const here = floorPrincipal(caller.id, caller.workspace);
      if (raise.to !== here) {
        const named = await atlas.nameFloors(caller, [raise.to]);
        return reply.code(403).send({ error: 'cannot-decide', message: `It waits for ${named(raise.to)}: decide it there.` });
      }
      if (!leadsHere(caller)) return reply.code(403).send({ error: 'cannot-decide', message: LEADS_DECIDE });
      const body = req.body as { as: RaiseDecision['as']; note?: string; entity?: string; why?: string };
      try {
        if (body.as === 'keep') {
          const kept = await store.decideRaise(raise.id, { as: 'kept', by: caller.id, workspace: caller.workspace.id });
          void recorded({ actor: caller.id, action: 'entity.raised', target: raise.entity, workspace: caller.workspace.id, detail: { raise: raise.id, from: raise.from, to: raise.to } });
          return (await views(caller, [kept]))[0];
        }
        if (body.as === 'decline') {
          if (!body.note?.trim()) return reply.code(400).send({ error: 'note-needed', message: 'Say why, so whoever asked knows.' });
          const declined = await store.decideRaise(raise.id, { as: 'declined', by: caller.id, answer: body.note.trim() });
          void recorded({ actor: caller.id, action: 'entity.raise-declined', target: raise.entity, workspace: caller.workspace.id, detail: { raise: raise.id, to: raise.to } });
          return (await views(caller, [declined]))[0];
        }
        // "It's the same as…": one this floor already has. Kept here, then placed under it.
        if (!body.entity || !body.why?.trim()) return reply.code(400).send({ error: 'same-needs', message: 'Say which entity it is the same as, and why.' });
        const card = await store.entity(raise.entity);
        const other = await atlas.seen(req, reply, body.entity);
        if (!other) return reply;
        if (other.entity.floor !== here) return reply.code(409).send({ error: 'not-here', message: 'It can only be merged into one kept on this floor.' });
        if (other.entity.state !== 'active') return reply.code(409).send({ error: 'not-active', message: 'Only an entity in use can be merged into.' });
        if (card && card.type !== other.entity.type) return reply.code(400).send({ error: 'different-types', message: 'Only things of the same kind can be the same thing.' });
        const merged = await store.decideRaise(raise.id, { as: 'merged', by: caller.id, workspace: caller.workspace.id, mergedInto: other.entity.id });
        const merge = await store.mergeEntities({ junior: raise.entity, senior: other.entity.id, why: body.why.trim(), cites: [], by: caller.id });
        void recorded({ actor: caller.id, action: 'entity.raised', target: raise.entity, workspace: caller.workspace.id, detail: { raise: raise.id, from: raise.from, to: raise.to } });
        void recorded({ actor: caller.id, action: 'entity.merged', target: raise.entity, workspace: caller.workspace.id, detail: { into: other.entity.id, merge: merge.id, cites: 0 } });
        return (await views(caller, [merged]))[0];
      } catch (err) {
        if (err instanceof RaiseError || err instanceof MergeError) return reply.code(409).send({ error: err.code, message: err.message });
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>('/raises/:id/withdraw', { schema: { params: { type: 'object', properties: { id: ID }, required: ['id'] } } }, async (req, reply) => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const raise = await store.raise(req.params.id);
    if (!raise) return reply.code(404).send({ error: 'not-found', message: 'There’s no such request.' });
    const here = floorPrincipal(caller.id, caller.workspace);
    if (raise.from !== here || (!leadsHere(caller) && raise.askedBy !== caller.id))
      return reply.code(403).send({ error: 'cannot-withdraw', message: 'Only whoever asked, or the leads of the floor it was asked from, can withdraw it, from that floor.' });
    try {
      const withdrawn = await store.decideRaise(raise.id, { as: 'withdrawn', by: caller.id });
      void recorded({ actor: caller.id, action: 'entity.raise-withdrawn', target: raise.entity, workspace: caller.workspace.id, detail: { raise: raise.id } });
      return (await views(caller, [withdrawn]))[0];
    } catch (err) {
      if (err instanceof RaiseError) return reply.code(409).send({ error: err.code, message: err.message });
      throw err;
    }
  });
};

