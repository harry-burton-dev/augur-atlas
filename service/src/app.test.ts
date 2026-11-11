import {
  CALLER_TOKEN_HEADER,
  callerAudienceOf,
  callerCheckFor,
  callerHeaders,
  callerOfService,
  callerSigner,
  eventDeliveryKey,
  IDEMPOTENCY_KEY_HEADER,
  packageVersion,
  PART_EVENTS_PATH,
  readManifest,
  signDelegation,
  signedCallerHeaders,
  type DomainEvent,
} from '@augur/service-kit';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { memoryEvents } from './events.ts';
import { memoryFollows } from './follows.ts';
import { memoryUses } from './uses.ts';
import { KnowledgeRefused, memoryKnowledge, type Acted, type Knowledge, type KnowledgeStore } from './knowledge.ts';

const manifest = readManifest(import.meta.url);
// The knowledge graph review's store, as the knowledge service answers Alex on Fri 20 Nov 2026.
const store = JSON.parse(readFileSync(new URL('./fixtures/store.json', import.meta.url), 'utf8')) as KnowledgeStore & { now: string; sources: Record<string, { author: string; who: string }> };
const directory = async ({ ids = [] }: { ids?: readonly string[] }) => ({
  people: [...new Set(ids)].flatMap((id) => {
    const s = Object.values(store.sources).find((x) => x.author === id);
    return s ? [{ id, name: s.who }] : [];
  }),
  teams: [],
});
const sam = { id: 'alex', name: 'Alex Rowe', departments: [], roles: [], workspace: { id: 'ws-team', kind: 'team' as const, role: 'member' as const } };
// The gateway's address inside the deployment: not loopback, which the service kit believes as it comes.
const fromGateway = '172.18.0.9';

/** The app as it runs behind the gateway: it believes only a caller the gateway signed for `app-<id>` (`callerAudienceOf`, on contract 3). */
const behindGateway = async (knowledge: Knowledge = memoryKnowledge(store)) => {
  const gateway = callerSigner();
  const kept = memoryEvents();
  const app = await buildApp({ manifest, callers: callerCheckFor(gateway, callerAudienceOf(manifest)), events: kept, knowledge: () => knowledge, directory, now: () => new Date(store.now) });
  return { app, gateway, kept };
};

/** The caller the gateway signs when the shell calls the app for a person (contract 3): the person, with the app and its scopes. */
const delegated = async (gateway: ReturnType<typeof callerSigner>) => ({
  [CALLER_TOKEN_HEADER]: await signDelegation(gateway, sam, { app: manifest.id, scopes: (manifest.scopes as string[] | undefined) ?? [] }),
});

const event: DomainEvent = { seq: '41', topic: 'platform.team.renamed', id: 'e41', publisher: 'identity', at: '2026-11-09T09:00:00Z', payload: { team: 'ws-team' } };

