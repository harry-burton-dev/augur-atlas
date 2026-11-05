import { describe, expect, it } from 'vitest';
import { checkDetail, normaliseDetail } from './ontology.ts';
import { formatPoint, parsePoint } from './points.ts';

const location = { key: 'location', label: 'Location', kind: 'place' as const, identity: false };

describe('points', () => {
  it('reads latitude then longitude in decimal degrees, and only in range', () => {
    expect(parsePoint('57.70, 11.97')).toEqual({ lat: 57.7, lon: 11.97 });
    expect(parsePoint(' -33.8688,151.2093 ')).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parsePoint('91, 0')).toBeUndefined();
    expect(parsePoint('0, 181')).toBeUndefined();
    expect(parsePoint('Kessby anchorage')).toBeUndefined();
    expect(formatPoint({ lat: 57.7000001, lon: 11.97 })).toBe('57.7, 11.97');
  });

  it('lets a place be words or a point, keeps a point in one form, and says why one out of range won’t do', () => {
    expect(checkDetail(location, 'Kessby anchorage')).toBeUndefined();
    expect(checkDetail(location, '57.70, 11.97')).toBeUndefined();
    expect(normaliseDetail(location, '57.700,11.970')).toBe('57.7, 11.97');
    expect(normaliseDetail(location, ' Kessby   anchorage ')).toBe('Kessby anchorage');
    expect(checkDetail(location, '11.97, 257.70')).toMatch(/latitude \(−90 to 90\) then longitude/);
  });
});
