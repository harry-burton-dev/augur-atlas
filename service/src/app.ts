import Fastify from 'fastify';
import { appServer, packageVersion, peopleFor, Problem, readManifest, serviceFastifyOptions, signedInCaller, type AppManifest, type CallerCheck, type DirectorySearch, type Jobs } from '@augur/service-kit';
import {
  disputeAskSchema,
  disputedSchema,
  everythingSchema,
  followingSchema,
  foundSchema,
  thingViewSchema,
  wrongChoicesSchema,
  type DisputeAsk,
  type Disputed,
  type Everything,
  type Following,
  type Found,
  type ThingView,
  type WrongChoices,
} from './api-types.ts';
import { memoryEvents, partEvents, type EventsKept } from './events.ts';
import { everything, wrongLines } from './everything.ts';
import { memoryFollows, type Follows } from './follows.ts';
import { delegationOf, gatewayKnowledge, KnowledgeRefused, type Knowledge } from './knowledge.ts';
import { openApi } from './openapi.ts';
import { choose, rulesFor, shownBeliefs, toView, words, type KBelief, type ThingInput } from './shape.ts';

/** The major version of the API this service serves. Its routes go under /v1, as the platform's do. */
export const API_VERSION = 'v1';
/** Who wrote a report when identity can't say. */
const SOMEONE = 'Someone';
const version = packageVersion(import.meta.url);

