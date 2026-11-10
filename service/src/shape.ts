// The one shape every thing's page takes (App patterns, "A thing's page"; Data Atlas PDR-002): rules that fill
// its slots from what the knowledge graph believes, for any kind, with no design per kind. Pure: the service
// reads the graph, this chooses, and `toView` turns the choice into the ThingView the kit draws.
//
// Two passes, so the service fetches sources only for the lines that show: `choose` picks a belief for each
// slot, `shownBeliefs` lists them, and `toView` writes the lines with each one's trust line.
import type { ThingAnswerKey, ThingProblemKind, ThingSource, ThingView } from './api-types.ts';

/** What a predicate does on a page (ADR 0099). Served by GET /ontology once the knowledge service has it; guessed until then. */
export type Role = 'status' | 'next' | 'problem' | 'resolves' | 'outcome' | 'identity' | 'time' | 'quantity' | 'party' | 'place' | 'thing' | 'other';

export interface KValue {
  v: string | number | boolean;
  unit?: string;
  approx?: boolean;
}
export interface KEntity {
  id: string;
  class: string;
  kind?: string;
  state?: string;
  label?: string;
  aliases?: string[];
}
export interface KBelief {
  id: string;
  subject: string;
  predicate: string;
  kind: 'property' | 'link';
  value?: KValue;
  object?: string;
  modality: string;
  validFrom?: string;
  validTo?: string;
  recordedAt: string;
  endedAt?: string;
  supersededAt?: string;
  state: string;
  evidence: { observations: number; sources: number; seen?: string[] };
}
export interface KPredicate {
  iri: string;
  label: string;
  kind: 'property' | 'link';
  datatype?: string;
  singleValued: boolean;
  status: string;
  role?: Role | null;
  inverseLabel?: string | null;
}
export interface KClass {
  iri: string;
  label: string;
  kind: 'continuant' | 'occurrent';
}
export interface KConflicts {
  conflicts: { subject: string; predicate: string; beliefs: string[] }[];
  possibleDuplicates: { entity: string; predicate: string }[];
}

/** Everything the rules read about one thing, as one person sees it on one floor. */
export interface ThingInput {
  entity: KEntity;
  /** Live beliefs about it (GET …/beliefs). */
  beliefs: KBelief[];
  /** Links in sight one step out, both ways, and the things they reach (GET …/subgraph?depth=1). */
  edges: KBelief[];
  nodes: KEntity[];
  conflicts: KConflicts;
  /** For each thing a "next" link points here from, its own live beliefs: so "Due here" can say when. */
  neighbourBeliefs?: KBelief[];
  predicates: KPredicate[];
  classes: KClass[];
  /** How many reports name it, for the empty answer. */
  reports: number;
  now: Date;
}

/** The ranking's weights (PDR-002's cold start): a role's weight, times the reports behind it, decayed by age. */
export interface Ranking {
  weights: Record<Role, number>;
  /** Days for the age decay: a fact this old counts half. */
  halfAgeDays: number;
  /** A state older than this is "Last heard", not "Now". */
  freshDays: number;
}
export const DEFAULT_RANKING: Ranking = {
  weights: { problem: 4, status: 3.5, next: 3.5, resolves: 3, outcome: 3, identity: 2, party: 2, place: 2, quantity: 1.5, thing: 1.5, time: 1, other: 0.5 },
  halfAgeDays: 14,
  freshDays: 10,
};

const FORECAST = new Set(['expected', 'planned', 'possible']);
const DAY = 86_400_000;

