import type { DatabasePool } from '@augur/service-kit';

/**
 * What people on a floor go on to open from a kind of thing's page, by the link they followed (Data Atlas
 * PDR-002, use-ranking): Data Atlas's own data, counted per floor, never per person. A link people follow
 * more often rises among what is around a thing of that kind, on that floor.
 *
 * A use is keyed by the link as seen from the page it was followed from: `out <predicate>` for one of the
 * thing's own links, `in <predicate>` for a link that points at it.
 */
export type Way = 'out' | 'in';
export const useKey = (way: Way, predicate: string) => `${way} ${predicate}`;

/** How often things were opened from a kind's pages on a floor, and how often each link led there. */
export interface Used {
  visits: number;
  links: Record<string, number>;
}

export interface Uses {
  /** One thing opened from a page of this kind, by these links (every link between the two). */
  opened(floor: string, kind: string, links: readonly (readonly [Way, string])[]): Promise<void>;
  counts(floor: string, kind: string): Promise<Used>;
}

/** Kept in memory: for tests and `pnpm dev:app`. Gone on a restart. */
export const memoryUses = (): Uses => {
  const kept = new Map<string, Used>();
  const at = (floor: string, kind: string) => `${floor}\u0000${kind}`;
  return {
    opened: async (floor, kind, links) => {
      const row = kept.get(at(floor, kind)) ?? { visits: 0, links: {} };
      row.visits += 1;
      for (const [way, predicate] of links) row.links[useKey(way, predicate)] = (row.links[useKey(way, predicate)] ?? 0) + 1;
      kept.set(at(floor, kind), row);
    },
    counts: async (floor, kind) => {
      const row = kept.get(at(floor, kind));
      return { visits: row?.visits ?? 0, links: { ...row?.links } };
    },
  };
};

/** Kept in the app's own schema (the `uses` table, migrations.ts); a visit is the row with way `visit`. */
export const postgresUses = (db: Pick<DatabasePool, 'query'>): Uses => ({
  opened: async (floor, kind, links) => {
    const rows: [string, string][] = [['visit', ''], ...links.map(([w, p]) => [w, p] as [string, string])];
    await db.query(
      `insert into uses (floor, kind, way, predicate) select $1, $2, w, p from unnest($3::text[], $4::text[]) as t(w, p)
       on conflict (floor, kind, way, predicate) do update set opens = uses.opens + 1, last_at = now()`,
      [floor, kind, rows.map((r) => r[0]), rows.map((r) => r[1])],
    );
  },
  counts: async (floor, kind) => {
    const rows = (await db.query<{ way: string; predicate: string; opens: number }>('select way, predicate, opens from uses where floor = $1 and kind = $2', [floor, kind])).rows;
    return {
      visits: Number(rows.find((r) => r.way === 'visit')?.opens ?? 0),
      links: Object.fromEntries(rows.filter((r) => r.way !== 'visit').map((r) => [useKey(r.way as Way, r.predicate), Number(r.opens)])),
    };
  },
});
