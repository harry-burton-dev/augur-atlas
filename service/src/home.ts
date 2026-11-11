import type { DoorList, Home, HomeDoor, HomeSignal } from './api-types.ts';
import type { Follows } from './follows.ts';
import type { Knowledge } from './knowledge.ts';
import { words } from './shape.ts';

/**
 * Data Atlas's home: the kit's door gallery, as configuration (App patterns, "Ways in"). A door is plain data:
 * add one by adding it here, with the kinds of signal it reads and what opening it shows. The shell scores the
 * doors from the signals (`quill-door-gallery`'s `signals`), so nothing here decides how bright a door is.
 */
export interface AtlasDoor extends HomeDoor {
  /** What opening it lists: the things its signals are about, or the things the person keeps an eye on. */
  shows: 'signals' | 'following';
  /** The list's heading and what it says when there is nothing in it. */
  heading: string;
  empty: string;
}

export const DOORS: AtlasDoor[] = [
  {
    id: 'get-ready',
    name: 'Get ready for a meeting',
    line: 'A short brief on what you will discuss',
    icon: 'calendar',
    reads: ['meeting', 'due'],
    order: 1,
    unavailable: { why: 'AUGUR has no calendar yet', who: 'A later AUGUR release' },
    shows: 'signals',
    heading: 'Your next meetings',
    empty: 'No meetings in sight.',
  },
  {
    id: 'changed',
    name: 'See what has changed',
    line: 'On what you keep an eye on',
    icon: 'history',
    reads: ['change', 'moved', 'incident'],
    order: 2,
    firstDay: 'Keep an eye on a few things and their changes show here',
    shows: 'signals',
    heading: 'What has changed',
    empty: 'Nothing you keep an eye on has changed since you began.',
  },
  {
    id: 'put-right',
    name: 'Put something right',
    line: 'Something here looks wrong or out of date',
    icon: 'rename',
    reads: ['contradiction', 'queue'],
    order: 3,
    shows: 'signals',
    heading: 'What may need putting right',
    empty: 'Nothing on this floor has two answers at once.',
  },
  {
    id: 'keep-an-eye',
    name: 'Keep an eye on something',
    line: 'Hear when it changes',
    icon: 'star',
    reads: ['coming'],
    order: 4,
    firstDay: 'Open a thing and keep an eye on it',
    shows: 'following',
    heading: 'What you keep an eye on',
    empty: 'You don’t keep an eye on anything from this floor yet. Find a thing, and keep an eye on it from its page.',
  },
];

/** How many followed things and conflicts the home reads at most: one call per thing. */
export const HOME_LIMIT = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What waits behind the doors, read fresh as the person, with the things it is about. */
async function gather(kg: Knowledge, follows: Follows, person: string, floor: string) {
  const followed = (await follows.list(person, floor)).slice(0, HOME_LIMIT);
  const [{ classes, predicates }, conflicts] = await Promise.all([kg.ontology(), kg.conflicts(floor)]);
  const names = new Map<string, { name: string; kind: string }>();
  const look = async (id: string) => {
    if (!names.has(id)) {
      const e = await kg.entity(floor, id);
      // Out of sight from this floor: never named, so nobody learns of it here.
      if (e) names.set(id, { name: e.label ?? 'Not yet named', kind: classes.find((c) => c.iri === e.class)?.label ?? words(e.class) });
    }
    return names.get(id);
  };
  const signals: HomeSignal[] = [];
  const following: { id: string; label: string }[] = [];
  for (const f of followed) {
    const seen = await look(f.thing);
    if (!seen) continue;
    following.push({ id: f.thing, label: seen.name });
    const fresh = (await kg.beliefs(floor, f.thing)).filter((b) => b.state !== 'superseded' && !b.supersededAt && b.recordedAt > f.since);
    if (fresh.length) signals.push({ kind: 'change', reason: `${seen.name}: ${plural(fresh.length, 'new line', 'new lines')}`, about: f.thing });
  }
  for (const c of conflicts.conflicts.slice(0, HOME_LIMIT)) {
    const seen = await look(c.subject);
    if (!seen) continue;
    const what = predicates.find((p) => p.iri === c.predicate)?.label ?? words(c.predicate);
    signals.push({ kind: 'contradiction', reason: `${seen.name}: two answers for ${what.toLowerCase()}`, about: c.subject });
  }
  return { signals, following, names };
}

const wire = ({ shows: _s, heading: _h, empty: _e, ...door }: AtlasDoor): HomeDoor => door;

export async function home(kg: Knowledge, follows: Follows, person: string, floor: string, doors: AtlasDoor[] = DOORS): Promise<Home> {
  const { signals, following } = await gather(kg, follows, person, floor);
  return { doors: doors.map(wire), signals, firstDay: following.length === 0, following };
}

/** What is behind one door, or undefined when there is no such door. An unavailable door lists nothing. */
export async function doorList(kg: Knowledge, follows: Follows, person: string, floor: string, id: string, doors: AtlasDoor[] = DOORS): Promise<DoorList | undefined> {
  const door = doors.find((d) => d.id === id);
  if (!door) return undefined;
  const base = { door: door.id, heading: door.heading, empty: door.unavailable ? `${door.unavailable.why}. ${door.unavailable.who} can change that.` : door.empty };
  if (door.unavailable) return { ...base, items: [] };
  const { signals, following, names } = await gather(kg, follows, person, floor);
  if (door.shows === 'following') return { ...base, items: following.map((f) => ({ id: f.id, title: f.label, detail: names.get(f.id)?.kind ?? '' })) };
  const reads = new Set(door.reads);
  const about = new Map<string, string[]>();
  for (const s of signals) if (reads.has(s.kind) && s.about) about.set(s.about, [...(about.get(s.about) ?? []), s.reason.slice(s.reason.indexOf(': ') + 2)]);
  return { ...base, items: [...about].map(([thing, why]) => ({ id: thing, title: names.get(thing)?.name ?? 'Not yet named', detail: why.join(' · ') })) };
}
