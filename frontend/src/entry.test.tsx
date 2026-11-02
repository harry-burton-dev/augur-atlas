// @vitest-environment happy-dom
import { createEventBus, type MountContext, type Workspace } from '@augur/mfe-sdk';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiDirectedGraph } from 'graphology';
import { entityLine, placeFor, pathFor, typeTree, whyShown, type Entity, type Ontology, type ProposalView, type Subgraph } from './api.js';
import { kindsOffered } from './picker.js';
import { foldsOf, hiddenNear, rings, syncGraph, widen } from './graph.js';
import app, { addressFor, placeForIntent, proposalOffer } from './entry.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const floor: Workspace = { id: 't-mar', kind: 'team', name: 'Maritime desk', slug: 'maritime', path: [], role: 'member' };

const ONTOLOGY: Ontology = {
  version: 1,
  types: [
    { key: 'artifact', label: 'Artifact', plural: 'Artifacts', abstract: true, icon: 'apps', pack: 'cco', packTerm: 'Artifact', details: [] },
    { key: 'vehicle', label: 'Vehicle', plural: 'Vehicles', parent: 'artifact', abstract: true, icon: 'vehicle', pack: 'cco', packTerm: 'Vehicle', details: [] },
    {
      key: 'vessel',
      label: 'Vessel',
      plural: 'Vessels',
      parent: 'vehicle',
      abstract: false,
      icon: 'vessel',
      pack: 'cco',
      packTerm: 'Watercraft',
      details: [
        { key: 'imo', label: 'IMO number', kind: 'text', identity: true, pattern: '\\d{7}' },
        { key: 'flag', label: 'Flag state', kind: 'text', identity: false, onEntity: false },
      ],
    },
  ],
  relations: [{ key: 'operated-by', label: 'Operated by', inverse: 'Operates', from: ['artifact'], to: ['agent'], pack: 'augur', packTerm: 'operated by' }],
};

const TERN: Entity = {
  id: 'ent_01',
  type: 'vessel',
  label: 'Northern Tern',
  aliases: ['N. Tern'],
  description: '',
  details: { imo: '9400117' },
  workspace: 't-mar',
  floor: 'tree:t-mar',
  floorName: 'Maritime desk',
  state: 'active',
  createdBy: 'u1',
  createdAt: '2026-10-27T00:00:00Z',
  updatedBy: 'u1',
  updatedAt: '2026-10-27T00:00:00Z',
  can: { edit: false, retire: false, why: 'It’s kept on the org floor: go there to change it.' },
};

const KNOWN = {
  at: null,
  known: null,
  here: { floorName: 'Maritime desk', accept: false, why: 'Only this floor’s leads accept what’s so here, and raise what’s seen to a floor above.' },
  facts: [
    {
      id: 'fct_1', entity: 'ent_01', property: 'flag', value: 'Liberia', direction: 'out', validFrom: '2026-09-01T00:00:00.000Z', floor: 'tree:t-ops', floorName: 'Operations',
      backedBy: ['obs_1'], note: '', recordedAt: '2026-10-27T00:00:00Z',
      disputes: [{ id: 'dsp_1', fact: 'fct_1', floorName: 'Maritime desk', note: 'AIS says otherwise.', by: 'u2', at: '2026-10-27T00:00:00Z', mine: false }],
      can: { end: false, withdraw: false, dispute: true, why: 'It’s kept on Operations: its leads end or withdraw it there. You can dispute it from here.' },
    },
    {
      id: 'fct_2', entity: 'ent_01', property: 'operated-by', target: 'ent_09', direction: 'out', other: { id: 'ent_09', hidden: true, reason: 'kept', floor: 'tree:t-fin', message: 'It’s kept on the Finance floor. Ask one of its leads if you need it.' },
      floor: 'tree:t-mar', floorName: 'Maritime desk', backedBy: ['obs_2'], note: '', recordedAt: '2026-10-27T00:00:00Z', disputes: [], can: { end: false, withdraw: false, dispute: true },
    },
  ],
  observations: [
    {
      id: 'obs_1', entity: 'ent_01', property: 'flag', value: 'Liberia', direction: 'out', observedAt: '2026-09-01T00:00:00.000Z', floor: 'tree:t-mar', floorName: 'Maritime desk',
      source: { kind: 'document', document: { app: 'folio', id: 'd-1', title: 'Port report' } }, grade: 'B2', note: '', raisedTo: ['Operations'], createdBy: 'u1', createdAt: '2026-10-27T00:00:00Z',
      can: { accept: false, raise: false, raiseTo: [], why: 'Only this floor’s leads accept what’s so here, and raise what’s seen to a floor above.' },
    },
  ],
};

