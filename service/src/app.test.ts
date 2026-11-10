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
import { KnowledgeRefused, memoryKnowledge, type Knowledge, type KnowledgeStore } from './knowledge.ts';

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
    expect(Object.keys(res.json().paths)).toEqual(['/v1/things/{id}', '/v1/find']);
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
