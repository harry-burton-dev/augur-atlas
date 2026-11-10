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
];