const ctx = (fetch: MountContext['fetch'], path = '/', more: Partial<MountContext> = {}): MountContext => ({
  user: { id: 'u1', name: 'Sam Okafor', departments: [], roles: [] },
  getToken: async () => 't',
  bus: createEventBus(),
  raise: vi.fn(),
  request: vi.fn(),
  notify: vi.fn(),
  path,
  workspace: floor,
  getWorkspace: () => floor,
  previewOn: () => false,
  fetch,
  ...more,
});

const answering = (routes: Record<string, () => Response>) =>
  vi.fn(async (path: string) => {
    const route = Object.keys(routes).find((r) => path.startsWith(r));
    return route ? routes[route]() : new Response(null, { status: 404 });
  });

/** Lets the service's answers land and React draw them. */
const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
};
const mounted = async (c: MountContext) => {
  const el = document.body.appendChild(document.createElement('div'));
  await act(async () => void (await app.mount(el, c)));
  await settle();
  return el;
};
const press = async (b: Element | null | undefined) => {
  await act(async () => (b as HTMLElement).click());
  await settle();
};
/** A button by its words, anywhere on the page: dialogs draw outside the app. */
const button = (words: string, inside: ParentNode = document) => [...inside.querySelectorAll('button')].find((b) => b.textContent?.trim() === words);
/** The sentence a control that can't be used gives for it. */
const reasonOf = (b: Element | undefined) => document.getElementById(b?.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
const shut = (b: Element | undefined) => b?.getAttribute('aria-disabled') === 'true' || (b as HTMLButtonElement | undefined)?.disabled === true;
/** A list's rows, as title and detail. */
const rowsOf = (list: Element | null) =>
  [...(list?.querySelectorAll('.quill-list-row') ?? [])].map((r) => ({ title: r.querySelector('.quill-list-text b')?.textContent, detail: r.querySelector('.quill-list-text span')?.textContent, disabled: r.hasAttribute('data-disabled-row') }));
const pageTitle = (el: Element) => el.querySelector('.quill-page-head-title')?.textContent;

let mounts: HTMLElement[] = [];
afterEach(async () => {
  for (const el of mounts) await act(async () => void (await app.unmount?.(el)));
  mounts = [];
  document.body.innerHTML = '';
});
const open = async (c: MountContext) => {
  const el = await mounted(c);
  mounts.push(el);
  return el;
};

describe('places', () => {
  it('reads and writes its own addresses', () => {
    expect(placeFor('/')).toEqual({ page: 'entities' });
    expect(placeFor('/entities/new')).toEqual({ page: 'new' });
    expect(placeFor('/entities/ent_01')).toEqual({ page: 'entity', id: 'ent_01' });
    expect(placeFor('/explore/ent_01')).toEqual({ page: 'explore', id: 'ent_01' });
    expect(pathFor({ page: 'explore', id: 'ent_01' })).toBe('/explore/ent_01');
    expect(pathFor({ page: 'entity', id: 'ent_01' })).toBe('/entities/ent_01');
    expect(addressFor('/@maritime/atlas/entities', '/entities', { page: 'entity', id: 'ent_01' })).toBe('/@maritime/atlas/entities/ent_01');
  });

  it('lays kinds out as a tree and says what an entity is in a line', () => {
    expect(typeTree(ONTOLOGY).map((t) => [t.type.key, t.depth])).toEqual([
      ['artifact', 0],
      ['vehicle', 1],
      ['vessel', 2],
    ]);
    expect(entityLine(ONTOLOGY, TERN)).toBe('Vessel · IMO number 9400117 · Kept on Maritime desk');
  });
});

describe('entity intents', () => {
  const REF = { kind: 'entity', id: 'ent_01JBX7Q2W3E4R5T6Y7V8H9Q0PA', type: 'vessel', label: 'Northern Tern' };

  it('starts where entity.open and entity.explain ask, and nowhere for anything else', () => {
    expect(placeForIntent({ type: 'entity.open', payload: REF })).toEqual({ page: 'entity', id: REF.id });
    expect(placeForIntent({ type: 'entity.explain', payload: REF })).toEqual({ page: 'entity', id: REF.id, explain: true });
    expect(placeForIntent({ type: 'entity.open', payload: { id: 'x' } })).toBeUndefined();
    expect(placeForIntent({ type: 'document.open', payload: REF })).toBeUndefined();
  });

  it('says why an entity shows from where you stand', () => {
    expect(whyShown({ floor: 'org', floorName: 'Org' }, 'team', 'Maritime desk')).toMatch(/shows on every floor/);
    expect(whyShown({ floor: 'tree:t-mar', floorName: 'Maritime desk' }, 'team', 'Maritime desk')).toBe('It’s kept on this floor.');
    expect(whyShown({ floor: 'tree:t-ops', floorName: 'Operations' }, 'team', 'Maritime desk')).toMatch(/Operations, a floor above this one/);
    expect(whyShown({ floor: 'tree:t-ops', floorName: 'Operations' }, 'personal', 'You')).toMatch(/Operations, one of your teams/);
  });

  it('offers the kinds asked for, with the kinds below them', () => {
    expect(kindsOffered(ONTOLOGY, ['vehicle']).map((t) => t.type.key)).toEqual(['vehicle', 'vessel']);
    expect(kindsOffered(ONTOLOGY, []).length).toBe(3);
    expect(kindsOffered(ONTOLOGY, ['nothing'])).toEqual([]);
  });

  it('picks one entity for another app, answering with an EntityRef', async () => {
    const fetch = answering({
      '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
      '/api/atlas/v1/entities': () => Response.json({ entities: [TERN], total: 1, floors: ['org', 'tree:t-mar'], seeing: ['Org', 'Maritime desk'] }),
    });
    const respond = vi.fn();
    const el = await open(ctx(fetch, '/', { intent: { type: 'entity.pick', payload: { purpose: 'Bind to this intent', types: ['vessel'] } }, reply: { respond, cancel: vi.fn() } }));
    expect(el.querySelector('.augur-title')!.textContent).toBe('Bind to this intent');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('type=vessel'), expect.anything());
    await press(el.querySelector('.quill-list-row'));
    expect(respond).toHaveBeenCalledWith({ kind: 'entity', id: TERN.id, type: 'vessel', label: 'Northern Tern' });
  });

  it('gathers several when asked for more than one, and says what it needs to go on', async () => {
    const PORT: Entity = { ...TERN, id: 'ent_02', type: 'vessel', label: 'Grey Gull' };
    const fetch = answering({
      '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
      '/api/atlas/v1/entities': () => Response.json({ entities: [TERN, PORT], total: 2, floors: ['org'], seeing: ['Org'] }),
    });
    const respond = vi.fn();
    const el = await open(ctx(fetch, '/', { intent: { type: 'entity.pick', payload: { multiple: true } }, reply: { respond, cancel: vi.fn() } }));
    const pick = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Pick'));
    expect(shut(pick())).toBe(true);
    expect(el.textContent).toMatch(/Pick at least one to go on/);
    for (const row of [...el.querySelectorAll('.quill-list-row')]) await press(row);
    expect(pick()!.textContent).toBe('Pick these 2');
    await press(pick());
    expect(respond).toHaveBeenCalledWith([expect.objectContaining({ id: TERN.id }), expect.objectContaining({ id: PORT.id })]);
  });
});

