import type { AppContext, FrameState, Notice, RemoteElement, RemoteNode } from '@augur/mfe-sdk/sdk3';
import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.json';
import start from './entry.js';

// The shell, as the app sees it from its worker: what it draws in each root, what it sets on its pane,
// the commands it handles and what it tells the person. Its `ctx.fetch` ends at `answer`, standing in
// for the gateway and the app's service.
const fakeShell = (answer: (path: string) => Response, path = '/') => {
  const shell = {
    screen: undefined as RemoteNode,
    about: new Map<string, RemoteNode>(),
    pane: {} as FrameState,
    commands: new Map<string, (detail?: unknown) => unknown>(),
    notified: [] as Notice[],
    fetched: [] as string[],
    navigated: [] as string[],
    moved: undefined as ((path: string) => void) | undefined,
  };
  const root = (put: (node: RemoteNode) => void) => ({ render: put, clear: () => put(null) });
  const ctx: AppContext = {
    person: { id: 'p1', name: 'Test Person' },
    workspace: { id: 'ws-me', kind: 'personal', name: 'You' },
    path,
    surface: 'screen',
    onNavigate: (handler) => {
      shell.moved = handler;
      return () => undefined;
    },
    navigate: (to) => void shell.navigated.push(to),
    fetch: async (path) => {
      shell.fetched.push(path);
      return answer(path);
    },
    frame: {
      screen: root((node) => (shell.screen = node)),
      about: (id) => root((node) => shell.about.set(id, node)),
      card: root(() => undefined),
      set: (state) => Object.assign(shell.pane, state),
      under: () => undefined,
      onCommand: (id, handler) => {
        shell.commands.set(id, handler);
        return () => shell.commands.delete(id);
      },
    },
    files: { upload: async () => new Response(null, { status: 501 }), download: async () => undefined, onDrop: () => () => undefined },
    raise: async () => undefined,
    request: async () => Promise.reject(new Error('No app answers that here.')),
    notify: (notice) => void shell.notified.push(notice),
    previewOn: () => false,
    signInAgain: () => undefined,
  };
  return { ctx, shell };
};

const heron = { id: 'mv-saltmarsh-heron', name: 'MV Saltmarsh Heron', kind: { name: 'Ship', icon: 'ship' }, answer: [{ key: 'now', value: 'At Port of Kessick' }], problems: [], facts: [], around: [{ id: 'port-of-kessick', relation: 'At', name: 'Port of Kessick' }], total: 3, reports: 2 };
const service = (path: string) =>
  path.includes('/find?')
    ? Response.json({ query: 'heron', things: [{ id: heron.id, name: heron.name, kind: 'Ship' }] })
    : path.endsWith('/things/mv-saltmarsh-heron') || path.endsWith('/things/port-of-kessick')
      ? Response.json(heron)
      : Response.json({ status: 404, detail: 'Nothing by that name is in sight from this floor.' }, { status: 404 });
// Services answer every error as problem details (RFC 9457): `detail` is the sentence a person reads.
const refusal = (status: number, detail: string) => () =>
  Response.json({ type: 'about:blank', title: 'Forbidden', status, reason: 'forbidden', detail }, { status, headers: { 'content-type': 'application/problem+json' } });

/** Every element in a tree, depth first. */
const elements = (node: RemoteNode): RemoteElement[] =>
  Array.isArray(node) ? node.flatMap(elements) : node && typeof node === 'object' ? [node, ...elements(node.children)] : [];
const text = (node: RemoteNode) => JSON.stringify(node);
const settle = () => new Promise((r) => setTimeout(r, 0));

const find = (node: RemoteNode) => elements(node).find((e) => e.type === 'quill-text-field')!;
const thingPage = (node: RemoteNode) => elements(node).find((e) => e.type === 'quill-thing-page');

describe('the app', () => {
  it('opens on finding a thing, and finds through its own service', async () => {
    const { ctx, shell } = fakeShell(service);
    await start(ctx);
    expect(shell.fetched).toEqual([]);
    expect(shell.pane.title).toBe('Find a thing');
    (find(shell.screen).props!.onCommit as (q: string) => void)(' heron ');
    await settle();
    expect(shell.fetched).toEqual([`/api/${manifest.id}/v1/find?q=heron`]);
    expect(text(shell.screen)).toContain('MV Saltmarsh Heron');
    // It draws only Quill's remote vocabulary, by name.
    expect(elements(shell.screen).every((e) => e.type.startsWith('quill-'))).toBe(true);
  });

  it('opens a thing it found on its own page, in the one shape', async () => {
    const { ctx, shell } = fakeShell(service);
    await start(ctx);
    (find(shell.screen).props!.onCommit as (q: string) => void)('heron');
    await settle();
    const list = elements(shell.screen).find((e) => e.type === 'quill-list')!;
    (list.props!.onOpen as (id: string) => void)(heron.id);
    await settle();
    expect(shell.navigated).toEqual([`/things/${heron.id}`]);
    expect(thingPage(shell.screen)!.props!.view).toEqual(heron);
    expect(shell.pane.title).toBe(heron.name);
    // The host echoing the move doesn't read it twice.
    shell.moved!(`/things/${heron.id}`);
    await settle();
    expect(shell.fetched.filter((p) => p.includes('/things/'))).toHaveLength(1);
  });

  it('starts on a thing’s page when opened at one, and follows what is around it', async () => {
    const { ctx, shell } = fakeShell(service, `/things/${heron.id}`);
    await start(ctx);
    await settle();
    expect(shell.fetched).toEqual([`/api/${manifest.id}/v1/things/${heron.id}`]);
    (thingPage(shell.screen)!.props!.onOpen as (id: string) => void)('port-of-kessick');
    await settle();
    expect(shell.navigated).toEqual(['/things/port-of-kessick']);
    expect(shell.fetched.at(-1)).toBe(`/api/${manifest.id}/v1/things/port-of-kessick`);
    shell.moved!('/');
    expect(find(shell.screen)).toBeDefined();
  });

  it('says why when a thing can’t be shown, with who can change it, and tries again', async () => {
    const { ctx, shell } = fakeShell(refusal(403, 'Data Atlas may not read the knowledge graph here.'), `/things/${heron.id}`);
    await start(ctx);
    await settle();
    expect(text(shell.screen)).toContain('Data Atlas may not read the knowledge graph here.');
    const state = elements(shell.screen).find((e) => e.type === 'quill-state')!;
    (state.props!.onAction as () => void)();
    await settle();
    expect(shell.fetched).toHaveLength(2);
  });

  it('fills each About section its manifest declares', async () => {
    const { ctx, shell } = fakeShell(service);
    await start(ctx);
    expect([...shell.about.keys()]).toEqual(manifest.contributes.about.map((a) => a.id));
    expect(text(shell.about.get(manifest.contributes.about[0]!.id))).toContain(manifest.version);
  });
});
