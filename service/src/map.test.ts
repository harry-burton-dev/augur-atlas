import { describe, expect, it } from 'vitest';
import { byteRange } from './map.ts';

describe('the base map’s byte ranges', () => {
  it('reads one range, an open end and a suffix, and refuses what isn’t in the file', () => {
    expect(byteRange(undefined, 100)).toBeUndefined();
    expect(byteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(byteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=95-200', 100)).toEqual({ start: 95, end: 99 });
    expect(byteRange('bytes=100-120', 100)).toBeNull();
    expect(byteRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(byteRange('items=0-1', 100)).toBeNull();
  });
});