describe('atlas', () => {
  it('lists what shows from this floor, and says which floors that is', async () => {
    const fetch = answering({
      '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
      '/api/atlas/v1/entities': () => Response.json({ entities: [TERN], total: 1, floors: ['org', 'tree:t-mar'], seeing: ['Org', 'Maritime desk'] }),
    });
    const el = await mounted(ctx(fetch));
    expect(el.querySelector('.quill-page-head-summary')!.textContent).toMatch(/floors above it shows: Org, Maritime desk/);
    expect(rowsOf(el)).toEqual([expect.objectContaining({ title: 'Northern Tern', detail: 'Vessel · IMO number 9400117 · Kept on Maritime desk' })]);
    await act(async () => void (await app.unmount!(el)));
    expect(el.textContent).toBe('');
  });

  const ENTITY_ROUTES = {
    '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
    '/api/atlas/v1/entities/ent_01/knowledge': () => Response.json(KNOWN),
    '/api/atlas/v1/entities/ent_01/used-by': () => Response.json({ intents: [], documents: [] }),
    '/api/atlas/v1/entities/ent_01': () => Response.json(TERN),
  };

  it('shows an entity, with what can’t be done and why, instead of hiding it', async () => {
    const el = await open(ctx(answering(ENTITY_ROUTES), '/entities/ent_01'));
    expect(pageTitle(el)).toBe('Northern Tern');
    const edit = button('Edit', el);
    expect(shut(edit)).toBe(true);
    expect(reasonOf(edit)).toMatch(/kept on the org floor: go there/);
    expect(rowsOf(el.querySelector('.atlas-facts'))).toEqual([expect.objectContaining({ title: 'Flag state: Liberia', detail: 'Since 1 Sep 2026 · Kept on Operations · Disputed' })]);
    expect(rowsOf(el.querySelector('.atlas-links-list'))).toEqual([expect.objectContaining({ title: 'Operated by an entity you can’t see from here' })]);
    expect(rowsOf(el.querySelector('.atlas-observations'))).toEqual([expect.objectContaining({ title: 'Flag state: Liberia', detail: 'Seen 1 Sep 2026 · From Port report · B2 · On Maritime desk · Raised to Operations' })]);
    expect(el.textContent).toMatch(/Only this floor’s leads accept/);
  });

  it('opens a fact with what can’t be done to it and why', async () => {
    const el = await open(ctx(answering(ENTITY_ROUTES), '/entities/ent_01'));
    await press(el.querySelector('.atlas-facts .quill-list-row'));
    const dialog = document.querySelector('.augur-dialog')!;
    expect(dialog.querySelector('.augur-title')!.textContent).toBe('Flag state: Liberia');
    expect(dialog.textContent).toMatch(/Disputed from Maritime desk/);
    const end = button('It has ended', dialog);
    expect(shut(end)).toBe(true);
    expect(reasonOf(end)).toMatch(/kept on Operations: its leads end or withdraw it there/);
  });

  it('says why an entity can’t be seen from here', async () => {
    const fetch = answering({
      '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
      '/api/atlas/v1/entities/ent_02': () => Response.json({ error: 'unseen', reason: 'kept', message: 'It’s kept on the Finance floor. Ask one of its leads if you need it.' }, { status: 403 }),
    });
    const el = await open(ctx(fetch, '/entities/ent_02'));
    expect(el.querySelector('.quill-state-title')!.textContent).toBe('You can’t see this from here');
    expect(el.querySelector('.quill-state-body')!.textContent).toMatch(/Finance floor/);
  });
});

