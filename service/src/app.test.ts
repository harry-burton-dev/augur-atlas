import { callerCheckFor, callerHeaders, callerSigner, signedCallerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { AtlasAuditEntry } from './audit.ts';
import type { People } from './people.ts';
import { PgAtlasStore } from './store.ts';

// The org has Operations, with the Maritime desk under it, and Finance beside it.
// Sam is on the Maritime desk (so also under Operations), Ana on Operations only, Lee on Finance.
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

const person = (id: string): Caller => ({ id, name: id, departments: [], roles: [] });
const on = (id: string, workspace: CallerWorkspace): Caller => ({ ...person(id), workspace });
const team = (id: string, role: CallerWorkspace['role'] = 'member'): CallerWorkspace => ({ id, kind: 'team', role });
const ORG: CallerWorkspace = { id: 'w-org', kind: 'org', role: 'member' };
const own = (who: string): CallerWorkspace => ({ id: `w-${who}`, kind: 'personal', role: 'lead' });

describe.runIf(process.env.DATABASE_URL)('Data Atlas', () => {
  let store: PgAtlasStore;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const audited: AtlasAuditEntry[] = [];
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, caller?: Caller, payload?: object) =>
    app.inject({ method, url, headers: caller ? callerHeaders(caller) : {}, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    // A fresh schema each run: these tests own it.
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    app = await buildApp({ store, people, audit: async (entry) => void audited.push(entry) });
  });
  afterAll(async () => {
    await app?.close();
    await store?.close();
  });

  it('starts from the Common Core Ontologies starter profile', async () => {
    const res = await call('GET', '/v1/ontology', on('sam', ORG));
    expect(res.statusCode).toBe(200);
    const ontology = res.json();
    expect(ontology.version).toBe(2);
    expect(ontology.relations.find((r: { key: string }) => r.key === 'operated-by')).toMatchObject({ label: 'Operated by', inverse: 'Operates', from: ['artifact', 'facility'], to: ['agent'] });
    const vessel = ontology.types.find((t: { key: string }) => t.key === 'vessel');
    expect(vessel).toMatchObject({ label: 'Vessel', parent: 'vehicle', pack: 'cco', packTerm: 'Watercraft', abstract: false });
    expect(vessel.details.map((d: { key: string }) => d.key)).toEqual(['imo', 'mmsi', 'call-sign', 'flag', 'vessel-type']);
    expect(vessel.details.find((d: { key: string }) => d.key === 'flag').onEntity).toBe(false);
    expect(ontology.types.find((t: { key: string }) => t.key === 'agent').abstract).toBe(true);
  });

  it('adds an entity on the floor you stand on, tidying its details', async () => {
    const res = await call('POST', '/v1/entities', on('sam', team('t-mar')), {
      type: 'vessel',
      label: ' Northern Tern ',
      aliases: ['N. Tern', 'Nordic Tern'],
      details: { imo: '9 400 117', 'call-sign': 'd5rt2' },
    });
    expect(res.statusCode).toBe(201);
    const tern = res.json();
    expect(tern).toMatchObject({ type: 'vessel', label: 'Northern Tern', floor: 'tree:t-mar', floorName: 'Maritime desk', details: { imo: '9400117', 'call-sign': 'D5RT2' }, state: 'active' });
    expect(tern.id).toMatch(/^ent_[0-9A-Z]{26}$/);
    expect(tern.can).toEqual({ edit: true, retire: true });
    expect(audited.at(-1)).toMatchObject({ actor: 'sam', action: 'entity.created', target: tern.id, workspace: 't-mar' });
  });

  it('says what is wrong with an entity it refuses', async () => {
    const sam = on('sam', team('t-mar'));
    const abstract = await call('POST', '/v1/entities', sam, { type: 'vehicle', label: 'Something' });
    expect(abstract.statusCode).toBe(400);
    expect(abstract.json().message).toMatch(/heading for other kinds/);
    const unknown = await call('POST', '/v1/entities', sam, { type: 'vessel', label: 'X', details: { colour: 'grey' } });
    expect(unknown.json().message).toMatch(/no detail called “colour”/);
    const bad = await call('POST', '/v1/entities', sam, { type: 'vessel', label: 'X', details: { imo: '12345' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/IMO number doesn’t look right: seven digits/);
  });

  describe('fenced by floor', () => {
    let mar: string;
    let mine: string;
    let orgPort: string;
    beforeAll(async () => {
      mar = (await call('POST', '/v1/entities', on('sam', team('t-mar')), { type: 'person', label: 'Capt. R. Imrie' })).json().id;
      mine = (await call('POST', '/v1/entities', on('sam', own('sam')), { type: 'place', label: 'Kessby anchorage', description: 'My guess' })).json().id;
      orgPort = (await call('POST', '/v1/entities', on('ana', ORG), { type: 'port', label: 'Port Halden', details: { unlocode: 'xxhal' } })).json().id;
    });

    it('shows a floor its own and every floor above it', async () => {
      const ids = async (caller: Caller) => (await call('GET', '/v1/entities?limit=200', caller)).json().entities.map((e: { id: string }) => e.id);
      expect(await ids(on('sam', team('t-mar')))).toEqual(expect.arrayContaining([mar, orgPort]));
      expect(await ids(on('sam', team('t-mar')))).not.toContain(mine);
      expect((await call('GET', '/v1/entities', on('sam', team('t-mar')))).json().seeing).toEqual(['Org', 'Operations', 'Maritime desk']);
      // From Operations, above the Maritime desk, the desk's knowledge doesn't show.
      expect(await ids(on('sam', team('t-ops')))).not.toContain(mar);
      // Your own floor shows every level you belong to.
      expect(await ids(on('sam', own('sam')))).toEqual(expect.arrayContaining([mar, mine, orgPort]));
      // The org floor shows only the org's.
      const fromOrg = await ids(on('sam', ORG));
      expect(fromOrg).toContain(orgPort);
      expect(fromOrg).not.toContain(mar);
    });

    it('explains why something does not show, instead of hiding that it exists', async () => {
      const fromAbove = await call('GET', `/v1/entities/${mar}`, on('sam', team('t-ops')));
      expect(fromAbove.statusCode).toBe(403);
      expect(fromAbove.json()).toMatchObject({ error: 'unseen', reason: 'elsewhere', floor: 'tree:t-mar' });
      expect(fromAbove.json().message).toMatch(/kept on the Maritime desk floor, so it doesn’t show from here/);
      const notHers = await call('GET', `/v1/entities/${mar}`, on('ana', team('t-ops')));
      expect(notHers.json()).toMatchObject({ reason: 'kept' });
      expect(notHers.json().message).toMatch(/Ask one of its leads/);
      const someoneElses = await call('GET', `/v1/entities/${mine}`, on('lee', own('lee')));
      expect(someoneElses.json().message).toMatch(/only its owner can see/);
      const ownFromOrg = await call('GET', `/v1/entities/${mine}`, on('sam', ORG));
      expect(ownFromOrg.json().message).toMatch(/Go to your own floor to see it/);
      expect((await call('GET', '/v1/entities/ent_nothing', on('sam', ORG))).statusCode).toBe(404);
    });

    it('lets only the floor it is kept on change it, and says so', async () => {
      const fromOwn = await call('GET', `/v1/entities/${mar}`, on('sam', own('sam')));
      expect(fromOwn.json().can).toMatchObject({ edit: false, why: 'It’s kept on the Maritime desk floor: go there to change it.' });
      const refused = await call('PATCH', `/v1/entities/${mar}`, on('sam', own('sam')), { label: 'Captain Imrie' });
      expect(refused.statusCode).toBe(403);
      const changed = await call('PATCH', `/v1/entities/${mar}`, on('sam', team('t-mar')), { label: 'Captain R. Imrie', aliases: ['Imrie'] });
      expect(changed.json()).toMatchObject({ label: 'Captain R. Imrie', aliases: ['Imrie'], updatedBy: 'sam' });
    });

    it('finds by name, other name, identity key and kind', async () => {
      const sam = on('sam', own('sam'));
      const find = async (query: string) => (await call('GET', `/v1/entities?${query}`, sam)).json().entities.map((e: { label: string }) => e.label);
      expect(await find('q=nordic')).toEqual(['Northern Tern']);
      expect(await find('q=9400 117')).toEqual(['Northern Tern']);
      expect(await find('q=XXHAL')).toEqual(['Port Halden']);
      expect(await find('type=vehicle')).toEqual(['Northern Tern']);
      expect(await find('type=agent')).toEqual(['Captain R. Imrie']);
      expect(await find('type=agent&type=vessel')).toEqual(['Captain R. Imrie', 'Northern Tern']);
    });
  });

  it('keeps an identity key to one entity, naming the holder only to those who may see it', async () => {
    const add = (caller: Caller) => call('POST', '/v1/entities', caller, { type: 'vessel', label: 'Tern', details: { imo: '9400117' } });
    const seen = await add(on('sam', own('sam')));
    expect(seen.statusCode).toBe(409);
    expect(seen.json()).toMatchObject({ error: 'key-taken', holder: { label: 'Northern Tern' } });
    expect(seen.json().message).toMatch(/IMO number 9400117 is already Northern Tern/);
    const hidden = await add(on('ana', ORG));
    expect(hidden.statusCode).toBe(409);
    expect(hidden.json().holder).toMatchObject({ hidden: true, reason: 'kept' });
    expect(hidden.json().holder.label).toBeUndefined();
    expect(hidden.json().message).toMatch(/already another entity’s. It’s kept on the Maritime desk floor/);
  });

  it('retires an entity for its floor’s leads or its maker, freeing its keys', async () => {
    const kim = (await call('POST', '/v1/entities', on('ana', team('t-ops')), { type: 'vessel', label: 'Grey Heron', details: { imo: '9111111' } })).json();
    const member = await call('POST', `/v1/entities/${kim.id}/retire`, on('bo', team('t-ops')));
    expect(member.statusCode).toBe(403);
    expect(member.json().message).toMatch(/leads, or whoever added it/);
    const lead = await call('POST', `/v1/entities/${kim.id}/retire`, on('ana', team('t-ops', 'lead')));
    expect(lead.json()).toMatchObject({ state: 'retired', can: { edit: false, retire: false } });
    expect(audited.at(-1)).toMatchObject({ action: 'entity.retired', target: kim.id });
    const again = await call('POST', '/v1/entities', on('ana', team('t-ops')), { type: 'vessel', label: 'Grey Heron', details: { imo: '9111111' } });
    expect(again.statusCode).toBe(201);
  });

  it('resolves entity links as the caller sees them, saying why one doesn’t show', async () => {
    const add = async (caller: Caller, label: string) => (await call('POST', '/v1/entities', caller, { type: 'port', label })).json();
    const felix = await add(on('ana', ORG), 'Felixstowe');
    const ledger = await add(on('lee', team('t-fin')), 'Finance port');
    const res = await call('POST', '/v1/entities/resolve', on('sam', team('t-mar')), {
      refs: [{ kind: 'entity', id: felix.id, type: 'port', label: 'Old name' }, { id: ledger.id }, { id: 'ent_01JBX7Q2W3E4R5T6Y7V8H9Q0PA' }, { id: felix.id }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entities).toEqual([
      { id: felix.id, ref: { kind: 'entity', id: felix.id, type: 'port', label: 'Felixstowe' }, state: 'active', floorName: 'Org' },
      { id: ledger.id, hidden: true, reason: 'kept', floor: 'tree:t-fin', message: expect.stringMatching(/Finance floor.*Ask one of its leads/) },
      { id: 'ent_01JBX7Q2W3E4R5T6Y7V8H9Q0PA', missing: true, message: 'There’s no such entity.' },
    ]);
    const empty = await call('POST', '/v1/entities/resolve', on('sam', team('t-mar')), { refs: [] });
    expect(empty.statusCode).toBe(400);
  });

  it('answers a subgraph from where the caller stands, with the seeds it can’t show and why', async () => {
    const felix = (await call('POST', '/v1/entities', on('ana', ORG), { type: 'port', label: 'Harwich' })).json();
    const mine = (await call('POST', '/v1/entities', on('sam', own('sam')), { type: 'person', label: 'A contact' })).json();
    const res = await call('POST', '/v1/subgraph', on('sam', ORG), { seeds: [{ id: felix.id }, { id: mine.id }, { id: 'ent_nope' }], depth: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      nodes: [{ ref: { kind: 'entity', id: felix.id, type: 'port', label: 'Harwich' }, state: 'active', floorName: 'Org', depth: 0 }],
      edges: [],
      more: [],
      unseen: [{ id: mine.id, reason: 'elsewhere', floor: 'person:sam', message: expect.any(String), near: [] }],
      missing: ['ent_nope'],
    });
    // Kinds narrow what the walk reaches; the seeds it starts from still show.
    const ports = await call('POST', '/v1/subgraph', on('sam', own('sam')), { seeds: [{ id: felix.id }, { id: mine.id }], types: ['facility'] });
    expect(ports.json().nodes.map((n: { ref: { id: string } }) => n.ref.id)).toEqual([felix.id, mine.id]);
    const deep = await call('POST', '/v1/subgraph', on('sam', ORG), { seeds: [{ id: felix.id }], depth: 4 });
    expect(deep.statusCode).toBe(400);
  });

  it('tells other apps what changed, by id only, once the change commits', async () => {
    const before = (await store.unsent()).length;
    const gull = (await call('POST', '/v1/entities', on('sam', team('t-mar')), { type: 'vessel', label: 'Gull' })).json();
    await call('PATCH', `/v1/entities/${gull.id}`, on('sam', team('t-mar')), { label: 'Grey Gull' });
    await call('POST', `/v1/entities/${gull.id}/retire`, on('sam', team('t-mar')));
    const refused = await call('POST', '/v1/entities', on('sam', team('t-mar')), { type: 'vessel', label: 'Copy', details: { imo: '9400117' } });
    expect(refused.statusCode).toBe(409);
    expect((await store.unsent()).slice(before)).toEqual(
      ['created', 'changed', 'retired'].map((what) => ({ topic: `atlas.entity.${what}`, workspace: 't-mar', payload: { entity: gull.id, type: 'vessel' } })),
    );
  });

  it('needs a floor to stand on', async () => {
    const res = await call('GET', '/v1/entities', person('sam'));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/what shows depends on it/);
  });

  it('believes only the caller the gateway signed for it', async () => {
    const gateway = callerSigner();
    const signedApp = await buildApp({ store, people, callers: callerCheckFor(gateway, 'atlas'), audit: async () => {} });
    const sam = on('sam', ORG);
    const signed = await signedApp.inject({ remoteAddress: '172.18.0.9', method: 'GET', url: '/v1/ontology', headers: await signedCallerHeaders(gateway, sam, 'atlas') });
    expect(signed.statusCode).toBe(200);
    const forged = await signedApp.inject({ remoteAddress: '172.18.0.9', method: 'GET', url: '/v1/ontology', headers: callerHeaders(sam) });
    expect(forged.statusCode).toBe(401);
    await signedApp.close();
  });

  it('reports healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toMatchObject({ status: 'ok', service: 'atlas', api: 'v1' });
  });
});
