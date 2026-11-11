import type { AppContext, FrameState, Notice, RemoteElement, RemoteNode } from '@augur/mfe-sdk/sdk3';
import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.json';
import start from './entry.js';

// The shell, as the app sees it from its worker: what it draws in each root, what it sets on its pane,
// the commands it handles and what it tells the person. Its `ctx.fetch` ends at `answer`, standing in
// for the gateway and the app's service.
const fakeShell = (answer: (path: string, init?: RequestInit) => Response, path = '/') => {
  const shell = {
    screen: undefined as RemoteNode,
    about: new Map<string, RemoteNode>(),
    pane: {} as FrameState,
    commands: new Map<string, (detail?: unknown) => unknown>(),
    notified: [] as Notice[],
    fetched: [] as string[],
    navigated: [] as string[],
    sent: [] as { path: string; init: RequestInit }[],
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
    fetch: async (path, init) => {
      shell.fetched.push(path);
      if (init?.method) shell.sent.push({ path, init });
      return answer(path, init);
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
const everything = {
  id: heron.id,
  name: heron.name,
  sections: [
    { key: 'now', label: 'What is known now', rows: [{ belief: 'b1', label: 'Status', value: 'Delayed', detail: 'Said Wed 18 Nov · 3 reports' }] },
    { key: 'links', label: 'What it is linked to', rows: [{ belief: 'b2', label: 'At', value: 'Port of Kessick', detail: 'Said Thu 19 Nov · one report', opens: 'port-of-kessick' }] },
    { key: 'before', label: 'What was true before', rows: [] },
  ],
};
/** The service, as the gateway answers for it: with what the person follows kept between calls. */
const fakeService = () => {
  const followed = new Set<string>();
  return (path: string, init?: RequestInit) => {
    const follow = /\/follows\/([^/?]+)$/.exec(path);
    if (follow) {
      if (init?.method === 'PUT') followed.add(follow[1]!);
      if (init?.method === 'DELETE') followed.delete(follow[1]!);
      return Response.json({ thing: follow[1], following: followed.has(follow[1]!) });
    }
    if (path.endsWith('/home'))
      return Response.json({
        doors: [
          { id: 'changed', name: 'See what has changed', line: 'On what you keep an eye on', icon: 'history', reads: ['change'], order: 1 },
          { id: 'keep-an-eye', name: 'Keep an eye on something', line: 'Hear when it changes', icon: 'star', reads: ['coming'], order: 2 },
        ],
        signals: [{ kind: 'change', reason: 'MV Saltmarsh Heron: 2 new lines', about: heron.id }],
        firstDay: followed.size === 0,
        following: [...followed].map((id) => ({ id, label: id === heron.id ? heron.name : id })),
      });
    if (path.endsWith('/doors/changed')) return Response.json({ door: 'changed', heading: 'What has changed', items: [{ id: heron.id, title: heron.name, detail: '2 new lines' }], empty: 'Nothing has changed.' });
    if (path.includes('/find?')) return Response.json({ query: 'heron', things: [{ id: heron.id, name: heron.name, kind: 'Ship' }] });
    if (path.endsWith('/everything')) return Response.json(everything);
    if (path.endsWith('/wrong')) return Response.json({ lines: [{ belief: 'b1', line: 'Status: Delayed' }, { belief: 'b2', line: 'At: Port of Kessick' }] });
    if (path.endsWith('/disputes')) return Response.json({ dispute: 'd1' });
    if (path.endsWith('/things/mv-saltmarsh-heron') || path.endsWith('/things/port-of-kessick')) return Response.json(heron);
    return Response.json({ status: 404, detail: 'Nothing by that name is in sight from this floor.' }, { status: 404 });
  };
};
const service = fakeService();
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

const gallery = (node: RemoteNode) => elements(node).find((e) => e.type === 'quill-door-gallery');

describe('home: the door gallery', () => {
  it('opens on the doors, with the signals the shell lights them from', async () => {
    const { ctx, shell } = fakeShell(fakeService());
    await start(ctx);
    await settle();
    expect(shell.fetched).toEqual([`/api/${manifest.id}/v1/home`]);
    const doors = gallery(shell.screen)!;
    expect(doors.props!.doors).toHaveLength(2);
    expect(doors.props!.signals).toEqual([{ kind: 'change', reason: 'MV Saltmarsh Heron: 2 new lines', about: heron.id }]);
    expect(doors.props!.firstDay).toBe(true);
    expect(doors.props!.loading).toBe(false);
  });

  it('asks on its line to find, opens a door, and opens a thing behind it', async () => {
    const { ctx, shell } = fakeShell(fakeService());
    await start(ctx);
    await settle();
    (gallery(shell.screen)!.props!.onAsk as (q: string) => void)('heron');
    await settle();
    expect(shell.navigated).toEqual(['/find']);
    expect(shell.fetched).toContain(`/api/${manifest.id}/v1/find?q=heron`);
    expect(text(shell.screen)).toContain('MV Saltmarsh Heron');

    shell.moved!('/');
    await settle();
    (gallery(shell.screen)!.props!.onOpen as (id: string) => void)('changed');
    await settle();
    expect(shell.navigated.at(-1)).toBe('/doors/changed');
    expect(shell.pane.title).toBe('What has changed');
    const list = elements(shell.screen).find((e) => e.type === 'quill-list')!;
    (list.props!.onOpen as (id: string) => void)(heron.id);
    await settle();
    expect(shell.navigated.at(-1)).toBe(`/things/${heron.id}`);
  });

  it('shows what the person keeps an eye on under the ask line, and opens it', async () => {
    const answer = fakeService();
    await answer(`/api/${manifest.id}/v1/follows/${heron.id}`, { method: 'PUT' });
    const { ctx, shell } = fakeShell(answer);
    await start(ctx);
    await settle();
    const doors = gallery(shell.screen)!;
    expect(doors.props!.firstDay).toBe(false);
    expect((doors.props!.ask as { recents: unknown[] }).recents).toEqual([{ id: heron.id, label: heron.name }]);
    (doors.props!.onRecent as (id: string) => void)(heron.id);
    await settle();
    expect(shell.navigated.at(-1)).toBe(`/things/${heron.id}`);
  });

  it('says why when the ways in can’t be read', async () => {
    const { ctx, shell } = fakeShell(refusal(502, 'The knowledge graph did not answer.'));
    await start(ctx);
    await settle();
    const state = elements(shell.screen).find((e) => e.type === 'quill-state')!;
    expect(state.props).toMatchObject({ kind: 'error', body: 'The knowledge graph did not answer.' });
  });
});

describe('the app', () => {
  it('finds a thing through its own service', async () => {
    const { ctx, shell } = fakeShell(service, '/find');
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
    const { ctx, shell } = fakeShell(service, '/find');
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
    expect(shell.fetched).toEqual([`/api/${manifest.id}/v1/things/${heron.id}`, `/api/${manifest.id}/v1/follows/${heron.id}`]);
    (thingPage(shell.screen)!.props!.onOpen as (id: string) => void)('port-of-kessick');
    await settle();
    expect(shell.navigated).toEqual(['/things/port-of-kessick']);
    expect(shell.fetched).toContain(`/api/${manifest.id}/v1/things/port-of-kessick`);
    shell.moved!('/find');
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
    expect(shell.fetched.filter((p) => p.endsWith(`/things/${heron.id}`))).toHaveLength(2);
  });

  const onThing = async () => {
    const { ctx, shell } = fakeShell(fakeService(), `/things/${heron.id}`);
    await start(ctx);
    await settle();
    const press = async (action: string) => {
      (thingPage(shell.screen)!.props!.onAction as (id: string) => void)(action);
      await settle();
    };
    const dialog = () => elements(shell.screen).find((e) => e.type === 'quill-dialog');
    return { shell, press, dialog };
  };

  it('keeps an eye on a thing, says so on its page, and stops', async () => {
    const { shell, press } = await onThing();
    expect(elements(shell.screen).some((e) => e.type === 'quill-notice')).toBe(false);
    await press('follow');
    expect(shell.sent.map((s) => `${s.init.method} ${s.path}`)).toEqual([`PUT /api/${manifest.id}/v1/follows/${heron.id}`]);
    const notice = elements(shell.screen).find((e) => e.type === 'quill-notice')!;
    expect(text(notice)).toContain('You keep an eye on this');
    (notice.props!.onAction as () => void)();
    await settle();
    expect(shell.sent.at(-1)!.init.method).toBe('DELETE');
    expect(elements(shell.screen).some((e) => e.type === 'quill-notice')).toBe(false);
  });

  it('says something is wrong with one line, once, with a reason', async () => {
    const { shell, press, dialog } = await onThing();
    await press('wrong');
    const choice = elements(dialog()).find((e) => e.type === 'quill-choice')!;
    expect(choice.props!.slot).toBe('fields');
    expect((choice.props!.options as { label: string }[]).map((o) => o.label)).toEqual(['Status: Delayed', 'At: Port of Kessick']);
    // Nothing goes without a reason.
    (dialog()!.props!.onSubmit as (v: Record<string, unknown>) => void)({ belief: 'b1', reason: '  ' });
    await settle();
    expect(dialog()!.props!.error).toBeTruthy();
    expect(shell.sent).toEqual([]);
    (dialog()!.props!.onSubmit as (v: Record<string, unknown>) => void)({ belief: 'b1', reason: 'She left on Monday.' });
    await settle();
    const sent = shell.sent.find((s) => s.path.endsWith('/disputes'))!;
    expect(JSON.parse(String(sent.init.body))).toEqual({ belief: 'b1', reason: 'She left on Monday.' });
    expect((sent.init.headers as Record<string, string>)['idempotency-key']).toMatch(/.{8,}/);
    expect(dialog()).toBeUndefined();
    expect(shell.notified.at(-1)!.title).toMatch(/settle/);
  });

  it('says why asking and sending aren’t here yet, instead of hiding them', async () => {
    const { shell, press, dialog } = await onThing();
    await press('ask');
    expect(text(dialog())).toMatch(/isn’t here yet/);
    expect(text(dialog())).toMatch(/later AUGUR release/);
    (dialog()!.props!.onClose as () => void)();
    expect(dialog()).toBeUndefined();
    await press('send');
    expect(dialog()!.props!.heading).toBe('Sending it isn’t here yet');
    expect(shell.sent).toEqual([]);
  });

  it('opens everything known one step from the page, and comes back', async () => {
    const { shell } = await onThing();
    (thingPage(shell.screen)!.props!.onEverything as () => void)();
    await settle();
    expect(shell.navigated.at(-1)).toBe(`/things/${heron.id}/all`);
    expect(shell.fetched).toContain(`/api/${manifest.id}/v1/things/${heron.id}/everything`);
    const lists = elements(shell.screen).filter((e) => e.type === 'quill-list');
    expect(lists).toHaveLength(3);
    expect(lists[2]!.props!.empty).toMatch(/changed/);
    // A link opens the thing it reaches; the trail goes back to the page.
    (lists[1]!.props!.onOpen as (id: string) => void)('b2');
    await settle();
    expect(shell.navigated.at(-1)).toBe('/things/port-of-kessick');
    shell.moved!(`/things/${heron.id}/all`);
    await settle();
    const head = elements(shell.screen).find((e) => e.type === 'quill-page-head')!;
    (head.props!.onTrail as (id: string) => void)('thing');
    await settle();
    expect(shell.navigated.at(-1)).toBe(`/things/${heron.id}`);
  });

  it('fills each About section its manifest declares', async () => {
    const { ctx, shell } = fakeShell(service);
    await start(ctx);
    expect([...shell.about.keys()]).toEqual(manifest.contributes.about.map((a) => a.id));
    expect(text(shell.about.get(manifest.contributes.about[0]!.id))).toContain(manifest.version);
  });
});