export interface Options {
  manifest?: AppManifest;
  /** Checks the caller the gateway signed for this app's part (contract 3). On by default; tests believe `x-user-*` headers. */
  callers?: CallerCheck;
  /** Where pushed events are kept; in memory without a database (index.ts gives it one). */
  events?: EventsKept;
  /** What people keep an eye on: Data Atlas's own data; in memory without a database. */
  follows?: Follows;
  /** Background and scheduled jobs; startAppService passes them in. */
  jobs?: Jobs;
  /** The knowledge graph for one call, as the person: through the gateway by default, a store in tests. */
  knowledge?: (delegation: string | undefined) => Knowledge;
  /** Who wrote a report, by name (the `people:read` scope); identity through the gateway by default. */
  directory?: DirectorySearch;
  /** What "now" is: the answer's Now and Next are read against it. */
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export const buildApp = async ({ manifest = readManifest(import.meta.url), callers, events = memoryEvents(), follows = memoryFollows(), knowledge, directory, now = () => new Date(), env = process.env }: Options = {}) => {
  const app = Fastify(serviceFastifyOptions());
  await appServer(app, { manifest, version, api: API_VERSION, callers });
  const caller = signedInCaller(manifest);
  const people = directory ?? peopleFor(manifest.id, { env }).directory;
  const graph = knowledge ?? ((delegation) => gatewayKnowledge(manifest.id, delegation, { env }));

  app.get(`/${(manifest.api as { openapi: string }).openapi}`, async () => openApi(manifest, version, API_VERSION));
  await partEvents(app, { kept: events });

  /** The floor the shell called on: every read is the person's, from where they stand. */
  const standing = (req: Parameters<typeof caller>[0]) => {
    const person = caller(req);
    if (!person.workspace) throw new Problem(400, 'no_floor', 'Data Atlas needs a floor to read from.');
    return { person, floor: person.workspace.id, kg: graph(delegationOf(req.headers)) };
  };
  // The graph's own refusals pass on as they are (not allowed, already done, doesn't fit); anything else is the graph not answering.
  const PASSED_ON = new Set([403, 409, 422]);
  const refused = (err: unknown): never => {
    if (err instanceof KnowledgeRefused)
      throw new Problem(PASSED_ON.has(err.status) ? err.status : 502, 'knowledge_refused', err.message, err.status === 403 ? { whoCanChange: 'Your administrator, in Admin, Apps' } : {});
    throw err;
  };

  /** Everything the rules need about one thing, read as the person. */
  const read = async (kg: Knowledge, floor: string, id: string): Promise<ThingInput> => {
    const entity = await kg.entity(floor, id);
    if (!entity) throw new Problem(404, 'not_found', 'Nothing by that name is in sight from this floor.');
    const [beliefs, around, conflicts, ontology] = await Promise.all([kg.beliefs(floor, entity.id), kg.around(floor, entity.id), kg.conflicts(floor), kg.ontology()]);
    // What is coming here: the beliefs of things whose "next" links point at it, so "Due here" can say when.
    const comers = [...new Set(around.edges.filter((b) => b.object === entity.id && b.subject !== entity.id).map((b) => b.subject))].slice(0, 6);
    const neighbourBeliefs = (await Promise.all(comers.map((c) => kg.beliefs(floor, c)))).flat();
    return { entity, beliefs, edges: around.edges, nodes: around.nodes, conflicts, neighbourBeliefs, ...ontology, reports: Math.max(0, ...beliefs.map((b) => b.evidence.sources)), now: now() };
  };

  await app.register(
    async (app) => {
      // One thing in the one shape (App patterns, "A thing's page"), filled by Atlas's rules from what the person can see.
      app.get<{ Params: { id: string } }>('/things/:id', { schema: { response: { 200: thingViewSchema } } }, async (req): Promise<ThingView> => {
        const { person, floor, kg } = standing(req);
        try {
          const input = await read(kg, floor, req.params.id);
          const rules = rulesFor(input);
          const choice = choose(input, rules);
          // Sources only for the lines that show at rest.
          const sources = new Map<KBelief, Awaited<ReturnType<Knowledge['source']>>>();
          await Promise.all(
            shownBeliefs(choice).map(async (b) => {
              const seen = b.evidence.seen?.at(-1);
              if (seen) sources.set(b, await kg.source(floor, seen));
            }),
          );
          // Authors by name: a report says who wrote it, never an id. Without identity, "Someone".
          const authors = [...new Set([...sources.values()].flatMap((s) => (s && s.author !== person.id ? [s.author] : [])))];
          const names = new Map((authors.length ? (await people({ ids: authors, limit: authors.length }).catch(() => ({ people: [] }))).people : []).map((p) => [p.id, p.name.split(' ')[0]!]));
          return toView(input, choice, (b) => {
            const s = sources.get(b);
            if (!s) return undefined;
            const mine = s.author === person.id;
            return { id: s.id, title: s.title, who: mine ? person.name.split(' ')[0]! : (names.get(s.author) ?? SOMEONE), on: (s.writtenAt ?? '').slice(0, 10), ...(mine ? { byYou: true } : {}), ...(s.floor === floor && person.workspace?.kind === 'personal' ? { yours: true } : {}) };
          });
        } catch (err) {
          return refused(err);
        }
      });

      // Everything we know of it, now and before: one step from its page.
      app.get<{ Params: { id: string } }>('/things/:id/everything', { schema: { response: { 200: everythingSchema } } }, async (req): Promise<Everything> => {
        const { floor, kg } = standing(req);
        try {
          return everything(await read(kg, floor, req.params.id));
        } catch (err) {
          return refused(err);
        }
      });

      // "Something's wrong": the lines a person can say are wrong, the page's own first.
      app.get<{ Params: { id: string } }>('/things/:id/wrong', { schema: { response: { 200: wrongChoicesSchema } } }, async (req): Promise<WrongChoices> => {
        const { floor, kg } = standing(req);
        try {
          const input = await read(kg, floor, req.params.id);
          const rules = rulesFor(input);
          return { lines: wrongLines(input, shownBeliefs(choose(input, rules)), rules) };
        } catch (err) {
          return refused(err);
        }
      });

      // One line said to be wrong, as the person, for its floor's settler to settle (the graph's dispute action).
      // The Idempotency-Key the person's press came with makes a repeat harmless.
      app.post<{ Params: { id: string }; Body: DisputeAsk }>(
        '/things/:id/disputes',
        { schema: { body: disputeAskSchema, response: { 200: disputedSchema } } },
        async (req): Promise<Disputed> => {
          const { floor, kg } = standing(req);
          const key = req.headers['idempotency-key'];
          if (typeof key !== 'string' || key.length < 8) throw new Problem(400, 'idempotency_key_required', 'Send an Idempotency-Key header, new for each thing you say is wrong.');
          try {
            const input = await read(kg, floor, req.params.id);
            if (!input.beliefs.some((b) => b.id === req.body.belief)) throw new Problem(422, 'not_about_it', 'That line isn’t about this thing, as far as this floor can see.');
            const done = await kg.act('dispute', { belief: req.body.belief, reason: req.body.reason.trim() }, `atlas-${key}`);
            return { dispute: done.effects.disputes?.[0] ?? done.actionId };
          } catch (err) {
            return refused(err);
          }
        },
      );

      // Keeping an eye on a thing: Data Atlas's own record, on the floor the person stands on.
      app.get<{ Params: { id: string } }>('/follows/:id', { schema: { response: { 200: followingSchema } } }, async (req): Promise<Following> => {
        const { person, floor } = standing(req);
        return { thing: req.params.id, following: await follows.has(person.id, floor, req.params.id) };
      });
      app.put<{ Params: { id: string } }>('/follows/:id', { schema: { response: { 200: followingSchema } } }, async (req): Promise<Following> => {
        const { person, floor, kg } = standing(req);
        // Only a thing in sight can be followed, so nobody learns of one they can't see.
        const seen = await kg.entity(floor, req.params.id).catch(refused);
        if (!seen) throw new Problem(404, 'not_found', 'Nothing by that name is in sight from this floor.');
        await follows.follow(person.id, floor, req.params.id);
        return { thing: req.params.id, following: true };
      });
      app.delete<{ Params: { id: string } }>('/follows/:id', { schema: { response: { 200: followingSchema } } }, async (req): Promise<Following> => {
        const { person, floor } = standing(req);
        await follows.unfollow(person.id, floor, req.params.id);
        return { thing: req.params.id, following: false };
      });

      // Things whose names match what the person typed, best first.
      app.get<{ Querystring: { q?: string } }>('/find', { schema: { response: { 200: foundSchema } } }, async (req): Promise<Found> => {
        const { floor, kg } = standing(req);
        const q = (req.query.q ?? '').trim();
        if (!q) return { query: q, things: [] };
        try {
          const [found, { classes }] = await Promise.all([kg.find(floor, q), kg.ontology()]);
          const kind = (iri: string) => classes.find((c) => c.iri === iri)?.label ?? words(iri);
          return { query: q, things: found.slice(0, 20).map((e) => ({ id: e.id, name: e.label ?? 'Not yet named', kind: kind(e.class) })) };
        } catch (err) {
          return refused(err);
        }
      });
    },
    { prefix: `/${API_VERSION}` },
  );
  return app;
};
