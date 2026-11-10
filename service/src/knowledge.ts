import { appCredentialsFromEnv, CALLER_TOKEN_HEADER, DELEGATION_HEADER } from '@augur/service-kit';
import type { KBelief, KClass, KConflicts, KEntity, KPredicate } from './shape.ts';

/**
 * What Data Atlas reads of the knowledge graph, as the person it acts for (the `knowledge:read` scope).
 * Atlas keeps none of it: every page is read fresh, through the gateway (AUGUR's docs/build-an-app.md).
 */
export interface Knowledge {
  entity(floor: string, id: string): Promise<KEntity | undefined>;
  beliefs(floor: string, id: string): Promise<KBelief[]>;
  /** Links in sight one step out, both ways, and the things they reach. */
  around(floor: string, id: string): Promise<{ nodes: KEntity[]; edges: KBelief[] }>;
  conflicts(floor: string): Promise<KConflicts>;
  ontology(): Promise<{ classes: KClass[]; predicates: KPredicate[] }>;
  /** The newest source in sight behind a belief: its title, author and date. */
  source(floor: string, observation: string): Promise<{ id: string; title: string; author: string; writtenAt?: string; floor: string } | undefined>;
  /** Things whose name or other names match. */
  find(floor: string, text: string): Promise<KEntity[]>;
  /** Takes one of the graph's actions as the person (`knowledge:act`), from the floor they stand on. `key` makes a repeat harmless. */
  act(name: string, input: Record<string, unknown>, key: string): Promise<{ actionId: string; effects: Record<string, string[]> }>;
}

/** The knowledge graph said no, or isn't there: its status, and the sentence to show. */
export class KnowledgeRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/**
 * The knowledge graph through the gateway (contract 3, spec 8.5): the part signs in as the app and sends the
 * delegated caller it received (`x-augur-caller`) back as `x-augur-delegation`, so every read is the person's.
 */
export const gatewayKnowledge = (app: string, delegation: string | undefined, { env = process.env, fetchImpl = fetch }: { env?: Record<string, string | undefined>; fetchImpl?: Fetch } = {}): Knowledge => {
  const gateway = env.GATEWAY_URL?.replace(/\/+$/, '');
  const credentials = appCredentialsFromEnv(app, env);
  const call = async <T>(path: string, { query = {}, body, key }: { query?: Record<string, string>; body?: unknown; key?: string } = {}): Promise<T | undefined> => {
    if (!gateway || !credentials) throw new KnowledgeRefused(503, 'Data Atlas can’t reach the knowledge graph here: it has no gateway to call.');
    const url = new URL(`${gateway}/api/knowledge/v1${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${await credentials.getToken()}`,
        accept: 'application/json',
        ...(delegation ? { [DELEGATION_HEADER]: delegation } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 404 && body === undefined) return undefined;
    if (!res.ok) {
      const problem = (await res.json().catch(() => undefined)) as { detail?: string; message?: string } | undefined;
      throw new KnowledgeRefused(res.status, problem?.detail ?? problem?.message ?? `The knowledge graph answered ${res.status}.`);
    }
    return (await res.json()) as T;
  };
  const get = <T>(path: string, query: Record<string, string> = {}) => call<T>(path, { query });
  const f = (floor: string) => `/floors/${encodeURIComponent(floor)}`;
  const isEntity = (e: unknown): e is KEntity => typeof (e as KEntity | undefined)?.class === 'string';
  return {
    entity: async (floor, id) => {
      const e = await get<unknown>(`${f(floor)}/entities/${encodeURIComponent(id)}`);
      return isEntity(e) ? e : undefined;
    },
    beliefs: async (floor, id) => (await get<{ beliefs: KBelief[] }>(`${f(floor)}/entities/${encodeURIComponent(id)}/beliefs`))?.beliefs ?? [],
    around: async (floor, id) => {
      const g = await get<{ nodes: KEntity[]; edges: KBelief[] }>(`${f(floor)}/entities/${encodeURIComponent(id)}/subgraph`, { depth: '1' });
      return { nodes: g?.nodes ?? [], edges: g?.edges ?? [] };
    },
    conflicts: async (floor) => (await get<KConflicts>(`${f(floor)}/conflicts`)) ?? { conflicts: [], possibleDuplicates: [] },
    ontology: async () => (await get<{ classes: KClass[]; predicates: KPredicate[] }>('/ontology')) ?? { classes: [], predicates: [] },
    source: async (floor, observation) => {
      const o = await get<{ source?: { id: string; title: string; author: string; writtenAt?: string; floor: string } }>(`${f(floor)}/observations/${encodeURIComponent(observation)}`);
      return o?.source;
    },
    find: async (floor, text) => (await get<{ entities: KEntity[] }>(`${f(floor)}/entities`, { text }))?.entities ?? [],
    act: async (name, input, key) => {
      const done = await call<{ actionId: string; effects: Record<string, string[]> }>(`/actions/${encodeURIComponent(name)}`, { body: input, key });
      if (!done) throw new KnowledgeRefused(502, 'The knowledge graph didn’t say what it did.');
      return done;
    },
  };
};

/** The delegated caller the gateway sent with a person's call, to carry onward. */
export const delegationOf = (headers: Record<string, string | string[] | undefined>): string | undefined => {
  const v = headers[CALLER_TOKEN_HEADER];
  return Array.isArray(v) ? v[0] : v;
};

/** A store held in memory, shaped as the knowledge graph answers: for tests and `pnpm dev:app`. */
export interface KnowledgeStore {
  entities: KEntity[];
  classes: KClass[];
  predicates: KPredicate[];
  beliefs: KBelief[];
  conflicts: KConflicts;
  sources: Record<string, { id: string; title: string; author: string; on: string; floor: string }>;
}

/** What a store held in memory was asked to do, for tests to read. */
export type Acted = { name: string; input: Record<string, unknown>; key: string }[];

export const memoryKnowledge = (store: KnowledgeStore, acted: Acted = []): Knowledge => {
  const live = (b: KBelief) => b.state !== 'superseded' && !b.supersededAt;
  return {
    entity: async (_floor, id) => store.entities.find((e) => e.id === id),
    beliefs: async (_floor, id) => store.beliefs.filter((b) => b.subject === id),
    around: async (_floor, id) => {
      const edges = store.beliefs.filter((b) => b.kind === 'link' && live(b) && (b.subject === id || b.object === id));
      const ids = new Set(edges.flatMap((b) => [b.subject, b.object!]));
      return { edges, nodes: store.entities.filter((e) => ids.has(e.id)) };
    },
    conflicts: async () => store.conflicts,
    ontology: async () => ({ classes: store.classes, predicates: store.predicates }),
    source: async (_floor, observation) => {
      const s = store.sources[observation];
      return s && { id: s.id, title: s.title, author: s.author, writtenAt: `${s.on}T09:00:00.000Z`, floor: s.floor };
    },
    find: async (_floor, text) => {
      const t = text.toLowerCase();
      return store.entities.filter((e) => [e.label ?? '', ...(e.aliases ?? [])].some((n) => n.toLowerCase().includes(t)));
    },
    act: async (name, input, key) => {
      const again = acted.findIndex((a) => a.key === key);
      if (again < 0) acted.push({ name, input, key });
      const effects: Record<string, string[]> = name === 'dispute' ? { disputes: [`dispute-${key}`], beliefs: [String(input.belief)] } : {};
      return { actionId: `act-${again < 0 ? acted.length : again + 1}`, effects };
    },
  };
};
