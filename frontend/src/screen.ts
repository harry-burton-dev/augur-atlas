import type { QuillRemoteElementName, QuillRemoteEvents, QuillRemoteProperties } from '@augur/app-kit/remote';
import type { AppContext, RemoteElement, RemoteNode } from '@augur/mfe-sdk/sdk3';
import manifest from '../../manifest.json';
import type { DoorList, Everything, Found, Home, ThingView, WrongChoices } from '../../service/src/api-types.js';

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

/** Where the app is, below `/<id>`: home, finding a thing, what is behind a door, one thing's page, or everything known of it. */
export type Route = { kind: 'home' } | { kind: 'find' } | { kind: 'door'; id: string } | { kind: 'thing'; id: string } | { kind: 'all'; id: string };
export const routeOf = (path: string): Route => {
  if (/^\/find\/?$/.test(path)) return { kind: 'find' };
  const door = /^\/doors\/([^/]+)\/?$/.exec(path);
  if (door) return { kind: 'door', id: decodeURIComponent(door[1]!) };
  const at = /^\/things\/([^/]+)(\/all)?\/?$/.exec(path);
  if (!at) return { kind: 'home' };
  const id = decodeURIComponent(at[1]!);
  return at[2] ? { kind: 'all', id } : { kind: 'thing', id };
};
export const pathOf = (route: Route) =>
  route.kind === 'home'
    ? '/'
    : route.kind === 'find'
      ? '/find'
      : route.kind === 'door'
        ? `/doors/${encodeURIComponent(route.id)}`
        : `/things/${encodeURIComponent(route.id)}${route.kind === 'all' ? '/all' : ''}`;

/** A call's state: asking, answered, or failed with the sentence to show. */
export type Asked<T> = { kind: 'idle' } | { kind: 'asking' } | { kind: 'answered'; value: T } | { kind: 'failed'; why: string };

/**
 * Home: the door gallery. The ask line on top finds a thing; the doors are the service's configuration
 * (service/src/home.ts), and the shell lights each from the signals the service read, so a door is added there.
 */
export const homeScreen = (home: Asked<Home>, on: { find: (q: string) => void; open: (id: string) => void; door: (id: string) => void; retry: () => void }): RemoteNode =>
  home.kind === 'failed'
    ? quill('quill-state', { kind: 'error', heading: 'Data Atlas can’t show its ways in', body: home.why, action: 'Try again', size: 'region', onAction: on.retry })
    : quill('quill-door-gallery', {
        label: 'Ways in',
        doors: home.kind === 'answered' ? (home.value.doors as QuillRemoteProperties['quill-door-gallery']['doors']) : [],
        signals: home.kind === 'answered' ? home.value.signals : [],
        loading: home.kind !== 'answered',
        firstDay: home.kind === 'answered' && home.value.firstDay,
        ask: {
          label: 'What do you need?',
          placeholder: 'A ship, a place, a person, a project',
          go: 'Find',
          recentsLabel: 'You keep an eye on',
          recents: home.kind === 'answered' ? home.value.following.slice(0, 5) : [],
        },
        onOpen: on.door,
        onAsk: on.find,
        onRecent: on.open,
      });

/** What is behind one door: a plain list of things, each opening its page. */
export const doorScreen = (list: Asked<DoorList>, on: { home: () => void; open: (id: string) => void; retry: () => void }): RemoteNode =>
  list.kind === 'answered'
    ? quill(
        'quill-page-head',
        { eyebrow: 'Ways in', heading: list.value.heading, trail: [{ id: 'home', label: 'Ways in' }], onTrail: on.home },
        quill('quill-list', { label: list.value.heading, noun: ['thing', 'things'], items: list.value.items, empty: list.value.empty, onOpen: on.open }),
      )
    : list.kind === 'failed'
      ? quill('quill-state', { kind: 'error', heading: 'Data Atlas can’t show what is behind this door', body: list.why, action: 'Try again', size: 'region', onAction: on.retry })
      : quill('quill-state', { kind: 'loading', heading: 'Looking behind the door', size: 'region' });

/** Finding a thing: one box, then what matches. */
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

/** The actions the page offers that AUGUR can't carry yet: each says why and what would change it. */
export const UNAVAILABLE = {
  ask: {
    heading: 'Asking about it isn’t here yet',
    summary: 'Data Atlas can’t put a question to the people who know about this thing: AUGUR doesn’t carry messages between people yet. It comes with a later AUGUR release, and nothing on this floor turns it on sooner.',
  },
  send: {
    heading: 'Sending it isn’t here yet',
    summary: 'Data Atlas can’t send this page to someone: AUGUR doesn’t carry messages between people yet. It comes with a later AUGUR release, and nothing on this floor turns it on sooner.',
  },
} as const;
export type Unavailable = keyof typeof UNAVAILABLE;