const node = (id: string, label: string, depth: number, floorName = 'Org') => ({ ref: { kind: 'entity' as const, id, type: 'vessel', label }, state: 'active' as const, floorName, depth });
const AROUND_TERN: Subgraph = {
  nodes: [node('ent_01', 'Northern Tern', 0, 'Maritime desk'), node('ent_02', 'Halden Shipping', 1), node('ent_03', 'Southern Tern', 1)],
  edges: [
    { id: 'fct_a', from: 'ent_01', to: 'ent_02', relation: 'operated-by', floorName: 'Org', disputed: 0 },
    { id: 'fct_b', from: 'ent_03', to: 'ent_02', relation: 'operated-by', floorName: 'Org', disputed: 1 },
    { id: 'fct_c', from: 'ent_03', to: 'ent_01', relation: 'operated-by', floorName: 'Org', disputed: 1 },
  ],
  more: [{ entity: 'ent_02', relation: 'operated-by', direction: 'in', count: 3 }],
  unseen: [{ id: 'ent_09', reason: 'kept', floor: 'tree:t-fin', message: 'It’s kept on the Finance floor. Ask one of its leads if you need it.', near: ['ent_02'] }],
  missing: [],
};
const MORE_HALDEN: Subgraph = {
  nodes: [node('ent_02', 'Halden Shipping', 0), node('ent_04', 'Grey Heron', 1), node('ent_05', 'Osprey', 1), node('ent_06', 'Kittiwake', 1)],
  edges: ['ent_04', 'ent_05', 'ent_06'].map((id, i) => ({ id: `fct_m${i}`, from: id, to: 'ent_02', relation: 'operated-by', floorName: 'Org', disputed: 0 })),
  more: [{ entity: 'ent_04', relation: 'operated-by', direction: 'out', count: 1 }],
  unseen: [],
  missing: [],
};

