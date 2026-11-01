import { callerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { People } from './people.ts';
import type { Embed } from './resolve.ts';
import { PgAtlasStore } from './store.ts';

const people: People = {
  principals: async (person) => (person === 'sam' ? ['person:sam', 'team:t-mar', 'tree:t-mar', 'org'] : [`person:${person}`, 'org']),
  teamPath: async (team) => [team],
  teamNames: async (ids) => new Map(ids.filter((id) => id === 't-mar').map((id) => [id, 'Maritime desk'])),
};
const on = (id: string, workspace: CallerWorkspace): Caller => ({ id, name: id, departments: [], roles: [], workspace });
const ORG: CallerWorkspace = { id: 'w-org', kind: 'org', role: 'member' };
const SAM = on('sam', { id: 't-mar', kind: 'team', role: 'member' });
const SAM_LEAD = on('sam', { id: 't-mar', kind: 'team', role: 'lead' });
const REPORT = { kind: 'document', document: { app: 'folio', id: 'd9', title: 'Port report' } } as const;

/** Meaning, as far as these tests need it: seabirds are terns, carriers are shipping lines. */
const TOPICS = [/tern|seabird/i, /shipping|carrier|line\b/i];
const meaningOf = (text: string) => {
  const v = TOPICS.map((t) => (t.test(text) ? 1 : 0));
  v.push(v.some(Boolean) ? 0 : 1);
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
};

describe.runIf(process.env.DATABASE_URL)('Resolve', () => {
  let store: PgAtlasStore;
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const embedded: { texts: string[]; workspace?: string }[] = [];
  const embed: Embed = async (texts, workspace) => {
    embedded.push({ texts, workspace });
    return { vectors: texts.map(meaningOf), model: 'test-meaning' };
  };
  const start = async (options: { embed?: Embed } = {}) => {
    const app = await buildApp({ store, people, audit: async () => undefined, ...options });
    apps.push(app);
    return (method: 'POST' | 'GET', url: string, caller: Caller, payload?: object) => app.inject({ method, url, headers: callerHeaders(caller), ...(payload ? { payload } : {}) });
  };
  let tern: { id: string };

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query('drop schema if exists atlas cascade');
    await admin.end();
    store = await PgAtlasStore.connect(process.env.DATABASE_URL!);
    const call = await start();
    tern = (await call('POST', '/v1/entities', on('ana', ORG), { type: 'vessel', label: 'Northern Tern', aliases: ['Nordic Tern'] })).json();
    await call('POST', '/v1/entities', on('ana', ORG), { type: 'vessel', label: 'Grey Heron' });
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await store?.close();
  });

  it('has the extensions it matches with in the test database', () => {
    expect(store.can).toEqual({ spelling: true, meaning: true });
  });

  it('suggests names spelt nearly alike, saying which name and how close, and says matching by meaning is off without the gateway', async () => {
    const call = await start();
    const made = (await call('POST', '/v1/proposals', SAM, { source: REPORT, mentions: [{ key: 'm1', text: 'N. Tern', type: 'vessel' }] })).json();
    expect(made.mentions[0].matches).toEqual([expect.objectContaining({ why: 'similar', detail: 'Northern Tern', score: expect.any(Number), entity: expect.objectContaining({ id: tern.id }) })]);
    expect(made.matching).toMatchObject({ spelling: true, meaning: false, why: expect.stringContaining('MODELS_URL') });
  });

  it('suggests by meaning once entities have vectors, from the floors in sight, after keys, names and spellings', async () => {
    const call = await start({ embed });
    const made = (await call('POST', '/v1/proposals', SAM, { source: REPORT, mentions: [{ key: 'm1', text: 'the seabird', type: 'vessel' }] })).json();
    expect(made.matching).toMatchObject({ spelling: true, meaning: true });
    expect(made.matching.why).toBeUndefined();
    expect(made.mentions[0].matches).toEqual([expect.objectContaining({ why: 'meaning', score: 1, entity: expect.objectContaining({ id: tern.id }) })]);
    // The mention went with its kind; each entity with its name, kind and other names, as the floor it's kept on.
    expect(embedded[0]).toEqual({ texts: ['the seabird (Vessel)'], workspace: 't-mar' });
    expect(embedded[1].texts).toContain('Northern Tern (Vessel). also Nordic Tern');
    expect(embedded[1].workspace).toBe('w-org');
    // Kept: the next proposal embeds only what it brings.
    embedded.length = 0;
    await call('POST', '/v1/proposals', SAM, { source: REPORT, mentions: [{ key: 'm1', text: 'Grey Heron' }] });
    expect(embedded).toEqual([{ texts: ['Grey Heron'], workspace: 't-mar' }]);
  });

  it('says why when the gateway refuses, in its own words', async () => {
    const refusing: Embed = async () => {
      throw new Error('Could not turn text into vectors: it answered 403: Models are turned off. An admin can turn them on in Admin.');
    };
    const call = await start({ embed: refusing });
    const made = (await call('POST', '/v1/proposals', SAM, { source: REPORT, mentions: [{ key: 'm1', text: 'N. Tern' }] })).json();
    expect(made.matching).toMatchObject({ spelling: true, meaning: false, why: 'Matching by meaning is off: Models are turned off. An admin can turn them on in Admin.' });
    // Spelling still found it.
    expect(made.mentions[0].matches).toHaveLength(1);
  });

  it('looks again for a lead, finding what was added since', async () => {
    const call = await start({ embed });
    const made = (await call('POST', '/v1/proposals', SAM, { source: REPORT, mentions: [{ key: 'm1', text: 'Halden Shipping', type: 'organization' }] })).json();
    expect(made.mentions[0].matches).toEqual([]);
    const halden = (await call('POST', '/v1/entities', on('ana', ORG), { type: 'organization', label: 'Halden Shipping Ltd' })).json();
    expect((await call('POST', `/v1/proposals/${made.id}/match`, SAM)).statusCode).toBe(403);
    const again = await call('POST', `/v1/proposals/${made.id}/match`, SAM_LEAD);
    expect(again.statusCode).toBe(200);
    expect(again.json().mentions[0].matches[0]).toMatchObject({ why: 'similar', detail: 'Halden Shipping Ltd', entity: { id: halden.id } });
  });
});