/** What is open over the page: nothing, the "Something's wrong" dialog, or an action that isn't here yet. */
export type Over =
  | { kind: 'none' }
  | { kind: 'wrong'; choices: Asked<WrongChoices>; key: string; busy?: boolean; error?: string }
  | { kind: 'unavailable'; action: Unavailable };

const field = (el: RemoteElement): RemoteElement => ({ ...el, props: { ...el.props, slot: 'fields' } });

/** "Something's wrong": pick the line, say what is wrong with it. It goes to the floor's settler. */
const wrongDialog = (over: Extract<Over, { kind: 'wrong' }>, on: { submit: (values: Record<string, unknown>) => void; close: () => void }): RemoteNode => {
  const lines = over.choices.kind === 'answered' ? over.choices.value.lines : [];
  return quill(
    'quill-dialog',
    {
      open: true,
      heading: 'Something’s wrong',
      summary: 'Say which line is wrong and what is wrong with it. The people who settle this floor’s reports look at it, and the line shows it is disputed until they do.',
      size: 'decision',
      actionLabel: 'Send it',
      busyLabel: 'Sending',
      busy: over.busy || over.choices.kind === 'asking',
      ...(over.error || over.choices.kind === 'failed' ? { error: over.error ?? (over.choices as { why: string }).why } : {}),
      onSubmit: on.submit,
      onClose: on.close,
    },
    lines.length
      ? [
          field(quill('quill-choice', { label: 'Which line', name: 'belief', required: true, value: lines[0]!.belief, options: lines.map((l) => ({ value: l.belief, label: l.line })) })),
          field(quill('quill-text-field', { label: 'What is wrong with it', name: 'reason', required: true, multiline: true, rows: 3, maxLength: 500 })),
        ]
      : null,
  );
};

const unavailableDialog = (action: Unavailable, close: () => void): RemoteNode =>
  quill('quill-dialog', { open: true, ...UNAVAILABLE[action], size: 'glance', actionLabel: 'Close', onSubmit: close, onClose: close });

/** One thing's page, in the kit's one shape, with whether the person keeps an eye on it and anything open over it. */
export const thingScreen = (
  thing: Asked<ThingView>,
  state: { following: boolean; over: Over },
  on: { open: (id: string) => void; retry: () => void; act: (id: string) => void; everything: () => void; unfollow: () => void; submitWrong: (values: Record<string, unknown>) => void; closeOver: () => void },
): RemoteNode =>
  thing.kind === 'answered'
    ? [
        state.following ? quill('quill-notice', { tone: 'info', action: 'Stop', onAction: on.unfollow }, 'You keep an eye on this. It will be on your home page when it changes.') : null,
        // The service names the kind's icon from Common's set (shape.ts, iconFor); the host draws an unknown one as a dot.
        quill('quill-thing-page', { view: thing.value as QuillRemoteProperties['quill-thing-page']['view'], onOpen: on.open, onAction: on.act, onEverything: on.everything }),
        state.over.kind === 'wrong' ? wrongDialog(state.over, { submit: on.submitWrong, close: on.closeOver }) : null,
        state.over.kind === 'unavailable' ? unavailableDialog(state.over.action, on.closeOver) : null,
      ]
    : thing.kind === 'failed'
      ? quill('quill-state', { kind: 'error', heading: 'Data Atlas can’t show this thing', body: thing.why, action: 'Try again', size: 'region', onAction: on.retry })
      : quill('quill-state', { kind: 'loading', heading: 'Reading what is known', size: 'region' });

const EMPTY: Record<Everything['sections'][number]['key'], string> = {
  now: 'Nothing is known of it now, from this floor.',
  links: 'It isn’t linked to anything in sight.',
  before: 'Nothing known of it has changed.',
};

/** Everything known of a thing, one step from its page: plain sections, each line with when and on how many reports. */
export const everythingScreen = (all: Asked<Everything>, on: { back: () => void; open: (id: string) => void; retry: () => void }): RemoteNode =>
  all.kind === 'answered'
    ? quill(
        'quill-page-head',
        { eyebrow: 'Everything we know', heading: all.value.name, trail: [{ id: 'thing', label: all.value.name }], onTrail: on.back },
        all.value.sections.map((s) =>
          quill(
            'quill-section',
            { label: s.label, count: s.rows.length },
            quill('quill-list', {
              label: s.label,
              noun: ['line', 'lines'],
              density: 'compact',
              look: 'plain',
              empty: EMPTY[s.key],
              items: s.rows.map((r) => ({ id: r.belief, title: `${r.label}: ${r.value}`, detail: r.detail })),
              onOpen: (belief: string) => {
                const opens = s.rows.find((r) => r.belief === belief)?.opens;
                if (opens) on.open(opens);
              },
            }),
          ),
        ),
      )
    : all.kind === 'failed'
      ? quill('quill-state', { kind: 'error', heading: 'Data Atlas can’t show what is known', body: all.why, action: 'Try again', size: 'region', onAction: on.retry })
      : quill('quill-state', { kind: 'loading', heading: 'Reading everything known', size: 'region' });

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
