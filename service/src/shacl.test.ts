import { describe, expect, it } from 'vitest';
import { Parser } from 'n3';
import type { Entity, Fact, Ontology } from './api-types.ts';
import { STARTER_RELATIONS, STARTER_TYPES } from './ontology.ts';
import { checkKept, shaclTurtle } from './shacl.ts';

const ontology: Ontology = {
  version: 7,
  types: STARTER_TYPES.map((t) =>
    t.key === 'vessel'
      ? {
          ...t,
          details: [
            ...t.details,
            { key: 'gross-tonnage', label: 'Gross tonnage', kind: 'quantity', identity: false, unit: 't' },
            { key: 'status', label: 'Status', kind: 'choice', identity: false, values: ['In service', 'Laid up'] },
          ],
        }
      : t.key === 'event'
        ? { ...t, details: [{ key: 'when', label: 'When', kind: 'date', identity: false, onEntity: false }] }
        : t,
  ),
  relations: [...STARTER_RELATIONS],
};

const entity = (id: string, type: string, label: string, details: Record<string, string> = {}, floor = 'org'): Entity => ({
  id,
  type,
  label,
  aliases: [],
  description: '',
  details,
  workspace: 'w-org',
  floor,
  state: 'active',
  createdBy: 'sam',
  createdAt: '2026-11-05T00:00:00Z',
  updatedBy: 'sam',
  updatedAt: '2026-11-05T00:00:00Z',
});

const fact = (id: string, e: string, property: string, at: { value?: string; target?: string }): Fact => ({
  id,
  entity: e,
  property,
  ...at,
  floor: 'org',
  workspace: 'w-org',
  backedBy: [],
  note: '',
  recordedAt: '2026-11-05T00:00:00Z',
  createdBy: 'sam',
});

const none = new Map<string, Entity>();
const all = () => true;

describe('SHACL checks', () => {
  it('writes the ontology as shapes others can read', async () => {
    const turtle = await shaclTurtle(ontology);
    expect(() => new Parser().parse(turtle)).not.toThrow();
    expect(turtle).toMatch(/sh:targetClass atlas:vessel/);
    expect(turtle).toMatch(/sh:pattern "\^\(\?:\\\\d\{7\}\)\$"/);
    expect(turtle).toMatch(/sh:in \("In service" "Laid up"\)/);
  });

  it('finds nothing wrong with what fits', async () => {
    const ship = entity('ent_1', 'vessel', 'Ever Bright', { imo: '9400117', 'gross-tonnage': '12500', status: 'Laid up' });
    const owner = entity('ent_2', 'organization', 'Bright Lines');
    const findings = await checkKept(ontology, { entities: [ship], facts: [fact('fct_1', 'ent_1', 'owned-by', { target: 'ent_2' })], ends: new Map([['ent_2', owner]]), visible: all });
    expect(findings).toEqual([]);
  });

  it('says in words what doesn’t fit, the same words writing uses', async () => {
    const ship = entity('ent_1', 'vessel', 'Ever Bright', { imo: '94001', 'gross-tonnage': 'heavy', status: 'Sunk' });
    const findings = await checkKept(ontology, { entities: [ship], facts: [], ends: none, visible: all });
    expect(findings.map((f) => [f.property, f.message, f.constraint])).toEqual([
      ['gross-tonnage', 'Gross tonnage must be a number, in t.', 'DatatypeConstraintComponent'],
      ['imo', 'IMO number doesn’t look right: seven digits, such as 9400117.', 'PatternConstraintComponent'],
      ['status', 'Status must be one of: In service, Laid up.', 'InConstraintComponent'],
    ]);
  });

  it('finds a link to a kind it may not link to, and names the other end only when it shows', async () => {
    const person = entity('ent_1', 'person', 'Ana');
    const ship = entity('ent_2', 'vessel', 'Ever Bright', {}, 'tree:t-fin');
    const links = [fact('fct_9', 'ent_1', 'member-of', { target: 'ent_2' })];
    const [seen] = await checkKept(ontology, { entities: [person], facts: links, ends: new Map([['ent_2', ship]]), visible: all });
    expect(seen).toMatchObject({ entity: 'ent_1', property: 'member-of', fact: 'fct_9', message: '“Member of” links to organisations, and Ever Bright isn’t one.' });
    const [hidden] = await checkKept(ontology, { entities: [person], facts: links, ends: new Map([['ent_2', ship]]), visible: (e) => e.floor === 'org' });
    expect(hidden.message).not.toMatch(/Ever Bright/);
  });

  it('checks details known through facts, and a date by its form', async () => {
    const meeting = entity('ent_1', 'event', 'Handover');
    const findings = await checkKept(ontology, {
      entities: [meeting],
      facts: [fact('fct_1', 'ent_1', 'when', { value: '2026-11-05' }), fact('fct_2', 'ent_1', 'when', { value: 'soon' })],
      ends: none,
      visible: all,
    });
    expect(findings).toEqual([expect.objectContaining({ property: 'when', fact: 'fct_2', message: 'When must be a date.' })]);
  });
});
