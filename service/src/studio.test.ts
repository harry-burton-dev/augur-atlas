import { callerHeaders, type Caller, type CallerWorkspace } from '@augur/service-kit';
import { Parser } from 'n3';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { checkChanges, keyFrom, pluralOf } from './studio.ts';
import { packFromTurtle } from './packs.ts';
import type { People } from './people.ts';
import { PgAtlasStore } from './store.ts';
import type { Ontology } from './ontology.ts';

const people: People = {
  principals: async (person) => [`person:${person}`, 'org'],
  teamPath: async (team) => [team],
  teamNames: async () => new Map(),
};
const ORG: CallerWorkspace = { id: 'w-org', kind: 'org', role: 'member' };
const ADMIN: Caller = { id: 'ada', name: 'Ada', departments: [], roles: ['admin'], workspace: ORG };
const SAM: Caller = { id: 'sam', name: 'Sam', departments: [], roles: [], workspace: ORG };
const CCO = 'http://www.ontologyrepository.com/CommonCoreOntologies/';

const MIM = `
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix mim: <https://example.org/mim#> .
mim:MilitaryUnit a owl:Class ; rdfs:label "military unit"@en, "unité militaire"@fr ; rdfs:comment "An organisation of armed forces." .
mim:NavalUnit a owl:Class ; rdfs:subClassOf mim:MilitaryUnit ; rdfs:label "naval unit"@en .
mim:Escorts a owl:ObjectProperty ; rdfs:label "escorts" ; rdfs:domain mim:NavalUnit ; rdfs:range <${CCO}Watercraft> .
mim:callSign a owl:DatatypeProperty ; rdfs:domain mim:MilitaryUnit .
`;

describe('packs', () => {
  it('reads OWL classes and properties from Turtle, preferring English labels, naming the unlabelled from their IRI', () => {
    const pack = packFromTurtle(MIM, { id: 'mim', name: 'MIP MIM (sample)', version: '5.0', licence: 'Test', source: 'test' });
    expect(pack.terms).toEqual([
      { iri: 'https://example.org/mim#MilitaryUnit', kind: 'class', label: 'military unit', note: 'An organisation of armed forces.' },
      { iri: 'https://example.org/mim#NavalUnit', kind: 'class', label: 'naval unit', parent: 'https://example.org/mim#MilitaryUnit' },
      { iri: 'https://example.org/mim#callSign', kind: 'detail', label: 'call Sign', domain: ['https://example.org/mim#MilitaryUnit'] },
      { iri: 'https://example.org/mim#Escorts', kind: 'relation', label: 'escorts', domain: ['https://example.org/mim#NavalUnit'], range: [`${CCO}Watercraft`] },
    ]);
  });

  it('says why in words when it can’t be read or has nothing to adopt', () => {
    expect(() => packFromTurtle('not turtle {', { id: 'x', name: 'x', version: '1', licence: 'x', source: 'x' })).toThrow(/isn’t Turtle that can be read/);
    expect(() => packFromTurtle('<a:b> <a:c> "d" .', { id: 'x', name: 'x', version: '1', licence: 'x', source: 'x' })).toThrow('It has no OWL classes or properties to adopt.');
  });

  it('makes keys and plurals an admin can start from', () => {
    expect(keyFrom('Patrol Boat')).toBe('patrol-boat');
    expect(keyFrom('3rd Fleet')).toBe('x-3rd-fleet');
    expect(['Facility', 'Patrol Boat', 'Box', 'Bus', 'Ship', 'Group of agents'].map(pluralOf)).toEqual(['Facilities', 'Patrol Boats', 'Boxes', 'Buses', 'Ships', 'Group of agents']);
  });

  it('checks a set of changes in order, and never narrows what’s kept', () => {
    const o: Ontology = {
      version: 1,
      types: [{ key: 'agent', label: 'Agent', plural: 'Agents', abstract: true, icon: 'people', pack: 'cco', packTerm: 'Agent', details: [{ key: 'name', label: 'Name', kind: 'text', identity: false }] }],
      relations: [{ key: 'knows', label: 'Knows', inverse: 'Known by', from: ['agent'], to: ['agent'], pack: 'augur', packTerm: 'knows' }],
    };
    const unit = { op: 'add-type' as const, type: { key: 'unit', label: 'Unit', plural: 'Units', parent: 'agent', abstract: false, icon: 'people', pack: 'augur', packTerm: 'unit' } };
    expect(checkChanges(o, [unit, { op: 'add-detail', type: 'unit', detail: { key: 'call-sign', label: 'Call sign', kind: 'text', identity: true } }])).toBeUndefined();
    expect(checkChanges(o, [{ op: 'add-detail', type: 'unit', detail: { key: 'x', label: 'X', kind: 'text', identity: false } }])).toBe('There’s no kind “unit” to add a detail to.');
    expect(checkChanges(o, [unit, { op: 'add-detail', type: 'unit', detail: { key: 'name', label: 'Name', kind: 'text', identity: false } }])).toBe('Agent already has a detail “name” (Name).');
    expect(checkChanges(o, [{ op: 'edit-relation', key: 'knows', from: [] }])).toMatch(/can only widen: it already runs from Agent/);
    expect(checkChanges(o, [{ ...unit, type: { ...unit.type, key: 'Unit!' } }])).toMatch(/won’t do as a key/);
  });
});

