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

describe.runIf(process.env.DATABASE_URL)('Proposals and Triage', () => {
  let store: PgAtlasStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const audited: AtlasAuditEntry[] = [];
  const call = (method: 'GET' | 'POST', url: string, caller: Caller, payload?: object) => app.inject({ method, url, headers: callerHeaders(caller), ...(payload ? { payload } : {}) });
  const REPORT = { kind: 'document', document: { app: 'folio', id: 'd7', version: '3', title: 'Maritime weekly 42' }, anchor: 'p-12' } as const;
  let tern: { id: string };
  let halden: { id: string };

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    app = await buildApp({ store, people, audit: async (entry) => void audited.push(entry) });
    tern = (await call('POST', '/v1/entities', on('ana', ORG), { type: 'vessel', label: 'Northern Tern', aliases: ['Nordic Tern'], details: { imo: '9400117' } })).json();
    halden = (await call('POST', '/v1/entities', on('ana', ORG), { type: 'organization', label: 'Halden Shipping' })).json();
  });
  afterAll(async () => {
    await app?.close();
    await store?.close();
  });

  const propose = (caller: Caller) =>
    call('POST', '/v1/proposals', caller, {
      source: REPORT,
      mentions: [
        { key: 'm1', text: 'N. Tern', type: 'vessel', anchor: 'p-12', context: 'The cargo ship N. Tern was seen alongside at Port Halden.', keys: { imo: '9 400 117' } },
        { key: 'm2', text: 'halden shipping', type: 'organization', anchor: 'p-12' },
        { key: 'm3', text: 'Grey Heron', type: 'vessel', anchor: 'p-13' },
      ],
      observations: [
        { key: 'o1', about: 'm1', property: 'operated-by', target: 'm2', grade: 'B2' },
        { key: 'o2', about: 'm3', property: 'flag', value: 'Panama', observedAt: '2026-10-14' },
      ],
      terms: [{ key: 't1', kind: 'type', name: 'Port call', parent: 'event' }],
    });

  it('files a proposal in the floor’s Triage, with the entities each mention may be', async () => {
    const res = await propose(SAM);
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p).toMatchObject({ id: expect.stringMatching(/^prp_/), floor: 'tree:t-mar', queue: 'Maritime desk', state: 'open', producer: { kind: 'person', id: 'sam' }, left: 5 });
    expect(p.mentions[0].matches).toEqual([expect.objectContaining({ why: 'key', detail: 'IMO number', entity: expect.objectContaining({ id: tern.id, label: 'Northern Tern' }) })]);
    expect(p.mentions[1].matches).toEqual([expect.objectContaining({ why: 'name', entity: expect.objectContaining({ id: halden.id }) })]);
    expect(p.mentions[2].matches).toEqual([]);
    expect(p.observations[0]).toMatchObject({ ready: false, why: 'Decide what it’s about first.' });
    expect(p.terms).toEqual([{ key: 't1', kind: 'type', name: 'Port call', parent: 'event' }]);
    expect(p.can).toMatchObject({ decide: false, withdraw: true, why: expect.stringMatching(/Only this floor’s leads decide/) });
    expect(audited.at(-1)).toMatchObject({ action: 'proposal.received', target: p.id });

    const queue = (await call('GET', '/v1/proposals', SAM_LEAD)).json();
    expect(queue).toMatchObject({ floorName: 'Maritime desk', decide: true });
    expect(queue.proposals).toEqual([expect.objectContaining({ id: p.id, items: 5, decided: 0 })]);
    // The org floor sees neither the queue nor the proposal: lower floors never leak up.
    expect((await call('GET', '/v1/proposals', on('ana', ORG))).json().proposals).toEqual([]);
    const fromOrg = await call('GET', `/v1/proposals/${p.id}`, on('ana', ORG));
    expect(fromOrg.statusCode).toBe(403);
    const member = await call('POST', `/v1/proposals/${p.id}/mentions/m1`, SAM, { as: 'link', entity: tern.id });
    expect(member.statusCode).toBe(403);
  });

  it('lets a lead link, make and accept, then finish once everything is decided', async () => {
    const p = (await propose(SAM)).json();
    const at = (key: string, body: object) => call('POST', `/v1/proposals/${p.id}/mentions/${key}`, SAM_LEAD, body);
    expect((await at('m1', { as: 'link', entity: tern.id })).statusCode).toBe(200);
    expect((await at('m1', { as: 'drop' })).statusCode).toBe(409);
    await at('m2', { as: 'link', entity: halden.id });
    const made = (await at('m3', { as: 'new' })).json();
    const heron = made.mentions[2].decision;
    expect(heron).toMatchObject({ as: 'new', entity: { kind: 'entity', label: 'Grey Heron', type: 'vessel', floorName: 'Maritime desk' } });
    expect(made.observations.map((o: { ready: boolean }) => o.ready)).toEqual([true, true]);

    const finishing = await call('POST', `/v1/proposals/${p.id}/finish`, SAM_LEAD);
    expect(finishing.statusCode).toBe(409);
    expect(finishing.json().message).toBe('2 left to decide before it can be finished.');

    const linked = (await call('POST', `/v1/proposals/${p.id}/observations/o1`, SAM_LEAD, { as: 'accepted' })).json();
    expect(linked.observations[0].decision).toMatchObject({ as: 'accepted', observation: expect.stringMatching(/^obs_/), fact: expect.stringMatching(/^fct_/) });
    const known = (await call('GET', `/v1/entities/${tern.id}/knowledge`, SAM)).json();
    expect(known.facts).toEqual([expect.objectContaining({ property: 'operated-by', target: halden.id, floorName: 'Maritime desk' })]);
    expect(known.observations[0].source).toEqual(REPORT);
    expect(known.observations[0].grade).toBe('B2');

    const seen = (await call('POST', `/v1/proposals/${p.id}/observations/o2`, SAM_LEAD, { as: 'seen' })).json();
    expect(seen.observations[1].decision).toMatchObject({ as: 'seen' });
    expect((await call('GET', `/v1/entities/${heron.entity.id}/knowledge`, SAM)).json()).toMatchObject({ facts: [], observations: [expect.objectContaining({ property: 'flag', value: 'Panama' })] });

    const done = await call('POST', `/v1/proposals/${p.id}/finish`, SAM_LEAD);
    expect(done.json()).toMatchObject({ state: 'finished', left: 0, can: { decide: false, why: expect.stringMatching(/finished/) } });
    expect((await call('GET', '/v1/proposals?state=closed', SAM_LEAD)).json().proposals.map((x: { id: string }) => x.id)).toContain(p.id);
  });

  it('drops an observation with what it was about, and lets its maker withdraw a proposal', async () => {
    const p = (await propose(SAM)).json();
    const dropped = (await call('POST', `/v1/proposals/${p.id}/mentions/m3`, SAM_LEAD, { as: 'drop' })).json();
    expect(dropped.observations[1]).toMatchObject({ ready: false, why: expect.stringMatching(/dropped/) });
    expect((await call('POST', `/v1/proposals/${p.id}/observations/o2`, SAM_LEAD, { as: 'seen' })).statusCode).toBe(409);
    expect((await call('POST', `/v1/proposals/${p.id}/observations/o2`, SAM_LEAD, { as: 'drop' })).statusCode).toBe(200);
    expect((await call('POST', `/v1/proposals/${p.id}/withdraw`, on('lee', team('t-fin')))).statusCode).toBe(403);
    const withdrawn = await call('POST', `/v1/proposals/${p.id}/withdraw`, SAM);
    expect(withdrawn.json()).toMatchObject({ state: 'withdrawn' });
    expect((await call('POST', `/v1/proposals/${p.id}/mentions/m1`, SAM_LEAD, { as: 'drop' })).statusCode).toBe(409);
  });

  it('refuses a proposal whose parts don’t point at each other', async () => {
    const res = await call('POST', '/v1/proposals', SAM, { source: REPORT, mentions: [{ key: 'm1', text: 'Tern' }], observations: [{ key: 'o1', about: 'm9', property: 'flag', value: 'Panama' }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/isn’t one of the mentions/);
  });
});