describe('explorer', () => {
  it('opens a ring at a time, folding the rest into counts that open', () => {
    const open = widen(undefined, AROUND_TERN, 'ent_01');
    expect(rings(open).map((r) => [r.depth, r.nodes.map((n) => n.ref.label)])).toEqual([
      [0, ['Northern Tern']],
      [1, ['Halden Shipping', 'Southern Tern']],
    ]);
    expect(foldsOf(open, 'ent_02')).toEqual([{ entity: 'ent_02', relation: 'operated-by', direction: 'in', count: 3 }]);
    expect(hiddenNear(open, 'ent_02').map((u) => u.id)).toEqual(['ent_09']);
    const wider = widen(open, MORE_HALDEN, 'ent_02', 'operated-by');
    expect(foldsOf(wider, 'ent_02')).toEqual([]);
    expect(wider.nodes.get('ent_05')).toMatchObject({ depth: 2 });
    expect(foldsOf(wider, 'ent_04')).toEqual([{ entity: 'ent_04', relation: 'operated-by', direction: 'out', count: 1 }]);
  });

  it('draws folds and hidden counts as nodes to press, and leaves out disputed links when asked', () => {
    const open = widen(undefined, AROUND_TERN, 'ent_01');
    const look = { you: 'g', team: 'amber', org: 'blue', ink: 'i', muted: 'm', line: 'l', disputed: 'w', ground: 'd' };
    const graph = new MultiDirectedGraph();
    const added = syncGraph(graph, open, ONTOLOGY, look);
    expect(added).toEqual(expect.arrayContaining(['ent_01', 'ent_02', 'ent_03', 'fold:ent_02 operated-by in', 'hidden:ent_02']));
    expect(graph.getNodeAttributes('ent_01')).toMatchObject({ color: 'amber', fixed: true, size: 16 });
    expect(graph.getNodeAttribute('fold:ent_02 operated-by in', 'label')).toBe('+3 operates');
    expect(graph.getNodeAttribute('hidden:ent_02', 'label')).toBe('1 hidden');
    expect(graph.getEdgeAttribute('fct_b', 'color')).toBe('w');
    const at = graph.getNodeAttributes('ent_02');
    syncGraph(graph, open, ONTOLOGY, look, { hideDisputed: true });
    // Southern Tern was reached only by disputed links; the rest keep their places.
    expect(graph.hasNode('ent_03')).toBe(false);
    expect(graph.getNodeAttributes('ent_02')).toMatchObject({ x: at.x, y: at.y });
  });

  it('shows the graph as a list where it can’t be drawn, and opens a fold', async () => {
    let asked = 0;
    const bodies: unknown[] = [];
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/atlas/v1/ontology')) return Response.json(ONTOLOGY);
      if (path.startsWith('/api/atlas/v1/subgraph')) {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json(asked++ ? MORE_HALDEN : AROUND_TERN);
      }
      return new Response(null, { status: 404 });
    });
    const el = await open(ctx(fetch, '/explore/ent_01'));
    expect(bodies[0]).toEqual({ seeds: [{ id: 'ent_01' }], depth: 1, limitPerNode: 12 });
    expect(el.textContent).toMatch(/can’t draw the graph \(it needs WebGL\), so it shows as a list/);
    expect(pageTitle(el)).toBe('Around Northern Tern');
    expect([...el.querySelectorAll('.atlas-ring')].map((h) => h.textContent)).toEqual(['Centre', 'Ring 1']);
    await press([...el.querySelectorAll('.atlas-fold')].find((b) => b.textContent === '+3 operates'));
    expect(bodies[1]).toEqual({ seeds: [{ id: 'ent_02' }], depth: 1, relations: ['operated-by'], limitPerNode: 200 });
    expect([...el.querySelectorAll('.atlas-ring')].map((h) => h.textContent)).toEqual(['Centre', 'Ring 1', 'Ring 2']);
    // What can't be seen says why, beside what it's linked to.
    await press([...el.querySelectorAll('.atlas-fold')].find((b) => b.textContent === '1 hidden'));
    expect(el.querySelector('.atlas-why')!.textContent).toMatch(/Finance floor/);
  });
});


