import type { CallerWorkspace } from '@augur/service-kit';

/**
 * Knowledge in Data Atlas is fenced by floor (Harry, 27 October 2026). Each
 * entity, and later each observation and fact, sits on one floor, named by
 * that floor's principal: `person:<owner>` for someone's own, `tree:<team>`
 * for a team's (its members and those of the teams below), `org` for the org's.
 *
 * A floor shows what is kept on it and on every floor above it, never below:
 * the org floor shows only the org's, a team's shows its own, its parents' and
 * the org's, and your own floor shows everything you can reach.
 */

/** The principal a thing made while standing on this floor is kept under. */
export const floorPrincipal = (person: string, workspace: CallerWorkspace) =>
  workspace.kind === 'personal' ? `person:${person}` : workspace.kind === 'org' ? 'org' : `tree:${workspace.id}`;

/**
 * Which floors' knowledge shows while standing on this one. `principals` are
 * everything the caller stands for; `teamPath` is the team's id and its
 * parents' (from identity's directory), for a team floor.
 */
export const viewFloors = (workspace: CallerWorkspace, principals: readonly string[], teamPath: readonly string[] = [workspace.id]): string[] => {
  if (workspace.kind === 'org') return ['org'];
  if (workspace.kind === 'team') return ['org', ...teamPath.map((id) => `tree:${id}`)];
  return [...new Set(principals.filter((p) => p === 'org' || p.startsWith('tree:') || p.startsWith('person:')))];
};

/**
 * Why something can't be seen from here, said plainly, never hidden
 * (Harry's rule: explain, never hide). `reachable` is whether the caller could
 * see it from another floor of theirs.
 */
export interface Unseen {
  /** `elsewhere`: theirs to see from another floor; `kept`: not theirs to see. */
  reason: 'elsewhere' | 'kept';
  /** Where it is kept, as a principal. */
  floor: string;
  message: string;
}

export const unseen = (floor: string, principals: readonly string[], caller: string, floorName?: string): Unseen => {
  const own = floor === `person:${caller}`;
  const where = floor === 'org' ? 'the org floor' : own ? 'your own floor' : floor.startsWith('person:') ? 'someone’s own floor' : floorName ? `the ${floorName} floor` : 'a team’s floor';
  if (own || principals.includes(floor)) {
    return { reason: 'elsewhere', floor, message: `It’s kept on ${where}, so it doesn’t show from here. Go to ${own ? 'your own floor' : where} to see it.` };
  }
  return {
    reason: 'kept',
    floor,
    message: floor.startsWith('person:') ? `It’s kept on ${where}, which only its owner can see.` : `It’s kept on ${where}. Ask one of its leads if you need it.`,
  };
};
