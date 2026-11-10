import type { QuillRemoteElementName, QuillRemoteEvents, QuillRemoteProperties } from '@augur/app-kit/remote';
import type { AppContext, RemoteElement, RemoteNode } from '@augur/mfe-sdk/sdk3';
import manifest from '../../manifest.json';
import type { Found, ThingView } from '../../service/src/api-types.js';

/**
 * What the app draws: Quill's remote elements by name, with their props (`@augur/app-kit/remote` types
 * them; nothing of the kit is bundled). The shell draws them with the real kit and drops anything else.
 * A prop `on<Event>` hears that event: `onCommit` on a `quill-text-field`, `onOpen` on a `quill-thing-page`.
 */
type Handlers<N extends QuillRemoteElementName> = {
  [E in keyof QuillRemoteEvents[N] & string as `on${Capitalize<E>}`]?: (detail: QuillRemoteEvents[N][E]) => void;
};
export const quill = <N extends QuillRemoteElementName>(type: N, props: QuillRemoteProperties[N] & Handlers<N>, children?: RemoteNode): RemoteElement => ({
  type,
  props,
  ...(children === undefined ? {} : { children }),
});

export const ABOUT = { details: 'details' } as const;

/** Where the gateway sends the app's calls: its own inbound part, at its manifest id. */
export const API = `/api/${manifest.id}/v1`;

/** Where the app is, below `/<id>`: finding a thing, or one thing's page. */
export type Route = { kind: 'find' } | { kind: 'thing'; id: string };
export const routeOf = (path: string): Route => {
  const thing = /^\/things\/([^/]+)\/?$/.exec(path);
  return thing ? { kind: 'thing', id: decodeURIComponent(thing[1]!) } : { kind: 'find' };
};
export const pathOf = (route: Route) => (route.kind === 'thing' ? `/things/${encodeURIComponent(route.id)}` : '/');

/** A call's state: asking, answered, or failed with the sentence to show. */
export type Asked<T> = { kind: 'idle' } | { kind: 'asking' } | { kind: 'answered'; value: T } | { kind: 'failed'; why: string };

/** Finding a thing: one box, then what matches. The home door gallery comes later. */
export const findScreen = (query: string, found: Asked<Found>, on: { find: (q: string) => void; open: (id: string) => void }): RemoteNode => [
  quill('quill-text-field', { label: 'Find a thing', type: 'search', value: query, placeholder: 'A ship, a place, a person, a project', busy: found.kind === 'asking', onCommit: on.find }),
  found.kind === 'idle'
    ? null
    : quill('quill-list', {
        label: 'What matches',
        noun: ['thing', 'things'],
        items: found.kind === 'answered' ? found.value.things.map((t) => ({ id: t.id, title: t.name, detail: t.kind })) : [],
        loading: found.kind === 'asking',
        ...(found.kind === 'failed' ? { error: found.why } : {}),
        empty: `Nothing by the name “${query}” is in sight from this floor.`,
        onOpen: on.open,
        onRetry: () => on.find(query),
      }),
];

/** One thing's page, in the kit's one shape; the rest of what is known and the map come later. */
export const thingScreen = (thing: Asked<ThingView>, on: { open: (id: string) => void; retry: () => void }): RemoteNode =>
  thing.kind === 'answered'
    ? // The service names the kind's icon from Common's set (shape.ts, iconFor); the host draws an unknown one as a dot.
      quill('quill-thing-page', { view: thing.value as QuillRemoteProperties['quill-thing-page']['view'], onOpen: on.open })
    : thing.kind === 'failed'
      ? quill('quill-state', { kind: 'error', heading: 'Data Atlas can’t show this thing', body: thing.why, action: 'Try again', size: 'region', onAction: on.retry })
      : quill('quill-state', { kind: 'loading', heading: 'Reading what is known', size: 'region' });

/** The About panel's Details section: what this is, on which floor. */
export const details = (ctx: AppContext): RemoteNode =>
  quill('quill-details', {
    items: [
      { label: 'Version', value: manifest.version },
      { label: 'Floor', value: ctx.workspace.name },
    ],
  });

/** Why a call failed, from the problem details body every AUGUR service answers with (`detail` is the sentence). */
export const why = async (res: Response): Promise<string> => {
  const problem = (await res.json().catch(() => undefined)) as { detail?: string; message?: string; whoCanChange?: string } | undefined;
  const said = problem?.detail ?? problem?.message ?? `The service answered ${res.status}.`;
  return problem?.whoCanChange ? `${said} ${problem.whoCanChange} can change that.` : said;
};