const PROPOSAL: ProposalView = {
  id: 'prp_1',
  source: { kind: 'document', document: { app: 'folio', id: 'd-1', version: '2', title: 'Port report' }, anchor: 'b2' },
  producer: { kind: 'person', id: 'u2' },
  state: 'open',
  createdBy: 'u2',
  createdAt: '2026-10-27T00:00:00Z',
  floorName: 'Maritime desk',
  ontologyVersion: 1,
  left: 1,
  mentions: [
    {
      key: 'm1', text: 'N. Tern', type: 'vessel', anchor: 'b2', context: 'The N. Tern left Rotterdam on Monday.',
      matches: [{ entity: { kind: 'entity', id: 'ent_01', type: 'vessel', label: 'Northern Tern', state: 'active', floorName: 'Maritime desk' }, why: 'alias' }],
    },
  ],
  observations: [],
  terms: [],
  can: { decide: true, finish: false, withdraw: true, why: 'Decide every mention and observation, then finish it.' },
};

describe('triage', () => {
  it('reads and writes Triage’s addresses', () => {
    expect(placeFor('/triage')).toEqual({ page: 'triage' });
    expect(placeFor('/triage/prp_1')).toEqual({ page: 'proposal', id: 'prp_1' });
    expect(pathFor({ page: 'proposal', id: 'prp_1' })).toBe('/triage/prp_1');
  });

  it('lists what’s waiting, and says who decides when it isn’t you', async () => {
    const fetch = answering({
      '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
      '/api/atlas/v1/proposals?state=open': () =>
        Response.json({ floorName: 'Maritime desk', decide: false, why: 'Only this floor’s leads decide what proposals name.', proposals: [{ ...PROPOSAL, items: 1, decided: 0 }] }),
      '/api/atlas/v1/proposals?state=closed': () => Response.json({ floorName: 'Maritime desk', decide: false, proposals: [] }),
    });
    const el = await open(ctx(fetch, '/triage'));
    expect(el.textContent).toContain('Only this floor’s leads decide');
    expect(rowsOf(el.querySelector('.atlas-triage'))).toEqual([expect.objectContaining({ title: 'Port report', detail: '0 of 1 decided · proposed by someone on this floor · version 2' })]);
  });

  it('shows a mention in its passage with what it might be, and links it to the one chosen', async () => {
    let decided: unknown;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/atlas/v1/ontology')) return Response.json(ONTOLOGY);
      if (path === '/api/atlas/v1/proposals/prp_1/mentions/m1') {
        decided = JSON.parse(String(init?.body));
        return Response.json({ ...PROPOSAL, left: 0, mentions: [{ ...PROPOSAL.mentions[0], decision: { as: 'link', entity: PROPOSAL.mentions[0].matches[0].entity } }], can: { decide: true, finish: true, withdraw: true } });
      }
      if (path.startsWith('/api/atlas/v1/proposals/prp_1')) return Response.json(PROPOSAL);
      return new Response(null, { status: 404 });
    });
    const raise = vi.fn();
    const el = await open(ctx(fetch, '/triage/prp_1', { raise }));
    expect(el.querySelector('.atlas-context mark')!.textContent).toBe('N. Tern');
    // Finish waits until everything is decided, and the page says so.
    expect(shut(button('Finish', el))).toBe(true);
    expect(reasonOf(button('Finish', el))).toContain('Decide every mention and observation');
    await press(button('It’s Northern Tern', el));
    expect(decided).toEqual({ as: 'link', entity: 'ent_01' });
    expect(el.querySelector('.atlas-outcome .quill-ref-name')!.textContent).toBe('Northern Tern');
    expect(shut(button('Finish', el))).toBe(false);
    await press(button('Open the source', el));
    expect(raise).toHaveBeenCalledWith({ type: 'document.open', payload: { app: 'folio', id: 'd-1', version: '2', title: 'Port report' } });
  });

  it('says how mentions were matched and why not by meaning, and looks again when asked', async () => {
    const matched: ProposalView = {
      ...PROPOSAL,
      matching: { spelling: true, meaning: false, why: 'Matching by meaning is off: Models are turned off. An admin can turn them on in Admin.', at: '2026-10-27T00:00:00Z' },
      mentions: [{ ...PROPOSAL.mentions[0], matches: [{ ...PROPOSAL.mentions[0].matches[0], why: 'similar', detail: 'Northern Tern', score: 0.46 }] }],
    };
    let looked = 0;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/atlas/v1/ontology')) return Response.json(ONTOLOGY);
      if (path === '/api/atlas/v1/proposals/prp_1/match' && init?.method === 'POST') {
        looked++;
        return Response.json({ ...matched, matching: { spelling: true, meaning: true, at: '2026-10-27T00:00:00Z' } });
      }
      if (path.startsWith('/api/atlas/v1/proposals/prp_1')) return Response.json(matched);
      return new Response(null, { status: 404 });
    });
    const el = await open(ctx(fetch, '/triage/prp_1'));
    expect(el.querySelector('.atlas-matching')!.textContent).toMatch(/^Matched by identity keys, names and names spelt nearly alike, .+\. Matching by meaning is off: Models are turned off/);
    expect(el.textContent).toContain('It’s Northern Tern');
    expect(el.querySelector('.atlas-matches .atlas-note')!.textContent).toBe('spelt alike · Maritime desk');
    await press(button('Look again', el));
    expect(looked).toBe(1);
    expect(el.querySelector('.atlas-matching')!.textContent).toMatch(/^Matched by identity keys, names, names spelt nearly alike and meaning/);
  });

  it('takes words another app offers, and files them in this floor’s Triage', async () => {
    let sent: unknown;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/atlas/v1/ontology')) return Response.json(ONTOLOGY);
      if (path === '/api/atlas/v1/proposals' && init?.method === 'POST') {
        sent = JSON.parse(String(init.body));
        return Response.json({ ...PROPOSAL, queue: 'Maritime desk' }, { status: 201 });
      }
      return new Response(null, { status: 404 });
    });
    const offer = { source: { app: 'folio', id: 'd-1', version: '2', title: 'Port report' }, anchor: 'b2', text: 'N. Tern', context: 'The N. Tern left Rotterdam on Monday.', type: 'vessel' };
    expect(proposalOffer({ type: 'entity.propose', payload: offer })).toEqual(offer);
    expect(proposalOffer({ type: 'entity.propose', payload: { text: 'x' } })).toBeUndefined();
    const respond = vi.fn();
    const el = await open(ctx(fetch, '/', { intent: { type: 'entity.propose', payload: offer }, reply: { respond, cancel: vi.fn() } }));
    expect(el.querySelector('.augur-summary')!.textContent).toContain('It goes to Maritime desk’s Triage');
    // The kind the offer names is chosen to start with.
    await press(button('Send to Triage', el));
    expect(sent).toEqual({
      source: { kind: 'document', document: offer.source, anchor: 'b2' },
      mentions: [{ key: 'm1', text: 'N. Tern', type: 'vessel', anchor: 'b2', context: offer.context }],
    });
    expect(respond).toHaveBeenCalledWith({ proposal: 'prp_1', queue: 'Maritime desk’s Triage' });
  });

  it('cancels an offer it can’t read', async () => {
    const cancel = vi.fn();
    const el = document.body.appendChild(document.createElement('div'));
    await act(async () => void (await app.mount(el, ctx(vi.fn(), '/', { intent: { type: 'entity.propose', payload: { text: '' } }, reply: { respond: vi.fn(), cancel } }))));
    expect(cancel).toHaveBeenCalled();
  });
});

