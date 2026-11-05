import { callerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { People } from './people.ts';
import { PgAtlasStore } from './store.ts';

const NAMES = new Map([
  ['t-mar', 'Maritime desk'],
  ['t-ops', 'Operations'],
]);
const people: People = {
  principals: async (person) => [`person:${person}`, 'team:t-mar', 'tree:t-mar', 'tree:t-ops', 'org'],
  teamPath: async (team) => (team === 't-mar' ? ['t-ops', 't-mar'] : [team]),
  teamNames: async (ids) => new Map(ids.filter((id) => NAMES.has(id)).map((id) => [id, NAMES.get(id)!])),
  orgName: async () => 'Harbour Group',
};
const on = (id: string, workspace: CallerWorkspace): Caller => ({ id, name: id, departments: [], roles: [], workspace });
const LEAD = on('sam', { id: 't-mar', kind: 'team', role: 'lead' });
const MEMBER = on('kim', { id: 't-mar', kind: 'team', role: 'member' });
const ORG_LEAD = on('ana', { id: 'w-org', kind: 'org', role: 'lead' });
const ORG_MEMBER = on('lee', { id: 'w-org', kind: 'org', role: 'member' });
const invoice = (id: string) => ({ kind: 'document', document: { app: 'folio', id, title: `Invoice ${id}` } });

describe.runIf(process.env.DATABASE_URL)('Raising an entity card to a floor above', () => {
  let store: PgAtlasStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const audited: string[] = [];
  const call = (method: 'GET' | 'POST', url: string, caller: Caller, payload?: object) => app.inject({ method, url, headers: callerHeaders(caller), ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    app = await buildApp({ store, people, audit: async (entry) => void audited.push(entry.action) });
  });
  afterAll(async () => {
    await app?.close();
    await store?.close();
  });

  it('asks the floor above, whose leads keep the card there while what’s known stays below', async () => {
    const tern = (await call('POST', '/v1/entities', LEAD, { type: 'vessel', label: 'Northern Tern' })).json();
    await call('POST', `/v1/entities/${tern.id}/observations`, LEAD, { property: 'flag', value: 'Liberia', source: invoice('d-1') });

    // Where it can go, and who may ask.
    const offered = (await call('GET', `/v1/entities/${tern.id}/raises`, LEAD)).json();
    expect(offered).toMatchObject({ ask: true, raises: [] });
    expect(offered.to.map((t: { name: string }) => t.name).sort()).toEqual(['Harbour Group', 'Operations']);
    expect((await call('GET', `/v1/entities/${tern.id}/raises`, MEMBER)).json()).toMatchObject({ ask: false, why: expect.stringMatching(/leads ask/) });
    expect((await call('POST', `/v1/entities/${tern.id}/raise`, MEMBER, { to: 'org' })).statusCode).toBe(403);
    expect((await call('POST', `/v1/entities/${tern.id}/raise`, LEAD, { to: 'tree:t-fin' })).json()).toMatchObject({ error: 'not-above' });

    const asked = await call('POST', `/v1/entities/${tern.id}/raise`, LEAD, { to: 'org', note: 'Every desk tracks it' });
    expect(asked.statusCode).toBe(201);
    expect(asked.json()).toMatchObject({ state: 'waiting', fromName: 'Maritime desk', toName: 'Harbour Group', card: { label: 'Northern Tern' }, can: { decide: false, withdraw: true } });
    expect((await call('POST', `/v1/entities/${tern.id}/raise`, LEAD, { to: 'tree:t-ops' })).json()).toMatchObject({ error: 'waiting' });

    // The org floor's Triage shows it, though the card below doesn't show from there yet.
    const waiting = (await call('GET', '/v1/raises', ORG_LEAD)).json();
    expect(waiting).toMatchObject({ decide: true, raises: [{ id: asked.json().id, card: { label: 'Northern Tern', floorName: 'Maritime desk' }, can: { decide: true } }] });
    expect((await call('GET', '/v1/raises', ORG_MEMBER)).json()).toMatchObject({ decide: false, raises: [{ can: { decide: false, why: expect.stringMatching(/leads decide/) } }] });
    expect((await call('POST', `/v1/raises/${asked.json().id}/decide`, ORG_MEMBER, { as: 'keep' })).statusCode).toBe(403);
    expect((await call('POST', `/v1/raises/${asked.json().id}/decide`, LEAD, { as: 'keep' })).json()).toMatchObject({ error: 'cannot-decide' });
    expect((await call('GET', `/v1/entities/${tern.id}`, ORG_LEAD)).statusCode).toBe(403);

    const kept = await call('POST', `/v1/raises/${asked.json().id}/decide`, ORG_LEAD, { as: 'keep' });
    expect(kept.json()).toMatchObject({ state: 'kept', decidedBy: 'ana' });
    expect((await call('GET', `/v1/entities/${tern.id}`, ORG_LEAD)).json()).toMatchObject({ floor: 'org', floorName: 'Harbour Group', floorKind: 'org' });
    // What was known of it stays on the floor it was recorded on.
    const known = (await call('GET', `/v1/entities/${tern.id}/knowledge`, LEAD)).json();
    expect(known.observations).toEqual([expect.objectContaining({ value: 'Liberia', floor: 'tree:t-mar' })]);
    expect((await call('GET', `/v1/entities/${tern.id}/knowledge`, ORG_LEAD)).json().observations).toEqual([]);
    expect((await store.unsent()).some((e) => e.topic === 'atlas.entity.changed' && (e.payload as { entity: string }).entity === tern.id)).toBe(true);
    expect(audited).toEqual(expect.arrayContaining(['entity.raise-asked', 'entity.raised']));
  });

  it('declines with a note, lets whoever asked withdraw, and merges into one the floor above already has', async () => {
    const gull = (await call('POST', '/v1/entities', LEAD, { type: 'vessel', label: 'Grey Gull' })).json();
    const first = (await call('POST', `/v1/entities/${gull.id}/raise`, LEAD, { to: 'org' })).json();
    expect((await call('POST', `/v1/raises/${first.id}/decide`, ORG_LEAD, { as: 'decline' })).json()).toMatchObject({ error: 'note-needed' });
    expect((await call('POST', `/v1/raises/${first.id}/decide`, ORG_LEAD, { as: 'decline', note: 'Keep it on the desk for now' })).json()).toMatchObject({ state: 'declined', answer: 'Keep it on the desk for now' });
    expect((await call('GET', `/v1/entities/${gull.id}`, LEAD)).json()).toMatchObject({ floor: 'tree:t-mar' });

    const second = (await call('POST', `/v1/entities/${gull.id}/raise`, LEAD, { to: 'org' })).json();
    expect((await call('POST', `/v1/raises/${second.id}/withdraw`, ORG_LEAD)).statusCode).toBe(403);
    expect((await call('POST', `/v1/raises/${second.id}/withdraw`, LEAD)).json()).toMatchObject({ state: 'withdrawn' });

    const theirs = (await call('POST', '/v1/entities', ORG_LEAD, { type: 'vessel', label: 'MV Grey Gull' })).json();
    const third = (await call('POST', `/v1/entities/${gull.id}/raise`, LEAD, { to: 'org' })).json();
    const same = await call('POST', `/v1/raises/${third.id}/decide`, ORG_LEAD, { as: 'same', entity: theirs.id, why: 'Same ship, our record' });
    expect(same.json()).toMatchObject({ state: 'merged', mergedInto: theirs.id });
    expect((await call('GET', `/v1/entities/${gull.id}`, ORG_LEAD)).json()).toMatchObject({ floor: 'org', state: 'merged' });
    expect((await call('GET', `/v1/entities/${gull.id}/merges`, ORG_LEAD)).json()).toMatchObject({ placedUnder: { senior: theirs.id, why: 'Same ship, our record' } });
    expect((await call('GET', `/v1/entities/${gull.id}/raises`, LEAD)).json().raises.map((r: { state: string }) => r.state)).toEqual(['merged', 'withdrawn', 'declined']);
  });
});
