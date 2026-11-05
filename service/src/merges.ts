import type { FastifyInstance } from 'fastify';
import type { EntityMerges, MergeBody, UndoMergeBody } from './api-types.ts';
import { floorPrincipal } from './floors.ts';
import type { Atlas } from './knowledge.ts';
import { MergeError } from './store.ts';

const ID = { type: 'string', minLength: 1, maxLength: 64 } as const;
const WHY = { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' } as const;

/**
 * Merges (PER-319, decision 0001): two entities found to be the same thing.
 * The junior is placed under the senior and nothing moves, so the merge can
 * always be explained (who, why, on what evidence for and against) and undone
 * exactly. Deciding one is for whoever may retire the junior: its floor's
 * leads, or whoever added it. The same people, or whoever made the merge, may
 * undo it.
 */
export const mergeRoutes = (app: FastifyInstance, atlas: Atlas) => {
  const { store, recorded } = atlas;

  const refusal = (err: unknown) => {
    if (!(err instanceof MergeError)) throw err;
    const status = err.code === 'bad-cite' || err.code === 'not-cited' ? 400 : 409;
    return { status, body: { error: err.code, message: err.message } };
  };

  app.get<{ Params: { id: string } }>('/entities/:id/merges', { schema: { params: { type: 'object', properties: { id: ID }, required: ['id'] } } }, async (req, reply) => {
    const found = await atlas.seen(req, reply, req.params.id);
    if (!found) return reply;
    const merges = await store.mergesOf(found.entity.id);
    const placedUnder = merges.find((m) => m.junior === found.entity.id && !m.undone);
    return { ...(placedUnder ? { placedUnder } : {}), merges } satisfies EntityMerges;
  });

  app.post<{ Params: { id: string }; Body: MergeBody }>(
    '/entities/:id/merge',
    {
      schema: {
        params: { type: 'object', properties: { id: ID }, required: ['id'] },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['into', 'why'],
          properties: {
            into: ID,
            why: WHY,
            cites: {
              type: 'array',
              maxItems: 50,
              items: { type: 'object', additionalProperties: false, required: ['observation', 'stance'], properties: { observation: ID, stance: { enum: ['for', 'against'] }, note: { type: 'string', maxLength: 1000 } } },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const found = await atlas.seen(req, reply, req.params.id);
      if (!found) return reply;
      const { caller, entity: junior } = found;
      if (req.body.into === junior.id) return reply.code(400).send({ error: 'same-entity', message: 'An entity can’t be merged into itself.' });
      const other = await atlas.seen(req, reply, req.body.into);
      if (!other) return reply;
      const senior = other.entity;
      if (junior.floor !== floorPrincipal(caller.id, caller.workspace))
        return reply.code(403).send({ error: 'cannot-merge', message: 'Go to the floor it’s kept on to merge it: that floor decides what it is.' });
      if (caller.workspace.role !== 'lead' && junior.createdBy !== caller.id)
        return reply.code(403).send({ error: 'cannot-merge', message: 'Only this floor’s leads, or whoever added it, can merge it into another entity.' });
      if (junior.type !== senior.type)
        return reply.code(400).send({ error: 'different-types', message: 'Only things of the same kind can be the same thing. Change one’s kind first if it was recorded wrongly.' });
      try {
        const merge = await store.mergeEntities({
          junior: junior.id,
          senior: senior.id,
          why: req.body.why.trim(),
          cites: (req.body.cites ?? []).map((c) => ({ observation: c.observation, stance: c.stance, note: c.note?.trim() ?? '' })),
          by: caller.id,
        });
        void recorded({ actor: caller.id, action: 'entity.merged', target: junior.id, workspace: caller.workspace.id, detail: { into: senior.id, merge: merge.id, cites: merge.cites.length } });
        return reply.code(201).send(merge);
      } catch (err) {
        const r = refusal(err);
        return reply.code(r.status).send(r.body);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: UndoMergeBody }>(
    '/merges/:id/undo',
    {
      schema: {
        params: { type: 'object', properties: { id: ID }, required: ['id'] },
        body: { type: 'object', additionalProperties: false, required: ['why'], properties: { why: WHY, discredit: { type: 'array', maxItems: 50, items: ID } } },
      },
    },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const merge = await store.merge(req.params.id);
      if (!merge) return reply.code(404).send({ error: 'not-found', message: 'There’s no such merge.' });
      // Seeing the junior is seeing the merge.
      const found = await atlas.seen(req, reply, merge.junior);
      if (!found) return reply;
      if (merge.floor !== floorPrincipal(caller.id, caller.workspace))
        return reply.code(403).send({ error: 'cannot-undo', message: 'Go to the floor the merge was decided on to undo it.' });
      if (caller.workspace.role !== 'lead' && merge.decidedBy !== caller.id && found.entity.createdBy !== caller.id)
        return reply.code(403).send({ error: 'cannot-undo', message: 'Only this floor’s leads, whoever made the merge, or whoever added the entity can undo it.' });
      try {
        const undone = await store.undoMerge(merge.id, { why: req.body.why.trim(), discredit: req.body.discredit ?? [], by: caller.id });
        void recorded({ actor: caller.id, action: 'entity.split', target: merge.junior, workspace: caller.workspace.id, detail: { from: merge.senior, merge: merge.id, discredited: undone.undone?.discredited.length ?? 0 } });
        return undone;
      } catch (err) {
        const r = refusal(err);
        return reply.code(r.status).send(r.body);
      }
    },
  );
};
