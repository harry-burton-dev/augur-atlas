import { appCredentialsFromEnv, identityDirectory, identityPrincipals, type CallerWorkspace, type DirectorySearch } from '@augur/service-kit';

/** What Data Atlas needs to know about people and teams to fence knowledge by floor. */
export interface People {
  /** Everything a person stands for: `person:<id>`, `team:`/`tree:` for their teams and those above, `org`. */
  principals: (person: string, workspace: CallerWorkspace) => Promise<string[]>;
  /** A team's id and those of the teams above it, from the top down. */
  teamPath: (team: string) => Promise<string[]>;
  /** Teams' names by id, to say where something is kept. */
  teamNames: (ids: readonly string[]) => Promise<Map<string, string>>;
}

/**
 * Without identity, as under `pnpm dev:app`: the caller, the floor they're on
 * when it's a team, and the org. Teams have no parents and no names.
 */
export const standInPeople: People = {
  principals: async (person, workspace) => [`person:${person}`, ...(workspace.kind === 'team' ? [`team:${workspace.id}`, `tree:${workspace.id}`] : []), 'org'],
  teamPath: async (team) => [team],
  teamNames: async () => new Map(),
};

/** Asks identity's directory, as Data Atlas (the `people:read` scope). */
export const identityPeople = (lookup: (person: string) => Promise<string[]>, directory: DirectorySearch): People => ({
  principals: (person) => lookup(person),
  teamPath: async (team) => (await directory({ ids: [team] })).teams.find((t) => t.id === team)?.path ?? [team],
  teamNames: async (ids) => {
    if (!ids.length) return new Map();
    const { teams } = await directory({ ids });
    return new Map(teams.map((t) => [t.id, t.name]));
  },
});

/** Identity when IDENTITY_URL and the app's sign-in are set, else the stand-in. */
export const peopleFromEnv = (env = process.env): People => {
  const credentials = appCredentialsFromEnv('atlas', env);
  const identityUrl = env.IDENTITY_URL;
  if (!identityUrl || !credentials) return standInPeople;
  return identityPeople(identityPrincipals({ identityUrl, credentials }), identityDirectory({ identityUrl, credentials }));
};
