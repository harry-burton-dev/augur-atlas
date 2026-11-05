import { describe, expect, it } from 'vitest';
import { identityOrgName } from './people.ts';

const credentials = { name: 'atlas', getToken: async () => 'token' };

describe('identityOrgName', () => {
  it('asks identity for the organisation’s name, remembers it a minute, and keeps the last one when identity can’t answer', async () => {
    let clock = 0;
    const answers: (() => Response)[] = [() => Response.json({ name: ' Harbour Group ' }), () => new Response('down', { status: 503 }), () => Response.json({ name: 'Harbour Group plc' })];
    const asked: string[] = [];
    const orgName = identityOrgName({
      identityUrl: 'http://identity/',
      credentials,
      now: () => clock,
      fetchImpl: (async (url: string) => {
        asked.push(url);
        return answers.shift()!();
      }) as typeof fetch,
    });
    expect(await orgName()).toBe('Harbour Group');
    expect(await orgName()).toBe('Harbour Group');
    expect(asked).toEqual(['http://identity/v1/organisation']);
    clock = 61_000;
    expect(await orgName()).toBe('Harbour Group');
    expect(await orgName()).toBe('Harbour Group plc');
  });

  it('gives nothing when identity was never reached, so the floor is called the organisation', async () => {
    const orgName = identityOrgName({ identityUrl: 'http://identity', credentials, fetchImpl: (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch });
    expect(await orgName()).toBeUndefined();
  });
});