/** A guess at a predicate's role from its name and what it links to, until the ontology serves one. Round 10's rule. */
export function guessRole(p: Pick<KBelief, 'predicate' | 'kind' | 'value' | 'modality'>, objectClass?: KClass): Role {
  const name = local(p.predicate).toLowerCase();
  const v = String(p.value?.v ?? '').toLowerCase();
  if (!FORECAST.has(p.modality) && !/^(forecast|expected|planned)/.test(name) && /arriv|called|came|commission|depart|left|completed/.test(name)) return 'outcome';
  if (p.kind === 'link') {
    if (/ing(at|in|for)$/.test(name) || name.startsWith('indrydock')) return 'status';
    if (FORECAST.has(p.modality) || /forecast|expected|planned|next|scheduled|due/.test(name)) return 'next';
    if (objectClass?.kind === 'occurrent') return 'thing';
    const c = (objectClass?.label ?? '').toLowerCase();
    if (/person|organi[sz]ation|company|team/.test(c)) return 'party';
    if (/place|port|city|facility|berth|site|location/.test(c)) return 'place';
    return 'thing';
  }
  if (/held|damage|defect|fail|incident|delay|risk|injur|overrun|variance|complain|dispute|shortage|finding/.test(name) && !/^(none|no |0\b|not )/.test(v)) return 'problem';
  if (FORECAST.has(p.modality) || /forecast|expected|planned|next|scheduled|due|requested/.test(name)) return 'next';
  if (/status|availability|discharging|condition|state/.test(name)) return 'status';
  if (/description|role|type|scope|department|priority|capacity/.test(name)) return 'identity';
  if (/^\d{4}-\d{2}/.test(v)) return 'time';
  if (typeof p.value?.v === 'number' || /^[£$€]?\d/.test(v)) return 'quantity';
  return 'other';
}

