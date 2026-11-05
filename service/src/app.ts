import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { appServer, packageVersion, Problem, sendProblem, serviceFastifyOptions, signedInCaller, type CallerCheck, type OnFloor } from '@augur/service-kit';
import { FLOOR_WORDS, type EntityFields, type EntityList, type EntityRights, type EntityView, type SubgraphQuery } from './api-types.ts';
import { auditFromEnv, type Audit } from './audit.ts';
import { floorKindOf, floorPrincipal, unseen, viewFloors } from './floors.ts';
import { checkDetail, detailsOf, normaliseDetail, ontologyFor, withSubtypes, type Ontology } from './ontology.ts';
import { peopleFromEnv, type People } from './people.ts';
import { knowledgeRoutes, subgraph, type Atlas } from './knowledge.ts';
import { mapRoutes, type MapOptions } from './map.ts';
import { mergeRoutes } from './merges.ts';
import { checkRoutes } from './shacl.ts';
import { raiseRoutes } from './raises.ts';
import { proposalRoutes } from './proposals.ts';
import { resolver, type Embed } from './resolve.ts';
import { studioRoutes } from './studio.ts';
import { KeyTakenError, refOf, type Entity, type PgAtlasStore } from './store.ts';
import { manifest } from './manifest.ts';

/** The major version of the API this service serves. Its routes go under /v1, as the platform's do. */
export const API_VERSION = 'v1';
const version = packageVersion(import.meta.url);

export interface Options {
  store: PgAtlasStore;
  /** Checks the caller the gateway signed for this app. In production it is on by default; in dev `x-user-*` headers are believed. */
  callers?: CallerCheck;
  people?: People;
  audit?: Audit;
  /** Turns text into vectors through the model gateway, to match by meaning. Without it, Triage says matching by meaning is off. */
  embed?: Embed;
  /** The deployment's base map file and its credit (ATLAS_MAP_TILES, ATLAS_MAP_ATTRIBUTION). */
  map?: MapOptions;
}

export type { OnFloor };

/** What the caller may do with an entity, and the entity as they see it (see `api-types.ts`). */
export type { EntityRights, EntityView };

const LABEL = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } as const;
const ALIASES = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } } as const;
const DESCRIPTION = { type: 'string', maxLength: 2000 } as const;
const DETAILS = { type: 'object', maxProperties: 50, additionalProperties: { type: 'string', maxLength: 200 } } as const;
/** A team identity couldn't name: shown as is in lists, left unnamed in sentences. */
const UNNAMED_TEAM = FLOOR_WORDS.unnamedTeam;
const knownName = (name: string) => (name === UNNAMED_TEAM ? undefined : name);
/** Entity links as apps send them: only the id is read; the rest of an EntityRef may come along. */
const REFS = { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['id'] } } as const;
const ID_PARAMS = { type: 'object', properties: { id: { type: 'string', maxLength: 64 } }, required: ['id'] } as const;

