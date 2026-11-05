// Data Atlas's scenarios for AUGUR's run suite (augur-run, im-platform ADR 0050). The suite loads this module
// with `--scenarios ../augur-atlas/run/index.ts`; each scenario has a row in augur-run's traceability.md.
// The suite runs it from source on Node's type stripping, so it imports nothing and uses only syntax Node
// can strip. The types below are the parts of augur-run's `src/scenario.ts` these scenarios use.

type Answer<T> = { status: number; ok: boolean; body: T };
type Api = {
  get: <T = unknown>(path: string, opts?: { floor?: string }) => Promise<Answer<T>>;
};
type Persona = { key: string; name: string };
type CastEntity = { type: string; label: string; aliases?: string[]; floor?: string };
type Context = {
  parts: Record<string, { persona: Persona; api: Api }>;
  cast: { entities?: CastEntity[] };
  check: (label: string, ok: boolean, detail?: { expected?: unknown; actual?: unknown }) => boolean;
  note: (text: string, data?: unknown) => void;
};
type Scenario = {
  id: string;
  title: string;
  owner: string;
  goals: number[];
  cuj?: number;
  given: string;
  when: string;
  then: string;
  cadence: { kind: 'every'; minutes: number; quietMinutes?: number };
  needs: { as: string; role?: string; floors?: 'own' | 'none' }[];
  run: (ctx: Context) => Promise<void>;
};

const ATLAS = '/api/atlas/v1';
const WORKSPACES = '/api/identity/v1/me/workspaces';

type Floor = { id: string; kind: string };
type Entity = { id: string; type: string; label: string };
type UsedBy = { intents: unknown[]; records: unknown[]; documents: unknown[] };

const find = async (api: Api, floor: string, q: string, type: string) => {
  const r = await api.get<{ entities: Entity[] }>(`${ATLAS}/entities?${new URLSearchParams({ q, type })}`, { floor });
  return r.ok ? r.body.entities : undefined;
};

/**
 * Data Atlas shows what points at an entity (alpha Goals 29 and 33a, CUJ 6): every entity the seed puts on
 * the organisation's floor is found by its name and by each other name it goes by, opens, and says what uses
 * it. RUN-19, in Mandate's module, checks that a binding made there shows up here.
 */
export const whatPointsAtIt: Scenario = {
  id: 'RUN-20',
  title: 'The seed’s entities are found by name in Data Atlas, open, and say what uses them',
  owner: 'atlas',
  goals: [29],
  cuj: 6,
  given: 'A person on their own floor, and the entities the seed’s cast puts on the organisation’s floor.',
  when: 'They look each one up in Data Atlas by its name and by its other names, and open it.',
  then: 'Each is found under its kind, opens with its name, and answers what uses it: the intents and records bound to it and the documents what is known of it came from.',
  cadence: { kind: 'every', minutes: 240, quietMinutes: 480 },
  needs: [{ as: 'reader', floors: 'own' }],
  run: async (ctx) => {
    const { api } = ctx.parts.reader!;
    const wanted = (ctx.cast.entities ?? []).filter((e) => !e.floor || e.floor === 'org');
    if (!wanted.length) return ctx.note('The seed’s cast has no entity on the organisation’s floor, so there is nothing to look up. Add one to the cast.');

    const floors = await api.get<{ workspaces: Floor[] }>(WORKSPACES);
    const own = floors.ok ? floors.body.workspaces.find((f) => f.kind === 'personal') : undefined;
    if (!ctx.check('the person has a floor of their own', !!own, { actual: floors.status })) return;

    for (const e of wanted) {
      const hits = await find(api, own!.id, e.label, e.type);
      const entity = hits?.find((h) => h.label === e.label && h.type === e.type);
      if (!ctx.check(`Data Atlas finds “${e.label}” by its name`, !!entity, { actual: hits?.map((h) => h.label) })) continue;

      for (const alias of e.aliases ?? []) {
        const byAlias = await find(api, own!.id, alias, e.type);
        ctx.check(`Data Atlas finds “${e.label}” as “${alias}”`, !!byAlias?.some((h) => h.id === entity!.id), { actual: byAlias?.map((h) => h.label) });
      }

      const path = `${ATLAS}/entities/${encodeURIComponent(entity!.id)}`;
      const opened = await api.get<Entity>(path, { floor: own!.id });
      ctx.check(`“${e.label}” opens`, opened.ok && opened.body.label === e.label, { actual: opened.ok ? opened.body.label : opened.status });

      const used = await api.get<UsedBy>(`${path}/used-by`, { floor: own!.id });
      const shaped = used.ok && Array.isArray(used.body.intents) && Array.isArray(used.body.records) && Array.isArray(used.body.documents);
      ctx.check(`“${e.label}” says what uses it`, shaped, { actual: used.status });
    }
  },
};

export const scenarios = [whatPointsAtIt];