describe.runIf(process.env.DATABASE_URL)('Ontology studio', () => {
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

  it('comes with the CCO profile, its starter kinds adopted from it', async () => {
    const packs = (await call('GET', '/v1/ontology/packs', SAM)).json();
    expect(packs).toMatchObject({ govern: false, why: expect.stringContaining('Only admins'), packs: [{ id: 'cco', builtIn: true, licence: 'BSD-3-Clause' }] });
    const cco = (await call('GET', '/v1/ontology/packs/cco', SAM)).json();
    expect(cco.terms.find((t: { label: string }) => t.label === 'Watercraft')).toMatchObject({ adopted: 'vessel' });
    expect(cco.terms.find((t: { label: string }) => t.label === 'Weapon').adopted).toBeUndefined();
  });

  it('lets only admins change it, saying why', async () => {
    const res = await call('POST', '/v1/ontology/adopt', SAM, { pack: 'cco', iri: `${CCO}Weapon` });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('Only admins change the ontology');
  });

  it('adopts a pack term under its parent, as a new version other apps hear of', async () => {
    const res = await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'cco', iri: `${CCO}Weapon` });
    expect(res.statusCode).toBe(200);
    const { version, ontology } = res.json();
    expect(version).toBe(3);
    expect(ontology.types.find((t: { key: string }) => t.key === 'weapon')).toMatchObject({ label: 'Weapon', plural: 'Weapons', parent: 'artifact', icon: 'apps', pack: 'cco', packIri: `${CCO}Weapon` });
    expect(await store.unsent()).toContainEqual({ topic: 'atlas.ontology.changed', workspace: null, payload: { version: 3 } });
    const again = await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'cco', iri: `${CCO}Weapon` });
    expect(again.json()).toMatchObject({ error: 'adopted', message: 'Weapon is already kept here, as “weapon”.' });
    const [latest] = (await call('GET', '/v1/ontology/versions', SAM)).json().versions;
    expect(latest).toMatchObject({ version: 3, changedBy: 'ada', note: 'Adopted Weapon from Common Core Ontologies (profile)', changes: [{ op: 'add-type' }] });
  });

  it('loads an org’s own pack from Turtle, and asks for what it can’t work out', async () => {
    const loaded = await call('POST', '/v1/ontology/packs', ADMIN, { id: 'mim', name: 'MIP MIM (sample)', version: '5.0', licence: 'Org use only', turtle: MIM });
    expect(loaded.statusCode).toBe(201);
    expect(loaded.json()).toMatchObject({ id: 'mim', terms: 4, source: 'Loaded by an admin' });
    expect((await call('POST', '/v1/ontology/packs', ADMIN, { id: 'cco', name: 'x', version: '1', licence: 'x', turtle: MIM })).statusCode).toBe(409);

    const orphan = await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'mim', iri: 'https://example.org/mim#NavalUnit' });
    expect(orphan.json().message).toBe('The pack has Naval unit as a kind of MilitaryUnit, which isn’t kept here yet: adopt that first, or say which kind it goes under.');
    expect((await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'mim', iri: 'https://example.org/mim#MilitaryUnit', parent: 'organization' })).statusCode).toBe(200);
    expect((await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'mim', iri: 'https://example.org/mim#NavalUnit' })).statusCode).toBe(200);
    const escorts = await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'mim', iri: 'https://example.org/mim#Escorts' });
    expect(escorts.json().message).toMatch(/reads backwards/);
    const adopted = await call('POST', '/v1/ontology/adopt', ADMIN, { pack: 'mim', iri: 'https://example.org/mim#Escorts', inverse: 'Escorted by' });
    expect(adopted.json().ontology.relations.find((r: { key: string }) => r.key === 'escorts')).toMatchObject({ from: ['naval-unit'], to: ['vessel'], inverse: 'Escorted by' });
  });

  it('turns what sources ask for into candidates only admins see, decided for every source at once', async () => {
    const report = { kind: 'document', document: { app: 'folio', id: 'd1', title: 'Report' } };
    for (const name of ['Patrol boat', 'patrol boat']) {
      await call('POST', '/v1/proposals', SAM, { source: report, mentions: [{ key: 'm1', text: 'HMS Tyne' }], terms: [{ key: 't1', kind: 'type', name, parent: 'vessel' }] });
    }
    await call('POST', '/v1/proposals', SAM, { source: report, mentions: [{ key: 'm1', text: 'Tyne' }], terms: [{ key: 't1', kind: 'detail', name: 'Pennant number', parent: 'vessel' }] });
    expect((await call('GET', '/v1/ontology/candidates', SAM)).json()).toMatchObject({ govern: false, waiting: 2, candidates: [] });
    const { candidates } = (await call('GET', '/v1/ontology/candidates', ADMIN)).json();
    expect(candidates[0]).toMatchObject({ kind: 'type', asked: 2, parents: ['vessel'], start: { op: 'add-type', type: { key: 'patrol-boat', parent: 'vessel', icon: 'vessel' } } });

    const adopt = await call('POST', '/v1/ontology/candidates/decide', ADMIN, { kind: 'type', name: 'PATROL BOAT', as: 'adopt', change: candidates[0].start });
    expect(adopt.statusCode).toBe(200);
    expect(adopt.json().ontology.types.some((t: { key: string }) => t.key === 'patrol-boat')).toBe(true);
    const dismiss = await call('POST', '/v1/ontology/candidates/decide', ADMIN, { kind: 'detail', name: 'pennant number', as: 'dismiss' });
    expect(dismiss.json()).toEqual({ dismissed: 1 });
    expect((await call('GET', '/v1/ontology/candidates', ADMIN)).json().candidates).toEqual([]);
    const late = await call('POST', '/v1/ontology/candidates/decide', ADMIN, { kind: 'detail', name: 'pennant number', as: 'dismiss' });
    expect(late.statusCode).toBe(409);
  });

  it('exports OWL in Turtle that reads back, each kind saying which pack term it is', async () => {
    const res = await call('GET', '/v1/ontology/owl', SAM);
    expect(res.headers['content-type']).toContain('text/turtle');
    const quads = new Parser().parse(res.body);
    const match = (s: string) => quads.find((q) => q.subject.value === `https://augur.invalid/atlas/ontology#${s}` && q.predicate.value.endsWith('exactMatch'))?.object.value;
    expect(match('vessel')).toBe(`${CCO}Watercraft`);
    expect(match('naval-unit')).toBe('https://example.org/mim#NavalUnit');
    expect(match('patrol-boat')).toBe('https://augur.invalid/atlas/ontology#patrol-boat');
  });
});