describe('the service', () => {
  it('answers /healthz with its release, with no one calling', async () => {
    const { app } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', version: packageVersion(import.meta.url), api: 'v1' });
  });

  it('refuses a thing nobody signed, as a problem details body', async () => {
    const { app } = await behindGateway();
    const unsigned = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/mv-saltmarsh-heron' });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.headers['content-type']).toMatch(/application\/problem\+json/);
    // Plain x-user-* headers are anyone's word: dropped, so nobody is calling.
    const forged = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/mv-saltmarsh-heron', headers: callerHeaders(sam) });
    expect(forged.statusCode).toBe(401);
  });

  it('refuses a caller signed for another service', async () => {
    const { app, gateway } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/mv-saltmarsh-heron', headers: await signedCallerHeaders(gateway, sam, 'identity') });
    expect(res.statusCode).toBe(401);
  });

  it('answers a thing in the one shape, with each line’s report by name', async () => {
    const { app, gateway } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/mv-saltmarsh-heron', headers: await delegated(gateway) });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view).toMatchObject({ id: 'mv-saltmarsh-heron', name: 'MV Saltmarsh Heron' });
    expect(view.answer.map((a: { key: string }) => a.key)).toEqual(['now', 'next']);
    expect(view.problems[0].kind).toBe('conflict');
    // The view carries every fact and link it found; the page shows up to four and six, and counts the rest.
    expect(view.total).toBeGreaterThan(view.facts.length);
    const sources = [...view.answer, ...view.problems, ...view.facts].flatMap((l: { source?: { who: string; id?: string } }) => (l.source ? [l.source] : []));
    expect(sources.length).toBeGreaterThan(0);
    // Names, never ids; the person's own reports say so.
    for (const s of sources) expect(s.who).not.toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(sources.every((s: { id?: string }) => typeof s.id === 'string')).toBe(true);
  });

  it('says what is coming to a place, from the things whose next stop it is', async () => {
    const { app, gateway } = await behindGateway();
    const view = (await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/port-of-kessick', headers: await delegated(gateway) })).json();
    expect(view.answer[0]).toMatchObject({ key: 'next', value: expect.stringContaining('MV Saltmarsh Heron, Tue 24 Nov') });
  });

  it('answers 404 for a thing not in sight, and says so', async () => {
    const { app, gateway } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/nowhere', headers: await delegated(gateway) });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ reason: 'not_found', detail: expect.any(String) });
  });

  it('passes the knowledge graph’s refusal on, with who can change it', async () => {
    const refusing: Knowledge = { ...memoryKnowledge(store), entity: async () => Promise.reject(new KnowledgeRefused(403, 'Data Atlas may not read the knowledge graph here.')) };
    const { app, gateway } = await behindGateway(refusing);
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/mv-saltmarsh-heron', headers: await delegated(gateway) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ reason: 'knowledge_refused', detail: 'Data Atlas may not read the knowledge graph here.', whoCanChange: expect.any(String) });
    const down: Knowledge = { ...memoryKnowledge(store), entity: async () => Promise.reject(new KnowledgeRefused(503, 'The knowledge graph is not answering.')) };
    const second = await behindGateway(down);
    const gone = await second.app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/mv-saltmarsh-heron', headers: await delegated(second.gateway) });
    expect(gone.statusCode).toBe(502);
    expect(gone.json()).not.toHaveProperty('whoCanChange');
  });

  it('finds things by name or other name, with their kind in words', async () => {
    const { app, gateway } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/find?q=heron', headers: await delegated(gateway) });
    expect(res.statusCode).toBe(200);
    expect(res.json().things).toContainEqual({ id: 'mv-saltmarsh-heron', name: 'MV Saltmarsh Heron', kind: expect.any(String) });
    const nothing = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/find?q=', headers: await delegated(gateway) });
    expect(nothing.json()).toEqual({ query: '', things: [] });
  });

  it('serves its OpenAPI document where the manifest says', async () => {
    const { app } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: `/${(manifest.api as { openapi: string }).openapi}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: expect.stringMatching(/^3\./), info: { title: manifest.name, version: packageVersion(import.meta.url) } });
    expect(Object.keys(res.json().paths)).toEqual(['/v1/things/{id}', '/v1/things/{id}/everything', '/v1/things/{id}/wrong', '/v1/things/{id}/disputes', '/v1/follows/{id}', '/v1/home', '/v1/doors/{id}', '/v1/find']);
  });
});

describe('everything we know, and what a person does about it', () => {
  const ask = async (method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, { acted = [] as Acted, headers = {} as Record<string, string>, payload = undefined as unknown } = {}) => {
    const { app, gateway } = await behindGateway(memoryKnowledge(store, acted));
    return app.inject({ remoteAddress: fromGateway, method, url, headers: { ...(await delegated(gateway)), ...headers }, ...(payload === undefined ? {} : { payload: payload as object }) });
  };

  it('lists everything known now, the links both ways, and what was true before', async () => {
    const res = await ask('GET', '/v1/things/mv-saltmarsh-heron/everything');
    expect(res.statusCode).toBe(200);
    const all = res.json();
    expect(all.sections.map((s: { key: string }) => s.key)).toEqual(['now', 'links', 'before']);
    const [now, links] = all.sections;
    expect(now.rows.length).toBeGreaterThan(0);
    // Each row says when and on how many reports, in words.
    for (const r of now.rows) expect(r.detail).toMatch(/report/);
    // A link opens the thing it reaches.
    expect(links.rows.some((r: { opens?: string }) => r.opens === 'port-of-kessick')).toBe(true);
  });

  it('says a place’s incoming links in their own words', async () => {
    const all = (await ask('GET', '/v1/things/port-of-kessick/everything')).json();
    const links = all.sections.find((s: { key: string }) => s.key === 'links').rows;
    expect(links.some((r: { opens?: string; value: string }) => r.opens === 'mv-saltmarsh-heron' && r.value === 'MV Saltmarsh Heron')).toBe(true);
  });

  it('offers the page’s own lines first when something is wrong', async () => {
    const res = await ask('GET', '/v1/things/mv-saltmarsh-heron/wrong');
    expect(res.statusCode).toBe(200);
    const { lines } = res.json();
    expect(lines.length).toBeGreaterThan(1);
    expect(new Set(lines.map((l: { belief: string }) => l.belief)).size).toBe(lines.length);
    expect(lines[0].line).toMatch(/: /);
  });

  it('disputes a line as the person, once however often it is sent', async () => {
    const acted: Acted = [];
    const { lines } = (await ask('GET', '/v1/things/mv-saltmarsh-heron/wrong')).json();
    const body = { belief: lines[0].belief, reason: '  She left on Monday.  ' };
    const first = await ask('POST', '/v1/things/mv-saltmarsh-heron/disputes', { acted, headers: { 'idempotency-key': 'press-0001' }, payload: body });
    const again = await ask('POST', '/v1/things/mv-saltmarsh-heron/disputes', { acted, headers: { 'idempotency-key': 'press-0001' }, payload: body });
    expect([first.statusCode, again.statusCode]).toEqual([200, 200]);
    expect(first.json().dispute).toEqual(expect.any(String));
    expect(acted).toEqual([{ name: 'dispute', input: { belief: lines[0].belief, reason: 'She left on Monday.' }, key: 'atlas-press-0001' }]);
  });

  it('refuses a dispute with no key, or about another thing', async () => {
    const acted: Acted = [];
    const { lines } = (await ask('GET', '/v1/things/mv-saltmarsh-heron/wrong')).json();
    const keyless = await ask('POST', '/v1/things/mv-saltmarsh-heron/disputes', { acted, payload: { belief: lines[0].belief, reason: 'Wrong.' } });
    const elsewhere = await ask('POST', '/v1/things/port-of-kessick/disputes', { acted, headers: { 'idempotency-key': 'press-0002' }, payload: { belief: lines[0].belief, reason: 'Wrong.' } });
    expect([keyless.statusCode, elsewhere.statusCode]).toEqual([400, 422]);
    expect(acted).toEqual([]);
  });

  it('keeps an eye on a thing in sight, and stops', async () => {
    const { app, gateway } = await behindGateway();
    const call = async (method: 'GET' | 'PUT' | 'DELETE', id = 'mv-saltmarsh-heron') =>
      app.inject({ remoteAddress: fromGateway, method, url: `/v1/follows/${id}`, headers: await delegated(gateway) });
    expect((await call('GET')).json()).toEqual({ thing: 'mv-saltmarsh-heron', following: false });
    expect((await call('PUT')).json().following).toBe(true);
    expect((await call('GET')).json().following).toBe(true);
    expect((await call('DELETE')).json().following).toBe(false);
    expect((await call('GET')).json().following).toBe(false);
    // Nobody learns of a thing out of sight by following it.
    expect((await call('PUT', 'nowhere')).statusCode).toBe(404);
  });
});

describe('home: the door gallery', () => {
  it('gives the doors and, on a first day, says nothing is followed yet', async () => {
    const { app, gateway } = await behindGateway();
    const res = await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/home', headers: await delegated(gateway) });
    expect(res.statusCode).toBe(200);
    const home = res.json();
    expect(home.doors.map((d: { id: string }) => d.id)).toEqual(['get-ready', 'changed', 'put-right', 'keep-an-eye']);
    // No calendar: the meeting door stays and says why.
    expect(home.doors[0].unavailable).toEqual({ why: 'AUGUR has no calendar yet', who: 'A later AUGUR release' });
    expect(home.firstDay).toBe(true);
    expect(home.following).toEqual([]);
    // Two answers at once on this floor, by the thing's name, never its id.
    expect(home.signals).toContainEqual({ kind: 'contradiction', reason: expect.stringMatching(/^MV Saltmarsh Heron: two answers for /), about: 'mv-saltmarsh-heron' });
  });

  it('says what changed on what the person keeps an eye on, and lists it behind its door', async () => {
    const { app, gateway } = await behindGateway();
    const call = async (method: 'GET' | 'PUT', url: string) => app.inject({ remoteAddress: fromGateway, method, url, headers: await delegated(gateway) });
    // Followed "now" (Fri 20 Nov), so only what was recorded later is news: nothing.
    await call('PUT', '/v1/follows/mv-saltmarsh-heron');
    const home = (await call('GET', '/v1/home')).json();
    expect(home.firstDay).toBe(false);
    expect(home.following).toEqual([{ id: 'mv-saltmarsh-heron', label: 'MV Saltmarsh Heron' }]);
    expect(home.signals.filter((s: { kind: string }) => s.kind === 'change')).toEqual([]);
    const eye = (await call('GET', '/v1/doors/keep-an-eye')).json();
    expect(eye.items).toEqual([{ id: 'mv-saltmarsh-heron', title: 'MV Saltmarsh Heron', detail: expect.any(String) }]);
    const right = (await call('GET', '/v1/doors/put-right')).json();
    expect(right.items.map((i: { id: string }) => i.id)).toContain('mv-saltmarsh-heron');
    // One row per thing, however many answers disagree.
    expect(new Set(right.items.map((i: { id: string }) => i.id)).size).toBe(right.items.length);
    expect((await call('GET', '/v1/doors/get-ready')).json()).toMatchObject({ items: [], empty: 'AUGUR has no calendar yet. A later AUGUR release can change that.' });
    expect((await call('GET', '/v1/doors/nowhere')).statusCode).toBe(404);
  });

  it('counts lines recorded since the person began keeping an eye', async () => {
    const gateway = callerSigner();
    const follows = memoryFollows(() => new Date('2026-11-10T00:00:00Z'));
    const app = await buildApp({ manifest, callers: callerCheckFor(gateway, callerAudienceOf(manifest)), knowledge: () => memoryKnowledge(store), follows, directory, now: () => new Date(store.now) });
    await follows.follow('alex', 'ws-team', 'mv-saltmarsh-heron');
    const home = (await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/home', headers: await delegated(gateway) })).json();
    expect(home.signals).toContainEqual({ kind: 'change', reason: expect.stringMatching(/^MV Saltmarsh Heron: \d+ new lines?$/), about: 'mv-saltmarsh-heron' });
  });
});

describe('use-ranking: what people on a floor follow', () => {
  const around = async (call: (url: string) => Promise<{ json: () => { around: { id: string }[] } }>) => (await call('/v1/things/mv-saltmarsh-heron')).json().around.map((a) => a.id);

  it('lifts a link people follow from a kind of thing’s page, once enough have', async () => {
    const uses = memoryUses();
    const gateway = callerSigner();
    const app = await buildApp({ manifest, callers: callerCheckFor(gateway, callerAudienceOf(manifest)), knowledge: () => memoryKnowledge(store), uses, directory, now: () => new Date(store.now) });
    const call = async (url: string) => app.inject({ remoteAddress: fromGateway, method: 'GET', url, headers: await delegated(gateway) });
    const before = await around(call);
    // Four follows from a ship's page to the tug that helped it off the berth: not yet enough to count.
    for (let i = 0; i < 4; i++) expect((await call('/v1/things/tug-osprey?from=mv-saltmarsh-heron')).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(await uses.counts('ws-team', 'Ship')).toMatchObject({ visits: 4, links: { 'in assistedUnberthing': 4, 'in bookedToAssist': 4 } });
    expect(await around(call)).toEqual(before);
    // The fifth makes it count, and the tug rises among what is around the ship.
    await call('/v1/things/tug-osprey?from=mv-saltmarsh-heron');
    await new Promise((r) => setTimeout(r, 0));
    const after = await around(call);
    expect(after.indexOf('tug-osprey')).toBeLessThan(before.indexOf('tug-osprey'));
  });

  it('counts per floor and never who followed', async () => {
    const uses = memoryUses();
    const gateway = callerSigner();
    const app = await buildApp({ manifest, callers: callerCheckFor(gateway, callerAudienceOf(manifest)), knowledge: () => memoryKnowledge(store), uses, directory, now: () => new Date(store.now) });
    await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/tug-osprey?from=mv-saltmarsh-heron', headers: await delegated(gateway) });
    // A "from" with no link to the thing counts nothing.
    await app.inject({ remoteAddress: fromGateway, method: 'GET', url: '/v1/things/tug-osprey?from=marta-kowal', headers: await delegated(gateway) });
    await new Promise((r) => setTimeout(r, 0));
    const ship = await uses.counts('ws-team', 'Ship');
    expect(ship.visits).toBe(1);
    expect(Object.values(ship.links).every((n) => n === 1)).toBe(true);
    expect(await uses.counts('ws-other', 'Ship')).toEqual({ visits: 0, links: {} });
    expect(await uses.counts('ws-team', 'Person')).toEqual({ visits: 0, links: {} });
  });
});

describe('events AUGUR pushes to the part', () => {
  const deliver = async (app: Awaited<ReturnType<typeof buildApp>>, headers: Record<string, string>) =>
    app.inject({ remoteAddress: fromGateway, method: 'POST', url: PART_EVENTS_PATH, headers, payload: event });

  it('keeps each event once, however often it is delivered', async () => {
    const { app, gateway, kept } = await behindGateway();
    const headers = { ...(await signedCallerHeaders(gateway, callerOfService('events'), callerAudienceOf(manifest))), [IDEMPOTENCY_KEY_HEADER]: eventDeliveryKey(event) };
    const first = await deliver(app, headers);
    const again = await deliver(app, headers);
    expect(first.statusCode).toBe(204);
    expect(again.statusCode).toBe(204);
    expect(kept.all()).toEqual([{ key: eventDeliveryKey(event), event }]);
  });

  it('takes events only from AUGUR’s events service', async () => {
    const { app, gateway, kept } = await behindGateway();
    const key = { [IDEMPOTENCY_KEY_HEADER]: eventDeliveryKey(event) };
    const person = await deliver(app, { ...(await delegated(gateway)), ...key });
    const another = await deliver(app, { ...(await signedCallerHeaders(gateway, callerOfService('identity'), callerAudienceOf(manifest))), ...key });
    const nobody = await deliver(app, key);
    const malformed = await app.inject({ remoteAddress: fromGateway, method: 'POST', url: PART_EVENTS_PATH, headers: { ...(await delegated(gateway)), ...key }, payload: { nothing: true } });
    expect([person.statusCode, another.statusCode, nobody.statusCode, malformed.statusCode]).toEqual([403, 403, 401, 403]);
    expect(kept.all()).toEqual([]);
  });

  it('needs the idempotency key to keep an event once', async () => {
    const { app, gateway, kept } = await behindGateway();
    const res = await deliver(app, await signedCallerHeaders(gateway, callerOfService('events'), callerAudienceOf(manifest)));
    expect(res.statusCode).toBe(400);
    expect(kept.all()).toEqual([]);
  });
});
