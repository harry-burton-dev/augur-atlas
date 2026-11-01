import { callerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { AtlasAuditEntry } from './audit.ts';
import type { People } from './people.ts';
import { PgAtlasStore } from './store.ts';

// The org has Operations, with the Maritime desk under it, and Finance beside it.
// Sam is on the Maritime desk (so also under Operations), Ana on Operations, Lee on Finance.
const PRINCIPALS: Record<string, string[]> = {
  sam: ['person:sam', 'team:t-mar', 'tree:t-mar', 'tree:t-ops', 'org'],
  ana: ['person:ana', 'team:t-ops', 'tree:t-ops', 'org'],
  lee: ['person:lee', 'team:t-fin', 'tree:t-fin', 'org'],
};
const PATHS: Record<string, string[]> = { 't-mar': ['t-ops', 't-mar'], 't-ops': ['t-ops'], 't-fin': ['t-fin'] };
const NAMES = new Map([
  ['t-mar', 'Maritime desk'],
  ['t-ops', 'Operations'],
  ['t-fin', 'Finance'],
]);
const people: People = {
  principals: async (person) => PRINCIPALS[person] ?? [`person:${person}`, 'org'],
  teamPath: async (team) => PATHS[team] ?? [team],
  teamNames: async (ids) => new Map(ids.filter((id) => NAMES.has(id)).map((id) => [id, NAMES.get(id)!])),
};

const on = (id: string, workspace: CallerWorkspace): Caller => ({ id, name: id, departments: [], roles: [], workspace });
const team = (id: string, role: CallerWorkspace['role'] = 'member'): CallerWorkspace => ({ id, kind: 'team', role });
const ORG: CallerWorkspace = { id: 'w-org', kind: 'org', role: 'member' };
const ORG_LEAD: CallerWorkspace = { ...ORG, role: 'lead' };

// Sam as a member and as a lead of the Maritime desk; Ana leading Operations.
const SAM = on('sam', team('t-mar'));
const SAM_LEAD = on('sam', team('t-mar', 'lead'));
const ANA_LEAD = on('ana', team('t-ops', 'lead'));
const BY_HAND = { kind: 'person' } as const;

describe.runIf(process.env.DATABASE_URL)('What Data Atlas knows', () => {
  let store: PgAtlasStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const audited: AtlasAuditEntry[] = [];
  const call = (method: 'GET' | 'POST', url: string, caller: Caller, payload?: object) => app.inject({ method, url, headers: callerHeaders(caller), ...(payload ? { payload } : {}) });
  const add = async (caller: Caller, type: string, label: string) => (await call('POST', '/v1/entities', caller, { type, label })).json() as { id: string };
  const knowledge = async (caller: Caller, id: string, query = '') => (await call('GET', `/v1/entities/${id}/knowledge${query}`, caller)).json();
  let kestrel: { id: string };
  let northwind: { id: string };

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    app = await buildApp({ store, people, audit: async (entry) => void audited.push(entry) });
    kestrel = await add(on('ana', ORG), 'vessel', 'Kestrel');
    northwind = await add(on('ana', ORG), 'organization', 'Northwind Shipping');
  });
  afterAll(async () => {
    await app?.close();
    await store?.close();
  });

  it('keeps details known through facts off the entity itself', async () => {
    const res = await call('POST', '/v1/entities', SAM, { type: 'vessel', label: 'Tern', details: { flag: 'Panama' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/record an observation of it instead/);
  });

  it('records what someone saw on their floor, and only leads accept it as so', async () => {
    const seen = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM, { property: 'flag', value: ' Panama ', source: BY_HAND, grade: 'B2', observedAt: '2026-09-01' });
    expect(seen.statusCode).toBe(201);
    const { observation } = seen.json();
    expect(observation).toMatchObject({ id: expect.stringMatching(/^obs_/), property: 'flag', value: 'Panama', floor: 'tree:t-mar', grade: 'B2', observedAt: '2026-09-01T00:00:00.000Z' });
    expect(audited.at(-1)).toMatchObject({ action: 'observation.recorded', target: kestrel.id });

    const refused = await call('POST', `/v1/entities/${kestrel.id}/facts`, SAM, { backedBy: [observation.id] });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/Only this floor’s leads accept/);
    const memberView = (await knowledge(SAM, kestrel.id)).observations[0];
    expect(memberView.can).toMatchObject({ accept: false, raise: false, why: expect.stringMatching(/leads/) });

    const fact = await call('POST', `/v1/entities/${kestrel.id}/facts`, SAM_LEAD, { backedBy: [observation.id] });
    expect(fact.statusCode).toBe(201);
    expect(fact.json()).toMatchObject({ id: expect.stringMatching(/^fct_/), property: 'flag', value: 'Panama', floor: 'tree:t-mar', validFrom: '2026-09-01T00:00:00.000Z', backedBy: [observation.id] });
  });

  it('refuses what the ontology doesn’t allow, saying why', async () => {
    const unknown = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM, { property: 'colour', value: 'grey', source: BY_HAND });
    expect(unknown.json().message).toMatch(/no detail or link called “colour”/);
    const port = await add(on('ana', ORG), 'port', 'Felixstowe');
    const wrongKind = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM, { property: 'operated-by', target: port.id, source: BY_HAND });
    expect(wrongKind.statusCode).toBe(400);
    expect(wrongKind.json().message).toMatch(/links to agents, and Felixstowe isn’t one/);
    const finance = await add(on('lee', team('t-fin')), 'organization', 'Ledger Lines');
    const hidden = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM, { property: 'owned-by', target: finance.id, source: BY_HAND });
    expect(hidden.statusCode).toBe(403);
    expect(hidden.json().message).toMatch(/doesn’t show from here.*Finance floor/);
    const badGrade = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM, { property: 'flag', value: 'Liberia', source: BY_HAND, grade: 'G9' });
    expect(badGrade.statusCode).toBe(400);
  });

  it('fences knowledge by floor: lower floors never leak up', async () => {
    const fromOrg = await knowledge(on('ana', ORG_LEAD), kestrel.id);
    expect(fromOrg.facts).toEqual([]);
    expect(fromOrg.observations).toEqual([]);
    const fromDesk = await knowledge(SAM, kestrel.id);
    expect(fromDesk.facts.map((f: { value: string; floorName: string }) => [f.value, f.floorName])).toEqual([['Panama', 'Maritime desk']]);
  });

  it('lets a lead raise an observation to a floor above, where that floor’s leads may accept it', async () => {
    const [mine] = (await knowledge(SAM_LEAD, kestrel.id)).observations;
    expect(mine.can.raiseTo.map((f: { name: string }) => f.name).sort()).toEqual(['Operations', 'Org']);
    const sideways = await call('POST', `/v1/observations/${mine.id}/raise`, SAM_LEAD, { to: 'tree:t-fin' });
    expect(sideways.statusCode).toBe(400);
    expect(sideways.json().message).toMatch(/It can go to Org, Operations/);
    const raised = await call('POST', `/v1/observations/${mine.id}/raise`, SAM_LEAD, { to: 'tree:t-ops' });
    expect(raised.statusCode).toBe(201);
    expect(raised.json()).toMatchObject({ floor: 'tree:t-ops', floorName: 'Operations', raisedFrom: mine.id, value: 'Panama', grade: 'B2' });
    expect((await call('POST', `/v1/observations/${mine.id}/raise`, SAM_LEAD, { to: 'tree:t-ops' })).statusCode).toBe(409);
    expect((await knowledge(SAM_LEAD, kestrel.id)).observations.find((o: { id: string }) => o.id === mine.id).raisedTo).toEqual(['Operations']);

    const accepted = await call('POST', `/v1/entities/${kestrel.id}/facts`, ANA_LEAD, { backedBy: [raised.json().id] });
    expect(accepted.statusCode).toBe(201);
    // From the desk, both floors' facts show, each saying where it's kept.
    const fromDesk = await knowledge(SAM, kestrel.id);
    expect(fromDesk.facts.map((f: { floorName: string }) => f.floorName).sort()).toEqual(['Maritime desk', 'Operations']);
    const operations = fromDesk.facts.find((f: { floorName: string }) => f.floorName === 'Operations');
    expect(operations.can).toMatchObject({ end: false, withdraw: false, dispute: true, why: expect.stringMatching(/kept on Operations/) });
  });

  it('keeps two clocks: a new record replaces the floor’s old one, and the old one is still known as of before', async () => {
    const before = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    const res = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM_LEAD, { property: 'flag', value: 'Liberia', source: { kind: 'document', document: { app: 'folio', id: 'd-1', title: 'Port report' } }, accept: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().fact).toMatchObject({ value: 'Liberia', floor: 'tree:t-mar' });
    const desk = (k: { facts: { value: string; floorName: string }[] }) => k.facts.filter((f) => f.floorName === 'Maritime desk').map((f) => f.value);
    expect(desk(await knowledge(SAM, kestrel.id))).toEqual(['Liberia']);
    expect(desk(await knowledge(SAM, kestrel.id, `?known=${encodeURIComponent(before)}`))).toEqual(['Panama']);
  });

  it('links entities with facts, seen from both ends and walked by the subgraph', async () => {
    const res = await call('POST', `/v1/entities/${kestrel.id}/observations`, SAM_LEAD, { property: 'operated-by', target: northwind.id, source: BY_HAND, accept: true });
    expect(res.statusCode).toBe(201);
    const fromShip = (await knowledge(SAM, kestrel.id)).facts.find((f: { property: string }) => f.property === 'operated-by');
    expect(fromShip).toMatchObject({ direction: 'out', other: { kind: 'entity', id: northwind.id, label: 'Northwind Shipping', floorName: 'Org' } });
    const fromOperator = (await knowledge(SAM, northwind.id)).facts;
    expect(fromOperator).toEqual([expect.objectContaining({ direction: 'in', property: 'operated-by', other: expect.objectContaining({ id: kestrel.id }) })]);
    // The org floor doesn't see the desk's link.
    expect((await knowledge(on('ana', ORG), northwind.id)).facts).toEqual([]);

    const graph = (await call('POST', '/v1/subgraph', SAM, { seeds: [{ id: kestrel.id }], depth: 2 })).json();
    expect(graph.nodes.map((n: { ref: { label: string }; depth: number }) => [n.ref.label, n.depth])).toEqual([
      ['Kestrel', 0],
      ['Northwind Shipping', 1],
    ]);
    expect(graph.edges).toEqual([expect.objectContaining({ from: kestrel.id, to: northwind.id, relation: 'operated-by', floorName: 'Maritime desk' })]);
    const fromOrg = (await call('POST', '/v1/subgraph', on('ana', ORG), { seeds: [{ id: kestrel.id }], depth: 2 })).json();
    expect(fromOrg.edges).toEqual([]);
    const narrow = (await call('POST', '/v1/subgraph', SAM, { seeds: [{ id: kestrel.id }], relations: ['owned-by'] })).json();
    expect(narrow.edges).toEqual([]);
  });

  it('ends a fact on the valid clock, so it is still true as of before it ended', async () => {
    const link = (await knowledge(SAM, kestrel.id)).facts.find((f: { property: string }) => f.property === 'operated-by');
    expect((await call('POST', `/v1/facts/${link.id}/end`, SAM, {})).statusCode).toBe(403);
    const ended = await call('POST', `/v1/facts/${link.id}/end`, SAM_LEAD, { validTo: '2026-10-01' });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toMatchObject({ validTo: '2026-10-01T00:00:00.000Z', target: northwind.id });
    const links = async (query: string) => (await knowledge(SAM, kestrel.id, query)).facts.filter((f: { property: string }) => f.property === 'operated-by');
    expect(await links('')).toEqual([]);
    expect(await links('?at=2026-09-15')).toHaveLength(1);
    const graph = (await call('POST', '/v1/subgraph', SAM, { seeds: [{ id: kestrel.id }], asOf: '2026-09-15T00:00:00Z' })).json();
    expect(graph.edges).toHaveLength(1);
  });

  it('lets anyone who sees a fact dispute it, and the disputer or its leads clear it', async () => {
    const operations = (await knowledge(SAM, kestrel.id)).facts.find((f: { floorName: string }) => f.floorName === 'Operations');
    const disputed = await call('POST', `/v1/facts/${operations.id}/disputes`, SAM, { note: 'AIS shows a different flag since August.' });
    expect(disputed.statusCode).toBe(201);
    // The dispute is for the fact's own floor, so Operations sees it though it was raised on the desk below.
    const fromOps = (await knowledge(on('ana', team('t-ops')), kestrel.id)).facts.find((f: { id: string }) => f.id === operations.id);
    expect(fromOps.disputes).toEqual([expect.objectContaining({ note: 'AIS shows a different flag since August.', floorName: 'Maritime desk', mine: false })]);
    expect((await knowledge(SAM, kestrel.id)).facts.find((f: { id: string }) => f.id === operations.id).disputes[0].mine).toBe(true);
    const lee = await call('POST', `/v1/disputes/${disputed.json().id}/clear`, on('lee', team('t-fin', 'lead')));
    expect(lee.statusCode).toBe(403);
    expect(lee.json().message).toMatch(/Only whoever raised it/);
    const cleared = await call('POST', `/v1/disputes/${disputed.json().id}/clear`, SAM);
    expect(cleared.json()).toMatchObject({ clearedBy: 'sam' });
  });

  it('withdraws a fact recorded in error, leaving it in the record as of before', async () => {
    const before = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    const desk = (await knowledge(SAM, kestrel.id)).facts.find((f: { floorName: string; property: string }) => f.floorName === 'Maritime desk' && f.property === 'flag');
    const res = await call('POST', `/v1/facts/${desk.id}/withdraw`, SAM_LEAD);
    expect(res.statusCode).toBe(200);
    expect(audited.at(-1)).toMatchObject({ action: 'fact.withdrawn' });
    const flags = async (query: string) => (await knowledge(SAM, kestrel.id, query)).facts.filter((f: { floorName: string; property: string }) => f.floorName === 'Maritime desk' && f.property === 'flag');
    expect(await flags('')).toEqual([]);
    expect(await flags(`?known=${encodeURIComponent(before)}`)).toHaveLength(1);
  });

  it('gives the explorer the strongest links first, folds the rest into counts, and counts disputes', async () => {
    const org = on('ana', ORG_LEAD);
    const link = async (from: string, property: string, to: string) =>
      (await call('POST', `/v1/entities/${from}/observations`, org, { property, target: to, source: BY_HAND, accept: true })).json().fact as { id: string };
    const harbour = await add(org, 'facility', 'Port Halden');
    const ships = await Promise.all(['Grey Heron', 'Southern Tern', 'Osprey'].map((label) => add(org, 'vessel', label)));
    for (const ship of ships) await link(ship.id, 'located-at', harbour.id);
    // Osprey is also operated by Northwind, so it is the most linked of the three.
    const operated = await link(ships[2].id, 'operated-by', northwind.id);
    await call('POST', `/v1/facts/${operated.id}/disputes`, org, { note: 'Sold in September.' });

    const graph = (await call('POST', '/v1/subgraph', on('ana', ORG), { seeds: [{ id: harbour.id }], depth: 1, limitPerNode: 2 })).json();
    expect(graph.nodes.map((n: { ref: { label: string } }) => n.ref.label)).toEqual(['Port Halden', 'Osprey', 'Grey Heron']);
    // One left over at the port, and what lies past the ring: Osprey's operator.
    expect(graph.more).toEqual([
      { entity: harbour.id, relation: 'located-at', direction: 'in', count: 1 },
      { entity: ships[2].id, relation: 'operated-by', direction: 'out', count: 1 },
    ]);

    const wider = (await call('POST', '/v1/subgraph', on('ana', ORG), { seeds: [{ id: harbour.id }], depth: 2 })).json();
    expect(wider.edges.find((e: { id: string }) => e.id === operated.id)).toMatchObject({ relation: 'operated-by', disputed: 1 });
    expect(wider.edges.filter((e: { disputed: number }) => e.disputed === 0)).toHaveLength(3);
  });
});