describe('ontology', () => {
  const PACKS = { govern: false, why: 'Only admins change the ontology for now. You can read it, its packs and its history.', packs: [{ id: 'cco', name: 'Common Core Ontologies (profile)', version: '1.5', licence: 'BSD-3-Clause', source: 'https://github.com/CommonCoreOntology/CommonCoreOntologies', terms: 21, builtIn: true, loadedAt: '2026-10-27T00:00:00Z' }] };
  const answer = (more: Record<string, () => Response> = {}) =>
    answering({
      ...more,
      '/api/atlas/v1/ontology/packs/cco': () =>
        Response.json({ ...PACKS.packs[0], terms: [{ iri: 'cco:Watercraft', kind: 'class', label: 'Watercraft', adopted: 'vessel' }, { iri: 'cco:Weapon', kind: 'class', label: 'Weapon', parent: 'cco:Artifact' }] }),
      '/api/atlas/v1/ontology/packs': () => Response.json(PACKS),
      '/api/atlas/v1/ontology/versions': () => Response.json({ versions: [{ version: 1, note: 'Starter profile', changes: [], madeAt: '2026-10-27T00:00:00Z' }] }),
      '/api/atlas/v1/ontology/candidates': () => Response.json({ govern: false, why: PACKS.why, waiting: 2, candidates: [] }),
      '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
    });
  const tab = (el: HTMLElement, word: string) => [...el.querySelectorAll('.atlas-tabs button')].find((b) => b.textContent?.startsWith(word));

  it('reads and writes its address', () => {
    expect(placeFor('/ontology')).toEqual({ page: 'ontology' });
    expect(pathFor({ page: 'ontology' })).toBe('/ontology');
  });

  it('shows everyone the kinds and where they come from, saying who can change them, and how many words wait', async () => {
    const el = await open(ctx(answer(), '/ontology'));
    expect(el.textContent).toContain('Only admins change the ontology');
    expect(el.textContent).toContain('CCO · Watercraft');
    expect(el.textContent).toContain('IMO number (says which one), Flag state (through facts)');
    const add = button('Add a kind', el);
    expect(shut(add)).toBe(true);
    expect(reasonOf(add)).toContain('Only admins');
    await press(tab(el, 'Asked for'));
    expect(el.textContent).toContain('2 words that sources asked for wait for an admin');
  });

  it('opens a pack, showing what’s kept and offering the rest to admins only', async () => {
    const el = await open(ctx(answer(), '/ontology'));
    await press(tab(el, 'Packs'));
    expect(el.textContent).toContain('Version 1.5 · BSD-3-Clause · 21 terms · comes with Data Atlas');
    await press(button('Open', el));
    expect(el.querySelector('.atlas-ontology .quill-tag')!.textContent).toBe('Kept as Vessel');
    expect(shut(button('Adopt…', el))).toBe(true);
  });
});

