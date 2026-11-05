import { callerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { People } from './people.ts';
import { PgAtlasStore } from './store.ts';

const people: People = {
  principals: async (person) => [`person:${person}`, 'team:t-mar', 'tree:t-mar', 'org'],
  teamPath: async (team) => [team],
  teamNames: async (ids) => new Map(ids.filter((id) => id === 't-mar').map((id) => [id, 'Maritime desk'])),
};
const on = (id: string, workspace: CallerWorkspace): Caller => ({ id, name: id, departments: [], roles: [], workspace });
const LEAD = on('sam', { id: 't-mar', kind: 'team', role: 'lead' });
const MEMBER = on('kim', { id: 't-mar', kind: 'team', role: 'member' });
const invoice = (id: string) => ({ kind: 'document', document: { app: 'folio', id, title: `Invoice ${id}` } });

describe.runIf(process.env.DATABASE_URL)('Merging entities found to be the same', () => {
  let store: PgAtlasStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const call = (method: 'GET' | 'POST', url: string, caller: Caller, payload?: object) => app.inject({ method, url, headers: callerHeaders(caller), ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    app = await buildApp({ store, people, audit: async () => undefined });
  });
  afterAll(async () => {
    await app?.close();
    await store?.close();
  });

  it('places one under the other with its evidence, moves nothing, and undoes it exactly, naming what misled it', async () => {
    const tern = (await call('POST', '/v1/entities', LEAD, { type: 'vessel', label: 'Northern Tern' })).json();
    const copy = (await call('POST', '/v1/entities', LEAD, { type: 'vessel', label: 'N. Tern' })).json();
    const said = (await call('POST', `/v1/entities/${copy.id}/observations`, LEAD, { property: 'flag', value: 'Liberia', source: invoice('d-1') })).json().observation;
    const against = (await call('POST', `/v1/entities/${tern.id}/observations`, LEAD, { property: 'flag', value: 'Panama', source: invoice('d-2') })).json().observation;
    const before = await store.unsent();

    // Only the floor's leads, or whoever added it, decide what it is.
    expect((await call('POST', `/v1/entities/${copy.id}/merge`, MEMBER, { into: tern.id, why: 'Same ship' })).statusCode).toBe(403);
    // Evidence must be about one of the two.
    const stray = (await call('POST', '/v1/entities', LEAD, { type: 'vessel', label: 'Gull' })).json();
    const strayObs = (await call('POST', `/v1/entities/${stray.id}/observations`, LEAD, { property: 'flag', value: 'Malta', source: invoice('d-3') })).json().observation;
    expect((await call('POST', `/v1/entities/${copy.id}/merge`, LEAD, { into: tern.id, why: 'Same ship', cites: [{ observation: strayObs.id, stance: 'for' }] })).json()).toMatchObject({ error: 'bad-cite' });

    const made = await call('POST', `/v1/entities/${copy.id}/merge`, LEAD, {
      into: tern.id,
      why: 'The invoice names the same IMO number',
      cites: [
        { observation: said.id, stance: 'for', note: 'Same owner on the invoice' },
        { observation: against.id, stance: 'against', note: 'A different flag' },
      ],
    });
    expect(made.statusCode).toBe(201);
    const merge = made.json();
    expect(merge).toMatchObject({ junior: copy.id, senior: tern.id, floor: 'tree:t-mar', why: 'The invoice names the same IMO number', decidedBy: 'sam' });
    expect(merge.cites).toEqual(expect.arrayContaining([expect.objectContaining({ observation: said.id, stance: 'for' }), expect.objectContaining({ observation: against.id, stance: 'against' })]));
    // It can't be placed under a second entity while the first merge stands.
    expect((await call('POST', `/v1/entities/${copy.id}/merge`, LEAD, { into: stray.id, why: 'Or this one' })).statusCode).toBe(409);

    // The junior is out of use but kept, with everything said of it.
    const merged = (await call('GET', `/v1/entities/${copy.id}`, LEAD)).json();
    expect(merged).toMatchObject({ state: 'merged', can: { edit: false, retire: false } });
    expect(merged.can.why).toMatch(/placed under it/);
    expect((await call('GET', `/v1/entities/${copy.id}/merges`, LEAD)).json().placedUnder).toMatchObject({ id: merge.id, senior: tern.id });
    expect((await call('GET', `/v1/entities/${tern.id}/merges`, LEAD)).json()).toMatchObject({ merges: [expect.objectContaining({ id: merge.id, junior: copy.id })] });
    expect((await call('GET', '/v1/entities', LEAD)).json().entities.map((e: { id: string }) => e.id)).not.toContain(copy.id);
    expect((await call('POST', `/v1/entities/${copy.id}/observations`, LEAD, { property: 'flag', value: 'Togo', source: invoice('d-4') })).json()).toMatchObject({ error: 'merged' });

    // Undo: only what the merge was made on can be named as having misled it.
    expect((await call('POST', `/v1/merges/${merge.id}/undo`, LEAD, { why: 'Two ships', discredit: [against.id] })).json()).toMatchObject({ error: 'not-cited' });
    expect((await call('GET', `/v1/entities/${copy.id}`, LEAD)).json().state).toBe('merged');
    const undone = await call('POST', `/v1/merges/${merge.id}/undo`, LEAD, { why: 'Two ships: the invoice quoted the wrong number', discredit: [said.id] });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().undone).toMatchObject({ by: 'sam', why: 'Two ships: the invoice quoted the wrong number', discredited: [said.id] });
    expect((await call('POST', `/v1/merges/${merge.id}/undo`, LEAD, { why: 'Again' })).json()).toMatchObject({ error: 'not-standing' });

    // Back exactly as it was, same id, and the misleading observation kept, saying so.
    const back = (await call('GET', `/v1/entities/${copy.id}`, LEAD)).json();
    expect(back).toMatchObject({ id: copy.id, label: 'N. Tern', state: 'active' });
    const known = (await call('GET', `/v1/entities/${copy.id}/knowledge`, LEAD)).json();
    expect(known.observations.find((o: { id: string }) => o.id === said.id)).toMatchObject({ value: 'Liberia', discredited: { by: 'sam', why: 'Two ships: the invoice quoted the wrong number' } });
    // The merge stays on record, undone.
    expect((await call('GET', `/v1/entities/${copy.id}/merges`, LEAD)).json()).toEqual({ merges: [expect.objectContaining({ id: merge.id, undone: expect.objectContaining({ by: 'sam' }) })] });

    // Other apps hear both.
    expect((await store.unsent()).slice(before.length).filter((e) => e.topic === 'atlas.entity.merged' || e.topic === 'atlas.entity.split')).toEqual([
      { topic: 'atlas.entity.merged', workspace: 't-mar', payload: { entity: copy.id, into: tern.id, merge: merge.id, type: 'vessel' } },
      { topic: 'atlas.entity.split', workspace: 't-mar', payload: { entity: copy.id, from: tern.id, merge: merge.id, type: 'vessel' } },
    ]);
  });

  it('merges only things of the same kind, never one into itself', async () => {
    const ship = (await call('POST', '/v1/entities', LEAD, { type: 'vessel', label: 'Petrel' })).json();
    const firm = (await call('POST', '/v1/entities', LEAD, { type: 'organization', label: 'Petrel Shipping' })).json();
    expect((await call('POST', `/v1/entities/${ship.id}/merge`, LEAD, { into: ship.id, why: 'Itself' })).json()).toMatchObject({ error: 'same-entity' });
    expect((await call('POST', `/v1/entities/${ship.id}/merge`, LEAD, { into: firm.id, why: 'Same name' })).json()).toMatchObject({ error: 'different-types' });
  });
});