/** The last part of an IRI, or the name itself. */
export const local = (iri: string) => iri.replace(/^.*[#/:]/, '');
/** A stored name split into words, for a term nobody has adopted: "forecastArrivalDate" → "Forecast arrival date". */
export const words = (name: string) => {
  const w = local(name).replace(/(?<!^)(?=[A-Z])/g, ' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const stem = (p: string) => local(p).replace(/(Date|Port|Berth|Time|At|In)$/, '');
const dateOf = (b: KBelief) => b.validFrom ?? b.recordedAt;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

/** A date as a person says it: "Tue 24 Nov" this season, "24 Nov 2025" otherwise. */
export function sayDate(iso: string, now: Date, locale = 'en-GB'): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const near = Math.abs(d.getTime() - now.getTime()) < 60 * DAY;
  return d.toLocaleDateString(locale, near ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
}

export interface Rules {
  roleOf: (b: KBelief) => Role;
  labelOf: (iri: string) => { label: string; adopted: boolean };
  inverseOf: (iri: string) => string | undefined;
  nameOf: (id: string) => string | undefined;
  value: (b: KBelief) => string;
  rank: (b: KBelief) => number;
}

/** The rules for one thing: roles, labels and values, from the ontology where it has them. */
export function rulesFor(input: ThingInput, ranking: Ranking = DEFAULT_RANKING): Rules {
  const preds = new Map(input.predicates.filter((p) => p.status !== 'dismissed').map((p) => [p.iri, p]));
  const classes = new Map(input.classes.map((c) => [c.iri, c]));
  const nodes = new Map([input.entity, ...input.nodes].map((n) => [n.id, n]));
  const nameOf = (id: string) => nodes.get(id)?.label;
  const roleOf = (b: KBelief): Role => preds.get(b.predicate)?.role ?? guessRole(b, b.object ? classes.get(nodes.get(b.object)?.class ?? '') : undefined);
  const value = (b: KBelief): string => {
    if (b.kind === 'link') return (b.object && nameOf(b.object)) ?? 'something not yet named';
    const v = b.value?.v;
    if (v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    const text = isDate(v) ? sayDate(v, input.now) + v.slice(10).replace(/^T.*$/, '') : String(v);
    const withUnit = b.value?.unit && typeof v === 'number' ? `${text} ${b.value.unit}` : text;
    return (b.value?.approx ? 'About ' + withUnit : withUnit.charAt(0).toUpperCase() + withUnit.slice(1)).trim();
  };
  const rank = (b: KBelief) => {
    const age = Math.max(0, (input.now.getTime() - new Date(b.recordedAt).getTime()) / DAY);
    return ranking.weights[roleOf(b)] * (1 + b.evidence.sources) / (1 + age / ranking.halfAgeDays);
  };
  return {
    roleOf,
    labelOf: (iri) => {
      const p = preds.get(iri);
      return p && p.status !== 'proposed' ? { label: p.label, adopted: true } : { label: words(iri), adopted: false };
    },
    inverseOf: (iri) => preds.get(iri)?.inverseLabel ?? undefined,
    nameOf,
    value,
    rank,
  };
}

type Line = { key: ThingAnswerKey; text: string; beliefs: KBelief[] };
type Problem = { kind: ThingProblemKind; text: string; beliefs: KBelief[] };
type Fact = { label: string; adopted: boolean; text: string; belief: KBelief };
type Neighbour = { id: string; relation: string; name: string; group: string; belief: KBelief };

/** Each slot's choice, before sources are read. */
export interface Choice {
  answer: Line[];
  problems: Problem[];
  facts: Fact[];
  around: Neighbour[];
}

const GROUP: [RegExp, string][] = [
  [/person/i, 'People'],
  [/organi[sz]ation|company|team/i, 'Companies'],
  [/place|port|city|facility|berth|site/i, 'Places'],
];

/** Fills the shape's slots for one thing. Every slot has a rule for when it is empty. */
export function choose(input: ThingInput, rules: Rules = rulesFor(input), ranking: Ranking = DEFAULT_RANKING): Choice {
  const { entity, now } = input;
  const live = input.beliefs.filter((b) => b.subject === entity.id && !b.supersededAt && !b.endedAt && b.state !== 'fallen' && b.state !== 'superseded' && b.state !== 'ended');
  const byRole = (r: Role) => live.filter((b) => rules.roleOf(b) === r);
  const newest = (bs: KBelief[]) => [...bs].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  const today = now.toISOString().slice(0, 10);
  const ahead = (b: KBelief) => isDate(b.value?.v) && String(b.value!.v).slice(0, 10) >= today;
  const fresh = (b: KBelief) => now.getTime() - new Date(dateOf(b)).getTime() <= ranking.freshDays * DAY;
  const occurrent = input.classes.find((c) => c.iri === entity.class)?.kind === 'occurrent';
  const said = (b: KBelief) => (b.kind === 'link' ? `${rules.labelOf(b.predicate).label} ${rules.value(b)}` : rules.value(b));

  // The answer. An event: what and when. A thing that lasts: its state now, and what is next.
  const answer: Line[] = [];
  if (occurrent) {
    const what = byRole('identity')[0];
    const at = byRole('time')[0];
    if (what) answer.push({ key: 'what', text: rules.value(what), beliefs: [what] });
    if (at) answer.push({ key: 'when', text: rules.value(at), beliefs: [at] });
  } else {
    const now_ = newest(byRole('status').filter(fresh))[0];
    if (now_) answer.push({ key: 'now', text: said(now_), beliefs: [now_] });
    const next = byRole('next')
      .filter((b) => b.kind === 'property' && ahead(b))
      .sort((a, b) => String(a.value!.v).localeCompare(String(b.value!.v)))[0];
    if (next) {
      // A dated forecast paired with its place, when one shares its stem ("forecastArrivalDate" and "forecastArrivalPort").
      const mate = live.find((b) => b !== next && b.kind === 'link' && stem(b.predicate) === stem(next.predicate));
      answer.push({ key: 'next', text: `${rules.labelOf(next.predicate).label}: ${mate ? `${rules.value(mate)}, ` : ''}${rules.value(next)}`, beliefs: mate ? [next, mate] : [next] });
    } else {
      // Or something due here: a "next" link pointing at it, with its date on the thing that is coming.
      const due = input.edges
        .filter((b) => b.object === entity.id && b.subject !== entity.id && rules.roleOf(b) === 'next')
        .flatMap((b) => {
          const date = (input.neighbourBeliefs ?? []).find((x) => x.subject === b.subject && x.kind === 'property' && stem(x.predicate) === stem(b.predicate) && ahead(x));
          return date ? [{ b, date }] : [];
        })
        .sort((x, y) => String(x.date.value!.v).localeCompare(String(y.date.value!.v)))[0];
      if (due) answer.push({ key: 'next', text: `${rules.inverseOf(due.b.predicate) ?? rules.labelOf(due.b.predicate).label}: ${rules.nameOf(due.b.subject) ?? 'Not yet named'}, ${rules.value(due.date)}`, beliefs: [due.date, due.b] });
    }
  }
  if (!answer.length) {
    const ident = byRole('identity')[0];
    if (ident) answer.push({ key: 'what', text: rules.value(ident), beliefs: [ident] });
  }
  if (!answer.length) {
    const old = newest(byRole('status'))[0];
    if (old) answer.push({ key: 'last-heard', text: said(old), beliefs: [old] });
  }

  // What's wrong: reports that disagree, a possible duplicate, a problem, a forecast that passed with nothing newer.
  const byId = new Map(input.beliefs.map((b) => [b.id, b]));
  const problems: Problem[] = [];
  for (const c of input.conflicts.conflicts.filter((c) => c.subject === entity.id)) {
    const bs = c.beliefs.map((id) => byId.get(id)).filter((b): b is KBelief => Boolean(b));
    if (bs.length) problems.push({ kind: 'conflict', text: `${rules.labelOf(c.predicate).label}: ${[...new Set(bs.map(rules.value))].join(' or ')}`, beliefs: bs });
  }
  for (const d of input.conflicts.possibleDuplicates.filter((d) => d.entity === entity.id)) {
    const bs = live.filter((b) => b.predicate === d.predicate);
    problems.push({ kind: 'duplicate', text: `${rules.labelOf(d.predicate).label}: ${[...new Set(bs.map(rules.value))].join(' or ') || 'more than one'}`, beliefs: bs });
  }
  // A problem is put right by a newer belief that resolves it; until retain ends it at write time (ADR 0099).
  const resolvedAt = newest(byRole('resolves'))[0];
  const told = new Set<string>();
  for (const b of byRole('problem').sort((a, b) => rules.rank(b) - rules.rank(a))) {
    // One line per kind of trouble: "delayCause" and "delay" are one problem told twice.
    const kind = local(b.predicate).toLowerCase().replace(/[^a-z]/g, '').slice(0, 6);
    if (told.has(kind) || problems.some((p) => p.beliefs.includes(b)) || (resolvedAt && dateOf(resolvedAt) >= dateOf(b))) continue;
    told.add(kind);
    problems.push({ kind: 'problem', text: `${rules.labelOf(b.predicate).label}: ${rules.value(b)}`, beliefs: [b] });
  }
  const outcomes = byRole('outcome');
  for (const b of byRole('next')) {
    if (b.kind !== 'property' || !isDate(b.value?.v) || ahead(b) || !FORECAST.has(b.modality) || !/^(forecast|expected)/i.test(local(b.predicate))) continue;
    if (outcomes.some((o) => dateOf(o).slice(0, 10) >= String(b.value!.v).slice(0, 10))) continue;
    problems.push({ kind: 'slipped', text: `${rules.labelOf(b.predicate).label} ${rules.value(b)} has passed, with nothing newer`, beliefs: [b] });
  }

  // Key facts: the rest of its own properties, ranked; never a problem, never a forecast that has passed.
  const used = new Set([...answer, ...problems.slice(0, 1)].flatMap((l) => l.beliefs));
  const facts: Fact[] = live
    .filter((b) => !used.has(b) && b.kind === 'property' && rules.roleOf(b) !== 'problem' && !(rules.roleOf(b) === 'next' && !ahead(b)))
    .sort((a, b) => rules.rank(b) - rules.rank(a))
    .map((b) => ({ ...rules.labelOf(b.predicate), text: rules.value(b), belief: b }));

  // Around it: one sentence per thing it touches, from its side, turned-round links read with their inverse label.
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const around: Neighbour[] = [];
  const links = [...live.filter((b) => b.kind === 'link' && !['next', 'status'].includes(rules.roleOf(b))), ...input.edges.filter((b) => b.object === entity.id && b.subject !== entity.id)];
  for (const b of links.sort((a, b) => rules.rank(b) - rules.rank(a))) {
    const out = b.subject === entity.id;
    const other = out ? b.object! : b.subject;
    const node = nodes.get(other);
    if (!node || other === entity.id || seen.has(other)) continue;
    seen.add(other);
    const cls = input.classes.find((c) => c.iri === node.class);
    const group = cls?.kind === 'occurrent' ? 'Events' : (GROUP.find(([re]) => re.test(cls?.label ?? node.class))?.[1] ?? 'Things');
    const relation = out ? rules.labelOf(b.predicate).label : (rules.inverseOf(b.predicate) ?? 'Mentioned with it');
    around.push({ id: other, relation, name: node.label ?? 'Not yet named', group, belief: b });
  }
  if (!answer.length && around[0]) {
    const top = around[0];
    answer.push({ key: 'known-for', text: top.relation === 'Mentioned with it' ? `Named with ${top.name}` : `${top.relation} ${top.name}`, beliefs: [top.belief] });
  }
  return { answer, problems, facts, around };
}

/** The beliefs whose sources the page shows, at rest: so the service reads only those. */
export function shownBeliefs(choice: Choice, caps = { answer: 2, facts: 4 }): KBelief[] {
  return [...choice.answer.slice(0, caps.answer).flatMap((l) => l.beliefs.slice(0, 1)), ...choice.problems.slice(0, 1).flatMap((p) => p.beliefs.slice(0, 1)), ...choice.facts.slice(0, caps.facts).map((f) => f.belief)];
}

/** Where one belief came from, as the trust line needs it: its newest source in sight, read by the service. */
export type SourceOf = (b: KBelief) => Omit<ThingSource, 'how' | 'reports'> | undefined;

/** The page, ready to send. */
export function toView(input: ThingInput, choice: Choice, sourceOf: SourceOf): ThingView {
  const src = (bs: KBelief[]): ThingSource | undefined => {
    const b = bs[0];
    const s = b && sourceOf(b);
    if (!b || !s) return undefined;
    return { ...s, how: FORECAST.has(b.modality) ? 'forecast' : 'as-written', reports: Math.max(...bs.map((x) => x.evidence.sources)) };
  };
  const cls = input.classes.find((c) => c.iri === input.entity.class);
  const nonEmpty = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return {
    id: input.entity.id,
    name: input.entity.label ?? 'Not yet named',
    kind: { name: cls?.label ?? words(input.entity.class), icon: iconFor(cls?.label ?? input.entity.class, cls?.kind) },
    ...(input.entity.aliases?.length ? { aliases: input.entity.aliases.slice(0, 2) } : {}),
    answer: choice.answer.map((l) => nonEmpty({ key: l.key, value: l.text, source: src(l.beliefs) })),
    problems: choice.problems.map((p) => nonEmpty({ kind: p.kind, text: p.text, source: src(p.beliefs) })),
    facts: choice.facts.slice(0, 10).map((f) => nonEmpty({ label: f.label, value: f.text, adopted: f.adopted ? undefined : false, source: src([f.belief]) })),
    around: choice.around.map(({ id, relation, name, group }) => ({ id, relation, name, group })),
    total: input.beliefs.length + input.edges.filter((b) => b.object === input.entity.id).length,
    reports: input.reports,
  };
}

/** A kind's icon, from the kit's set, by what the kind is called. Anything else gets the plain one. */
export function iconFor(kind: string, nature?: string): string {
  const k = kind.toLowerCase();
  if (nature === 'occurrent') return /meeting/.test(k) ? 'calendar' : 'event';
  if (/ship|vessel/.test(k)) return 'vessel';
  if (/port/.test(k)) return 'port';
  if (/person/.test(k)) return 'person';
  if (/organi[sz]ation|company/.test(k)) return 'org';
  if (/project/.test(k)) return 'folder';
  if (/facility|equipment|berth/.test(k)) return 'facility';
  if (/place|city/.test(k)) return 'place';
  return 'structure';
}