describe('used by', () => {
  const USED = {
    intents: [
      { app: 'mandate', id: 'int_1', role: 'subject', since: '2026-10-27T00:00:00Z' },
      { app: 'mandate', id: 'int_2', role: 'resource', since: '2026-10-27T00:00:00Z', floorName: 'Ops planning' },
    ],
    documents: [{ app: 'folio', id: 'd-1', title: 'Port report', observations: 2, lastAt: '2026-10-27T00:00:00Z', withdrawn: true }],
  };
  const known = { ...KNOWN, noCurrentSource: 'Everything known of it here came from sources since withdrawn. It stays, with no current source.' };
  const routes = (mandate: () => Response) => ({
    '/api/atlas/v1/ontology': () => Response.json(ONTOLOGY),
    '/api/atlas/v1/entities/ent_01/knowledge': () => Response.json(known),
    '/api/atlas/v1/entities/ent_01/used-by': () => Response.json(USED),
    '/api/atlas/v1/entities/ent_01': () => Response.json(TERN),
    '/api/mandate/v1/refs/resolve': mandate,
  });

  it('names intents through Mandate as the person, keeps the ones they can’t open in sight, and opens the rest', async () => {
    const raise = vi.fn();
    const el = await open(ctx(answering(routes(() => Response.json({ refs: [{ id: 'int_1', label: 'Operation Alpha', canOpen: true }, { id: 'int_2', canOpen: false }] }))), '/entities/ent_01', { raise }));
    expect(rowsOf(el.querySelector('.atlas-used-intents'))).toEqual([
      expect.objectContaining({ title: 'Operation Alpha', detail: expect.stringMatching(/^Intent · its subject · bound/) }),
      expect.objectContaining({ title: 'An intent you can’t open', detail: expect.stringContaining('kept on Ops planning, ask its lead'), disabled: true }),
    ]);
    expect(rowsOf(el.querySelector('.atlas-used-documents'))[0]).toMatchObject({ title: 'Port report', detail: expect.stringContaining('2 observations from it · since withdrawn') });
    expect(el.textContent).toContain('It stays, with no current source.');
    await press(el.querySelector('.atlas-used-intents .quill-list-row'));
    expect(raise).toHaveBeenCalledWith({ type: 'aim.open', payload: { id: 'int_1' } });
  });

  it('says how many intents use it when Mandate can’t be asked', async () => {
    const el = await open(ctx(answering(routes(() => new Response(null, { status: 403 }))), '/entities/ent_01'));
    expect(el.textContent).toContain('2 intents use it. Mandate isn’t open to you on this floor, so the intents can’t be named.');
  });
});