export const buildApp = async ({ store, callers, people = peopleFromEnv(), audit, embed, map = {} }: Options) => {
  const app = Fastify(serviceFastifyOptions());
  const record = audit ?? auditFromEnv((entry) => app.log.info({ audit: entry }, 'audit (no audit log here)'));
  const recorded = (entry: Parameters<Audit>[0]) =>
    record(entry).catch((err: Error) => app.log.error({ err: err.message, action: entry.action, target: entry.target }, 'could not record in the audit log'));
  // Only the gateway's signed word says who is calling, every error is problem details, and /healthz says what runs.
  await appServer(app, { manifest, version, api: API_VERSION, ...(callers ? { callers } : {}) });

  /** The caller and the floor they're on, or a problem already sent (401 signed out, 400 no floor). What you see in Data Atlas depends on where you stand. */
  const signedIn = signedInCaller(manifest);
  const onFloor = (req: FastifyRequest, reply: FastifyReply): OnFloor | undefined => {
    try {
      const caller = signedIn(req);
      if (!caller.workspace) throw new Problem(400, 'floor_needed', 'Say which floor you’re standing on (X-Workspace-Id): what shows depends on it.');
      return caller as OnFloor;
    } catch (err) {
      if (!(err instanceof Problem)) throw err;
      sendProblem(reply, err);
      return undefined;
    }
  };

  /** What the caller stands for, and which floors' entities show from where they stand. */
  const sight = async (caller: OnFloor) => {
    const principals = await people.principals(caller.id, caller.workspace);
    const path = caller.workspace.kind === 'team' ? await people.teamPath(caller.workspace.id) : undefined;
    return { principals, floors: viewFloors(caller.workspace, principals, path) };
  };

  /** Floors' names as people know them: the organisation's name as Admin sets it, your own floor, a team's name. */
  const nameFloors = async (caller: OnFloor, floors: readonly string[]) => {
    const [teams, org] = await Promise.all([
      people.teamNames([...new Set(floors.filter((f) => f.startsWith('tree:')).map((f) => f.slice(5)))]).catch(() => new Map<string, string>()),
      floors.includes('org') ? people.orgName().catch(() => undefined) : undefined,
    ]);
    return (floor: string) => {
      const kind = floorKindOf(caller.id, floor);
      if (kind === 'org') return org ?? FLOOR_WORDS.unnamedOrg;
      if (kind === 'own') return FLOOR_WORDS.own;
      if (kind === 'personal') return FLOOR_WORDS.someonesOwn;
      return teams.get(floor.slice(5)) ?? UNNAMED_TEAM;
    };
  };

  const rightsOn = (caller: OnFloor, entity: Entity, floorName: string): EntityRights => {
    if (entity.state === 'merged') return { edit: false, retire: false, why: 'It was found to be the same as another entity and placed under it: undo the merge to change it.' };
    if (entity.state !== 'active') return { edit: false, retire: false, why: 'It has been retired, so it can’t be changed.' };
    const here = floorPrincipal(caller.id, caller.workspace);
    if (entity.floor !== here) {
      const kind = floorKindOf(caller.id, entity.floor);
      const where = kind === 'own' ? 'your own floor' : kind === 'org' ? 'the org floor' : kind === 'team' && knownName(floorName) ? `the ${floorName} floor` : 'another floor';
      return { edit: false, retire: false, why: `It’s kept on ${where}: go there to change it.` };
    }
    const retire = caller.workspace.role === 'lead' || entity.createdBy === caller.id;
    return { edit: true, retire, ...(retire ? {} : { why: 'Only this floor’s leads, or whoever added it, can retire it.' }) };
  };

  const view = async (caller: OnFloor, entities: Entity[]): Promise<EntityView[]> => {
    const named = await nameFloors(caller, entities.map((e) => e.floor));
    return entities.map((e) => ({ ...e, floorName: named(e.floor), floorKind: floorKindOf(caller.id, e.floor), can: rightsOn(caller, e, named(e.floor)) }));
  };

  /** Checks and tidies details against the ontology; the first problem found, in words, when there is one. */
  const tidyDetails = (ontology: Ontology, type: string, given: Record<string, string>): Record<string, string> | string => {
    const defs = new Map(detailsOf(ontology, type).map((d) => [d.key, d]));
    const tidy: Record<string, string> = {};
    for (const [key, raw] of Object.entries(given)) {
      const def = defs.get(key);
      if (!def) return `A ${ontology.types.find((t) => t.key === type)?.label.toLowerCase() ?? type} has no detail called “${key}”.`;
      if (def.onEntity === false) return `${def.label} is known through what people observe, floor by floor: record an observation of it instead.`;
      if (!raw.trim()) continue;
      const value = normaliseDetail(def, raw);
      const problem = checkDetail(def, value);
      if (problem) return problem;
      tidy[key] = value;
    }
    return tidy;
  };

  /** A refusal for an identity key someone else holds, naming the holder when the caller may see it. */
  const keyTaken = async (caller: OnFloor, err: KeyTakenError) => {
    const { principals, floors } = await sight(caller);
    const holder = err.holder;
    const what = `${err.detail.label} ${err.value}`;
    if (err.during) {
      // A key that changes hands: another entity holds it over some of the same time, which isn't the same thing.
      const span = [err.during.from ? `from ${err.during.from.slice(0, 10)}` : '', err.during.to ? `until ${err.during.to.slice(0, 10)}` : 'with no end yet'].filter(Boolean).join(' ');
      const fix = 'Only one thing holds it at a time: end that record first, or give this one dates that don’t overlap.';
      if (floors.includes(holder.floor)) return { error: 'key-held', message: `${what} is ${holder.label}’s ${span}. ${fix}`, holder: { id: holder.id, label: holder.label, type: holder.type } };
      const named = await nameFloors(caller, [holder.floor]);
      const why = unseen(holder.floor, principals, caller.id, knownName(named(holder.floor)));
      return { error: 'key-held', message: `${what} is another entity’s ${span}. ${fix} ${why.message}`, holder: { id: holder.id, hidden: true, reason: why.reason } };
    }
    if (floors.includes(holder.floor)) {
      return { error: 'key-taken', message: `${what} is already ${holder.label}. It’s the same real thing: open it instead of adding another.`, holder: { id: holder.id, label: holder.label, type: holder.type } };
    }
    const named = await nameFloors(caller, [holder.floor]);
    const why = unseen(holder.floor, principals, caller.id, knownName(named(holder.floor)));
    return { error: 'key-taken', message: `${what} is already another entity’s. ${why.message}`, holder: { id: holder.id, hidden: true, reason: why.reason } };
  };

  /** The entity, if the caller may see it from where they stand; else a refusal saying why, already sent. */
  const seen = async (req: FastifyRequest, reply: FastifyReply, id: string) => {
    const caller = onFloor(req, reply);
    if (!caller) return undefined;
    const entity = await store.entity(id);
    if (!entity) {
      reply.code(404).send({ error: 'not-found', message: 'There’s no such entity.' });
      return undefined;
    }
    const { principals, floors } = await sight(caller);
    if (!floors.includes(entity.floor)) {
      const named = await nameFloors(caller, [entity.floor]);
      const why = unseen(entity.floor, principals, caller.id, knownName(named(entity.floor)));
      reply.code(403).send({ error: 'unseen', ...why, id });
      return undefined;
    }
    return { caller, entity };
  };

  /** What a floor's knowledge routes need from here. */
  /**
   * The ontology from where the caller stands: a team's kinds and details only from that team down.
   * What they add or record is checked against this. Admins see every kind in the studio (`all`),
   * each team's named, but still record only what shows from their floor.
   */
  const ontologySeen = async (caller: OnFloor, all = false): Promise<Ontology> => {
    const ontology = await store.ontology();
    const floors = [...new Set(ontology.types.flatMap((t) => [t.floor, ...t.details.map((d) => d.floor)]).filter((f): f is string => !!f))];
    if (!floors.length) return ontology;
    if (all && caller.roles.includes('admin')) {
      const named = await nameFloors(caller, floors);
      return {
        ...ontology,
        types: ontology.types.map((t) => ({ ...t, ...(t.floor ? { floorName: named(t.floor) } : {}), details: t.details.map((d) => (d.floor ? { ...d, floorName: named(d.floor) } : d)) })),
      };
    }
    return ontologyFor(ontology, (await sight(caller)).principals);
  };

  const atlas: Atlas = {
    ontologySeen,
    store,
    onFloor,
    sight,
    nameFloors,
    seen,
    recorded,
    unseenFrom: (caller, floor, principals, name) => unseen(floor, principals, caller.id, knownName(name)),
    tidyDetails,
    keyTaken,
    resolver: resolver(store, embed),
    people,
  };

  await app.register(
    async (app) => {
      app.get('/ontology', async (req) => {
        const caller = signedIn(req);
        // Without a floor, only the whole organisation's kinds.
        return caller.workspace ? ontologySeen(caller as OnFloor, true) : ontologyFor(await store.ontology(), []);
      });

      app.get<{ Querystring: { q?: string; type?: string[]; limit?: number; offset?: number } }>(
        '/entities',
        {
          schema: {
            querystring: {
              type: 'object',
              properties: {
                q: { type: 'string', maxLength: 200 },
                // One kind or several (?type=vessel&type=port); each brings its subkinds.
                type: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 64 } },
                limit: { type: 'integer', minimum: 1, maximum: 200 },
                offset: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        async (req, reply) => {
          const caller = onFloor(req, reply);
          if (!caller) return reply;
          const { floors } = await sight(caller);
          const ontology = req.query.type?.length ? await store.ontology() : undefined;
          const types = ontology && [...new Set(req.query.type!.flatMap((t) => withSubtypes(ontology, t)))];
          const { entities, total } = await store.entities({ floors, q: req.query.q, types, limit: req.query.limit, offset: req.query.offset });
          const named = await nameFloors(caller, floors);
          // Which floors' knowledge this is, by name, so the app can say so rather than leave people guessing.
          return { entities: await view(caller, entities), total, floors, seeing: floors.map(named) } satisfies EntityList;
        },
      );

      app.post<{ Body: Required<Pick<EntityFields, 'type' | 'label'>> & EntityFields }>(
        '/entities',
        {
          schema: {
            body: {
              type: 'object',
              properties: { type: { type: 'string', minLength: 1, maxLength: 64 }, label: LABEL, aliases: ALIASES, description: DESCRIPTION, details: DETAILS },
              required: ['type', 'label'],
              additionalProperties: false,
            },
          },
        },
        async (req, reply) => {
          const caller = onFloor(req, reply);
          if (!caller) return reply;
          const ontology = await ontologySeen(caller);
          const type = ontology.types.find((t) => t.key === req.body.type);
          if (!type) return reply.code(400).send({ error: 'unknown-type', message: `The ontology has no kind of thing called “${req.body.type}”.` });
          if (type.abstract) return reply.code(400).send({ error: 'abstract-type', message: `${type.label} is a heading for other kinds: pick one of those.` });
          const details = tidyDetails(ontology, type.key, req.body.details ?? {});
          if (typeof details === 'string') return reply.code(400).send({ error: 'bad-detail', message: details });
          try {
            const entity = await store.createEntity(
              {
                type: type.key,
                label: req.body.label.trim(),
                aliases: [...new Set((req.body.aliases ?? []).map((a) => a.trim()))],
                description: req.body.description?.trim() ?? '',
                details,
                workspace: caller.workspace.id,
                floor: floorPrincipal(caller.id, caller.workspace),
                createdBy: caller.id,
              },
              ontology,
            );
            void recorded({ actor: caller.id, action: 'entity.created', target: entity.id, workspace: caller.workspace.id, detail: { type: entity.type, label: entity.label } });
            // Its vector, so it can be matched by meaning: in the background, never holding up the answer.
            void atlas.resolver.catchUp(ontology);
            return reply.code(201).send((await view(caller, [entity]))[0]);
          } catch (err) {
            if (err instanceof KeyTakenError) return reply.code(409).send(await keyTaken(caller, err));
            throw err;
          }
        },
      );

      /**
       * For apps that keep entity links (SDK EntityRef): what each id is now, as the caller sees it from
       * where they stand, so a cached name can be brought up to date. One the caller can't see says why,
       * rather than vanishing; one that never was says so.
       */
      app.post<{ Body: { refs: { id: string }[] } }>(
        '/entities/resolve',
        { schema: { body: { type: 'object', properties: { refs: REFS }, required: ['refs'], additionalProperties: false } } },
        async (req, reply) => {
          const caller = onFloor(req, reply);
          if (!caller) return reply;
          const ids = [...new Set(req.body.refs.map((r) => r.id))];
          const found = new Map((await store.entitiesById(ids)).map((e) => [e.id, e]));
          const { principals, floors } = await sight(caller);
          const named = await nameFloors(caller, [...found.values()].map((e) => e.floor));
          return {
            entities: ids.map((id) => {
              const e = found.get(id);
              if (!e) return { id, missing: true, message: 'There’s no such entity.' };
              if (!floors.includes(e.floor)) return { id, hidden: true, ...unseen(e.floor, principals, caller.id, knownName(named(e.floor))) };
              return { id, ref: refOf(e), state: e.state, floorName: named(e.floor) };
            }),
          };
        },
      );

      /**
       * The part of the graph around some entities, as seen from where the caller stands: for Data Atlas's
       * explorer and the intent app's briefing context. Entities are linked by facts whose value is an entity.
       */
      app.post<{ Body: Omit<SubgraphQuery, 'seeds'> & { seeds: { id: string }[] } }>(
        '/subgraph',
        {
          schema: {
            body: {
              type: 'object',
              properties: {
                seeds: { ...REFS, maxItems: 50 },
                depth: { type: 'integer', minimum: 0, maximum: 3 },
                types: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 64 } },
                relations: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 64 } },
                asOf: { type: 'string', format: 'date-time' },
                limitPerNode: { type: 'integer', minimum: 1, maximum: 200 },
              },
              required: ['seeds'],
              additionalProperties: false,
            },
          },
        },
        async (req, reply) => {
          const caller = onFloor(req, reply);
          if (!caller) return reply;
          return subgraph(atlas, caller, { ...req.body, seeds: req.body.seeds.map((r) => r.id) });
        },
      );

      app.get<{ Params: { id: string } }>('/entities/:id', { schema: { params: ID_PARAMS } }, async (req, reply) => {
        const found = await seen(req, reply, req.params.id);
        if (!found) return reply;
        return (await view(found.caller, [found.entity]))[0];
      });

      app.patch<{ Params: { id: string }; Body: Omit<EntityFields, 'type'> }>(
        '/entities/:id',
        {
          schema: {
            params: ID_PARAMS,
            body: { type: 'object', properties: { label: LABEL, aliases: ALIASES, description: DESCRIPTION, details: DETAILS }, additionalProperties: false, minProperties: 1 },
          },
        },
        async (req, reply) => {
          const found = await seen(req, reply, req.params.id);
          if (!found) return reply;
          const { caller, entity } = found;
          const can = rightsOn(caller, entity, (await nameFloors(caller, [entity.floor]))(entity.floor));
          if (!can.edit) return reply.code(403).send({ error: 'cannot-edit', message: can.why });
          const ontology = await ontologySeen(caller);
          const details = req.body.details && tidyDetails(ontology, entity.type, req.body.details);
          if (typeof details === 'string') return reply.code(400).send({ error: 'bad-detail', message: details });
          try {
            const changed = await store.updateEntity(
              entity.id,
              {
                ...(req.body.label ? { label: req.body.label.trim() } : {}),
                ...(req.body.aliases ? { aliases: [...new Set(req.body.aliases.map((a) => a.trim()))] } : {}),
                ...(req.body.description !== undefined ? { description: req.body.description.trim() } : {}),
                ...(details ? { details } : {}),
              },
              caller.id,
              ontology,
            );
            if (!changed) return reply.code(409).send({ error: 'retired', message: 'It was retired or merged while you were changing it.' });
            void recorded({ actor: caller.id, action: 'entity.changed', target: entity.id, workspace: caller.workspace.id, detail: { fields: Object.keys(req.body) } });
            void atlas.resolver.catchUp(ontology);
            return (await view(caller, [changed]))[0];
          } catch (err) {
            if (err instanceof KeyTakenError) return reply.code(409).send(await keyTaken(caller, err));
            throw err;
          }
        },
      );

      app.post<{ Params: { id: string } }>('/entities/:id/retire', { schema: { params: ID_PARAMS } }, async (req, reply) => {
        const found = await seen(req, reply, req.params.id);
        if (!found) return reply;
        const { caller, entity } = found;
        const can = rightsOn(caller, entity, (await nameFloors(caller, [entity.floor]))(entity.floor));
        if (!can.retire) return reply.code(403).send({ error: 'cannot-retire', message: can.why });
        const retired = await store.retireEntity(entity.id, caller.id);
        if (!retired) return reply.code(409).send({ error: 'retired', message: entity.state === 'merged' ? 'It is merged into another entity: undo the merge first.' : 'It has already been retired.' });
        void recorded({ actor: caller.id, action: 'entity.retired', target: entity.id, workspace: caller.workspace.id, detail: { type: entity.type, label: entity.label } });
        return (await view(caller, [retired]))[0];
      });
      knowledgeRoutes(app, atlas);
      mapRoutes(app, atlas, map);
      mergeRoutes(app, atlas);
      raiseRoutes(app, atlas);
      proposalRoutes(app, atlas);
      studioRoutes(app, atlas);
      checkRoutes(app, atlas);
    },
    { prefix: `/${API_VERSION}` },
  );
  return app;
};
