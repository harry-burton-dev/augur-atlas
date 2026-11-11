import type { Migration } from '@augur/service-kit';

/**
 * The app's schema, in order. The `migrate` part (score/migrate.score.yaml) runs them before each
 * install switches over, and a failing one leaves the old version serving. Once one has shipped it
 * never changes: add the next one instead, written so the version before still works with it.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: '001_kept_events',
    sql: `create table kept_events (
      key text primary key,
      seq text not null,
      topic text not null,
      event jsonb not null,
      kept_at timestamptz not null default now()
    )`,
  },
  {
    // What each person keeps an eye on, on each floor (follows.ts). Data Atlas's own: the graph keeps none of it.
    id: '002_follows',
    sql: `create table follows (
      person text not null,
      floor text not null,
      thing text not null,
      since timestamptz not null default now(),
      primary key (person, floor, thing)
    )`,
  },
  {
    // How often people on a floor open things from a kind of thing's page, and by which links (uses.ts): counts, never who.
    id: '003_uses',
    sql: `create table uses (
      floor text not null,
      kind text not null,
      way text not null check (way in ('out', 'in', 'visit')),
      predicate text not null,
      opens integer not null default 1,
      last_at timestamptz not null default now(),
      primary key (floor, kind, way, predicate)
    )`,
  },
];
