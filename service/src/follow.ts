import { bindingTopics, readBinding, type BindingApp, type DomainEvent } from '@augur/service-kit';
import type { PgAtlasStore } from './store.ts';

/**
 * What Data Atlas follows of other apps (spec, "Shared entity reference", AT8; ADR 0066):
 *
 * - every app's entity bindings, for each entity's "used by". Which apps bind what comes from the
 *   registry (manifest `links.entities` and `bindings`, SDK 2.1), so an app added later is followed
 *   without a change here;
 * - Artifacts' withdrawals, which retract what was read from a document.
 *
 * Theirs stays the truth: this only keeps an index and marks evidence, and never deletes an entity.
 */
export const RETRACTIONS = ['folio.document.withdrawn', 'folio.document.deleted'];

/** The app that withdraws documents, whose withdrawals retract what was read from them. */
const DOCUMENTS_APP = 'folio';

const text = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

type Followed = Pick<DomainEvent, 'topic' | 'payload' | 'workspace'>;

/** One stream of binding events Data Atlas reads with its own cursor: one app's bindings of one type. */
export interface BindingStream {
  /** Its cursor's name: `<app>.<type>`, or `<app>.*` for an app that names no types. */
  key: string;
  topics: string[];
}

/** The streams to read for the apps the registry lists. A type added later gets its own stream, read from the start. */
export const bindingStreams = (apps: BindingApp[]): BindingStream[] =>
  apps.flatMap(({ app, types }) =>
    types.length
      ? types.map((type) => {
          const { bound, unbound } = bindingTopics(app, type);
          return { key: `${app}.${type}`, topics: [bound, unbound] };
        })
      : [{ key: `${app}.*`, topics: [`${app}.*`] }],
  );

/**
 * Handles one binding event, from any app. A thing is kept by the kind its app names in the payload's
 * `level` (as Artifacts names a library, folder or document) or else by its type. Safe to run twice:
 * the same event may come again after a failure.
 */
export const bindings = (store: PgAtlasStore) => async (event: Followed) => {
  const b = readBinding(event);
  if (!b) return;
  const kind = b.more?.level ?? b.type;
  if (b.change === 'bound') await store.bind({ app: b.app, kind, id: b.id, entity: b.entity, role: b.role ?? 'related', workspace: b.workspace ?? event.workspace?.id ?? '' });
  else await store.unbind({ app: b.app, kind, id: b.id, entity: b.entity, ...(b.role ? { role: b.role } : {}) });
};

/** Handles a withdrawal or deletion in Artifacts. Safe to run twice. */
export const retractions = (store: PgAtlasStore) => async (event: Followed) => {
  if (!RETRACTIONS.includes(event.topic)) return;
  const document = text(((event.payload ?? {}) as Record<string, unknown>).document);
  if (!document) return;
  const why = event.topic.endsWith('withdrawn') ? 'Its source was withdrawn in Artifacts.' : 'Its source was deleted from Artifacts.';
  await store.retractDocument(DOCUMENTS_APP, document, why);
};

/** Handles any event Data Atlas follows: a binding or a retraction. */
export const follower = (store: PgAtlasStore) => {
  const bound = bindings(store);
  const retracted = retractions(store);
  return async (event: Followed) => (RETRACTIONS.includes(event.topic) ? retracted(event) : bound(event));
};

export interface FollowBindingsOptions {
  /** Which apps bind what: the service kit's registryBindingApps. */
  apps: () => Promise<BindingApp[]>;
  /** Starts reading one stream; returns how to stop it. */
  follow: (stream: BindingStream) => { stop(): void };
  /** How often to ask again which apps bind what. */
  everyMs?: number;
  onError?: (err: unknown) => void;
}

/**
 * Keeps one follower per binding stream, in step with the registry: asks which apps bind what now and
 * every `everyMs`, starts a stream for each new app or type and stops those no longer listed. While the
 * registry can't be reached, what was followed goes on being followed.
 */
export const followBindings = ({ apps, follow, everyMs = 300_000, onError }: FollowBindingsOptions) => {
  const running = new Map<string, { topics: string; stop(): void }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const refresh = async () => {
    const streams = bindingStreams(await apps());
    const wanted = new Set(streams.map((s) => s.key));
    for (const [key, r] of running)
      if (!wanted.has(key)) {
        r.stop();
        running.delete(key);
      }
    for (const s of streams) {
      const topics = s.topics.join(',');
      const was = running.get(s.key);
      if (was?.topics === topics) continue;
      was?.stop();
      running.set(s.key, { topics, ...follow(s) });
    }
    return [...running.keys()];
  };

  const tick = async () => {
    try {
      await refresh();
    } catch (err) {
      onError?.(err);
    }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };

  return {
    refresh,
    /** The streams being read now, by key. */
    following: () => [...running.keys()],
    start() {
      stopped = false;
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const r of running.values()) r.stop();
      running.clear();
    },
  };
};
