import { callerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { follower } from './follow.ts';
import type { People } from './people.ts';
import { PgAtlasStore } from './store.ts';

const people: People = {
  principals: async (person) => (person === 'sam' ? ['person:sam', 'team:t-mar', 'tree:t-mar', 'org'] : [`person:${person}`, 'org']),
  teamPath: async (team) => [team],
  teamNames: async (ids) => new Map(ids.filter((id) => id === 't-ops').map((id) => [id, 'Ops planning'])),
};
const on = (id: string, workspace: CallerWorkspace): Caller => ({ id, name: id, departments: [], roles: [], workspace });
const SAM_LEAD = on('sam', { id: 't-mar', kind: 'team', role: 'lead' });
const report = (id: string) => ({ kind: 'document', document: { app: 'folio', id, title: `Report ${id}` } });

describe.runIf(process.env.DATABASE_URL)('Following other apps', () => {
  let store: PgAtlasStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let handle: ReturnType<typeof follower>;
  const call = (method: 'GET' | 'POST', url: string, caller: Caller, payload?: object) => app.inject({ method, url, headers: callerHeaders(caller), ...(payload ? { payload } : {}) });
  let tern: { id: string };

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    app = await buildApp({ store, people, audit: async () => undefined });
    handle = follower(store);
    tern = (await call('POST', '/v1/entities', SAM_LEAD, { type: 'vessel', label: 'Northern Tern' })).json();
  });
  afterAll(async () => {
    await app?.close();
    await store?.close();
  });

  it('lists the intents bound to an entity from Mandate’s events, naming where each is kept, and forgets unbound ones', async () => {
    const bound = { topic: 'mandate.intent.entity-bound', workspace: { id: 't-ops', path: [] }, payload: { intent: 'int_1', entity: tern.id, role: 'subject' } };
    await handle(bound);
    await handle(bound);
    await handle({ ...bound, payload: { intent: 'int_2', entity: tern.id, role: 'resource' }, workspace: { id: 't-mar', path: [] } });
    const used = (await call('GET', `/v1/entities/${tern.id}/used-by`, SAM_LEAD)).json();
    expect(used.intents).toEqual([expect.objectContaining({ id: 'int_2', role: 'resource' }), expect.objectContaining({ id: 'int_1', role: 'subject', floorName: 'Ops planning' })]);
    await handle({ topic: 'mandate.intent.entity-unbound', workspace: { id: 't-ops', path: [] }, payload: { intent: 'int_1', entity: tern.id, role: 'subject' } });
    expect((await call('GET', `/v1/entities/${tern.id}/used-by`, SAM_LEAD)).json().intents.map((i: { id: string }) => i.id)).toEqual(['int_2']);
  });

  it('retracts what was read from a withdrawn document, keeping it and saying so, and nothing new rests on it', async () => {
    const said = (await call('POST', `/v1/entities/${tern.id}/observations`, SAM_LEAD, { property: 'flag', value: 'Liberia', source: report('d-1'), accept: true })).json();
    expect((await call('GET', `/v1/entities/${tern.id}/used-by`, SAM_LEAD)).json().documents).toEqual([expect.objectContaining({ app: 'folio', id: 'd-1', title: 'Report d-1', observations: 1, withdrawn: false })]);

    await handle({ topic: 'folio.document.withdrawn', payload: { document: 'd-1', version: 2 } });
    const known = (await call('GET', `/v1/entities/${tern.id}/knowledge`, SAM_LEAD)).json();
    expect(known.observations[0].retracted).toMatchObject({ why: 'Its source was withdrawn in Artifacts.' });
    expect(known.facts[0].unbacked).toMatch(/Every source it rested on was withdrawn/);
    expect(known.noCurrentSource).toMatch(/no current source/);
    expect((await call('GET', `/v1/entities/${tern.id}/used-by`, SAM_LEAD)).json().documents[0].withdrawn).toBe(true);

    const again = await call('POST', `/v1/entities/${tern.id}/facts`, SAM_LEAD, { backedBy: [said.observation.id] });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toBe('Its source was withdrawn in Artifacts. It’s kept, but can’t back a fact.');
    // The entity stays.
    expect((await call('GET', `/v1/entities/${tern.id}`, SAM_LEAD)).json().state).toBe('active');
  });

  it('tells a waiting proposal its source is gone, so what it says can only be dropped', async () => {
    const p = (
      await call('POST', '/v1/proposals', SAM_LEAD, { source: report('d-2'), mentions: [{ key: 'm1', text: 'Northern Tern', type: 'vessel' }], observations: [{ key: 'o1', about: 'm1', property: 'flag', value: 'Panama' }] })
    ).json();
    await call('POST', `/v1/proposals/${p.id}/mentions/m1`, SAM_LEAD, { as: 'link', entity: tern.id });
    await handle({ topic: 'folio.document.deleted', payload: { document: 'd-2' } });
    const open = (await call('GET', `/v1/proposals/${p.id}`, SAM_LEAD)).json();
    expect(open.sourceGone).toBe('Its source was deleted from Artifacts.');
    const accept = await call('POST', `/v1/proposals/${p.id}/observations/o1`, SAM_LEAD, { as: 'accepted' });
    expect(accept.statusCode).toBe(409);
    expect(accept.json().message).toBe('Its source was deleted from Artifacts. What it says can only be dropped now.');
    expect((await call('POST', `/v1/proposals/${p.id}/observations/o1`, SAM_LEAD, { as: 'drop' })).statusCode).toBe(200);
  });

  it('keeps its place in other apps’ events', async () => {
    expect(await store.eventCursor()).toBeUndefined();
    await store.saveEventCursor('41');
    await store.saveEventCursor('42');
    expect(await store.eventCursor()).toBe('42');
  });
});
