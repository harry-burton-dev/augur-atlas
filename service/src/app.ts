import Fastify from 'fastify';
import { appServer, packageVersion, peopleFor, Problem, readManifest, serviceFastifyOptions, signedInCaller, type AppManifest, type CallerCheck, type DirectorySearch, type Jobs } from '@augur/service-kit';
import { foundSchema, thingViewSchema, type Found, type ThingView } from './api-types.ts';
import { memoryEvents, partEvents, type EventsKept } from './events.ts';
import { delegationOf, gatewayKnowledge, KnowledgeRefused, type Knowledge } from './knowledge.ts';
import { openApi } from './openapi.ts';
import { choose, rulesFor, shownBeliefs, toView, words, type KBelief } from './shape.ts';

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

export const buildApp = async ({ manifest = readManifest(import.meta.url), callers, events = memoryEvents(), knowledge, directory, now = () => new Date(), env = process.env }: Options = {}) => {
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
  const refused = (err: unknown) => {
    if (err instanceof KnowledgeRefused) throw new Problem(err.status === 403 ? 403 : 502, 'knowledge_refused', err.message, err.status === 403 ? { whoCanChange: 'Your administrator, in Admin, Apps' } : {});
    throw err;
  };

  await app.register(
    async (app) => {
      // One thing in the one shape (App patterns, "A thing's page"), filled by Atlas's rules from what the person can see.
      app.get<{ Params: { id: string } }>('/things/:id', { schema: { response: { 200: thingViewSchema } } }, async (req): Promise<ThingView> => {
        const { person, floor, kg } = standing(req);
        try {
          const entity = await kg.entity(floor, req.params.id);
          if (!entity) throw new Problem(404, 'not_found', 'Nothing by that name is in sight from this floor.');
          const [beliefs, around, conflicts, ontology] = await Promise.all([kg.beliefs(floor, entity.id), kg.around(floor, entity.id), kg.conflicts(floor), kg.ontology()]);
          // What is coming here: the beliefs of things whose "next" links point at it, so "Due here" can say when.
          const comers = [...new Set(around.edges.filter((b) => b.object === entity.id && b.subject !== entity.id).map((b) => b.subject))].slice(0, 6);
          const neighbourBeliefs = (await Promise.all(comers.map((id) => kg.beliefs(floor, id)))).flat();
          const input = { entity, beliefs, edges: around.edges, nodes: around.nodes, conflicts, neighbourBeliefs, ...ontology, reports: Math.max(0, ...beliefs.map((b) => b.evidence.sources)), now: now() };
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
