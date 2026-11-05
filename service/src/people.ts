import { appCredentialsFromEnv, identityDirectory, identityPrincipals, serviceHeaders, type CallerWorkspace, type DirectorySearch, type ServiceCredentials } from '@augur/service-kit';

/** What Data Atlas needs to know about people and teams to fence knowledge by floor. */
export interface People {
  /** Everything a person stands for: `person:<id>`, `team:`/`tree:` for their teams and those above, `org`. */
  principals: (person: string, workspace: CallerWorkspace) => Promise<string[]>;
  /** A team's id and those of the teams above it, from the top down. */
  teamPath: (team: string) => Promise<string[]>;
  /** Teams' names by id, to say where something is kept. */
  teamNames: (ids: readonly string[]) => Promise<Map<string, string>>;
  /** The organisation's name, as Admin sets it (identity's `GET /v1/organisation`); undefined when it can't be asked. */
  orgName: () => Promise<string | undefined>;
}

/**
 * Without identity, as under `pnpm dev:app`: the caller, the floor they're on
 * when it's a team, and the org. Teams have no parents and no names.
 */
export const standInPeople: People = {
  principals: async (person, workspace) => [`person:${person}`, ...(workspace.kind === 'team' ? [`team:${workspace.id}`, `tree:${workspace.id}`] : []), 'org'],
  teamPath: async (team) => [team],
  teamNames: async () => new Map(),
  orgName: async () => undefined,
};

/** How long the organisation's name is remembered: Admin can rename it, and it shows within this. */
const ORG_NAME_MS = 60_000;
/** How long one ask of identity may take before the name is given up on for this answer. */
const ASK_MS = 5_000;

/**
 * Asks identity for the organisation's name, as Data Atlas, and remembers it a
 * minute. A failed ask isn't remembered, and gives undefined so the caller can
 * say "the organisation" instead.
 */
export const identityOrgName = ({ identityUrl, credentials, fetchImpl = fetch, now = Date.now }: { identityUrl: string; credentials: ServiceCredentials; fetchImpl?: typeof fetch; now?: () => number }) => {
  let kept: { name: string; until: number } | undefined;
  return async (): Promise<string | undefined> => {
    if (kept && kept.until > now()) return kept.name;
    try {
      const res = await fetchImpl(`${identityUrl.replace(/\/$/, '')}/v1/organisation`, { headers: await serviceHeaders(credentials), signal: AbortSignal.timeout(ASK_MS) });
      if (!res.ok) return kept?.name;
      const { name } = (await res.json()) as { name?: unknown };
      if (typeof name !== 'string' || !name.trim()) return kept?.name;
      kept = { name: name.trim(), until: now() + ORG_NAME_MS };
      return kept.name;
    } catch {
      return kept?.name;
    }
  };
};

/** Asks identity's directory, as Data Atlas (the `people:read` scope). */
export const identityPeople = (lookup: (person: string) => Promise<string[]>, directory: DirectorySearch, orgName: () => Promise<string | undefined> = async () => undefined): People => ({
  principals: (person) => lookup(person),
  teamPath: async (team) => (await directory({ ids: [team] })).teams.find((t) => t.id === team)?.path ?? [team],
  teamNames: async (ids) => {
    if (!ids.length) return new Map();
    const { teams } = await directory({ ids });
    return new Map(teams.map((t) => [t.id, t.name]));
  },
  orgName,
});

/** Identity when IDENTITY_URL and the app's sign-in are set, else the stand-in. */
export const peopleFromEnv = (env = process.env): People => {
  const credentials = appCredentialsFromEnv('atlas', env);
  const identityUrl = env.IDENTITY_URL;
  if (!identityUrl || !credentials) return standInPeople;
  return identityPeople(identityPrincipals({ identityUrl, credentials }), identityDirectory({ identityUrl, credentials }), identityOrgName({ identityUrl, credentials }));
};
