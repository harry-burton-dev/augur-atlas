import { describe, expect, it } from 'vitest';
import { floorPrincipal, unseen, viewFloors } from './floors.ts';
import { checkDetail, detailsOf, normaliseDetail, starterSql, STARTER_TYPES } from './ontology.ts';

const sam = ['person:sam', 'team:t-mar', 'tree:t-mar', 'tree:t-ops', 'org'];

describe('floors', () => {
  it('keeps things under the floor they were made on', () => {
    expect(floorPrincipal('sam', { id: 'w-sam', kind: 'personal', role: 'lead' })).toBe('person:sam');
    expect(floorPrincipal('sam', { id: 't-mar', kind: 'team', role: 'member' })).toBe('tree:t-mar');
    expect(floorPrincipal('sam', { id: 'w-org', kind: 'org', role: 'member' })).toBe('org');
  });

  it('shows a floor its own knowledge and that of the floors above, never below', () => {
    expect(viewFloors({ id: 'w-org', kind: 'org', role: 'member' }, sam)).toEqual(['org']);
    expect(viewFloors({ id: 't-mar', kind: 'team', role: 'member' }, sam, ['t-ops', 't-mar'])).toEqual(['org', 'tree:t-ops', 'tree:t-mar']);
    expect(viewFloors({ id: 't-ops', kind: 'team', role: 'member' }, sam, ['t-ops'])).toEqual(['org', 'tree:t-ops']);
    expect(viewFloors({ id: 'w-sam', kind: 'personal', role: 'lead' }, sam)).toEqual(['person:sam', 'tree:t-mar', 'tree:t-ops', 'org']);
  });

  it('says where something is kept and what to do about it', () => {
    expect(unseen('tree:t-mar', sam, 'sam', 'Maritime desk')).toMatchObject({ reason: 'elsewhere', message: expect.stringMatching(/Go to the Maritime desk floor/) });
    expect(unseen('tree:t-fin', sam, 'sam', 'Finance')).toMatchObject({ reason: 'kept', message: expect.stringMatching(/Finance floor. Ask one of its leads/) });
    expect(unseen('person:ana', sam, 'sam').message).toMatch(/only its owner can see/);
  });
});

describe('ontology', () => {
  it('gives a type the details of the kinds above it too', () => {
    const ontology = { version: 1, types: [...STARTER_TYPES] };
    expect(detailsOf(ontology, 'vessel').map((d) => d.key)).toEqual(['imo', 'mmsi', 'call-sign']);
    expect(detailsOf(ontology, 'person')).toEqual([]);
  });

  it('keeps codes in one form and checks them against their pattern', () => {
    const imo = STARTER_TYPES.find((t) => t.key === 'vessel')!.details[0];
    const locode = STARTER_TYPES.find((t) => t.key === 'port')!.details[0];
    expect(normaliseDetail(imo, ' 9 400 117 ')).toBe('9400117');
    expect(normaliseDetail(locode, 'gb sou')).toBe('GBSOU');
    expect(checkDetail(imo, '9400117')).toBeUndefined();
    expect(checkDetail(imo, '94001')).toMatch(/seven digits/);
    expect(checkDetail(locode, 'GB1OU')).toMatch(/five letters/);
  });

  it('writes the starter profile as plain inserts, parents first', () => {
    const sql = starterSql();
    expect(sql.indexOf("'vehicle'")).toBeLessThan(sql.indexOf("'vessel'"));
    expect(sql).not.toMatch(/\b(drop|delete|truncate)\b/i);
  });
});
