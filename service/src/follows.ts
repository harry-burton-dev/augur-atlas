import type { DatabasePool } from '@augur/service-kit';

/**
 * What a person keeps an eye on: Data Atlas's own data (Data Atlas PDR-002), never the knowledge graph's.
 * One row per person, floor and thing, so the same thing can be followed from a team floor and from one's own.
 */
export interface Followed {
  thing: string;
  /** An ISO time. */
  since: string;
}

export interface Follows {
  has(person: string, floor: string, thing: string): Promise<boolean>;
  follow(person: string, floor: string, thing: string): Promise<void>;
  unfollow(person: string, floor: string, thing: string): Promise<void>;
  /** Newest first, each with when the person started keeping an eye on it. */
  list(person: string, floor: string): Promise<Followed[]>;
}

/** Kept in memory: for tests and `pnpm dev:app`. Gone on a restart. */
export const memoryFollows = (now: () => Date = () => new Date()): Follows => {
  const kept = new Map<string, Followed[]>();
  const at = (person: string, floor: string) => `${person}\u0000${floor}`;
  const of = (person: string, floor: string) => kept.get(at(person, floor)) ?? [];
  return {
    has: async (person, floor, thing) => of(person, floor).some((f) => f.thing === thing),
    follow: async (person, floor, thing) => void kept.set(at(person, floor), [{ thing, since: now().toISOString() }, ...of(person, floor).filter((f) => f.thing !== thing)]),
    unfollow: async (person, floor, thing) => void kept.set(at(person, floor), of(person, floor).filter((f) => f.thing !== thing)),
    list: async (person, floor) => of(person, floor),
  };
};

/** Kept in the app's own schema (the `follows` table, migrations.ts). */
export const postgresFollows = (db: Pick<DatabasePool, 'query'>): Follows => ({
  has: async (person, floor, thing) => ((await db.query('select 1 from follows where person = $1 and floor = $2 and thing = $3', [person, floor, thing])).rowCount ?? 0) > 0,
  follow: async (person, floor, thing) => {
    await db.query('insert into follows (person, floor, thing) values ($1, $2, $3) on conflict (person, floor, thing) do update set since = now()', [person, floor, thing]);
  },
  unfollow: async (person, floor, thing) => {
    await db.query('delete from follows where person = $1 and floor = $2 and thing = $3', [person, floor, thing]);
  },
  list: async (person, floor) =>
    (await db.query<{ thing: string; since: Date | string }>('select thing, since from follows where person = $1 and floor = $2 order by since desc', [person, floor])).rows.map((r) => ({ thing: r.thing, since: new Date(r.since).toISOString() })),
});
