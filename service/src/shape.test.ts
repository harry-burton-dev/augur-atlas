import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { choose, guessRole, rulesFor, sayDate, shownBeliefs, toView, type KBelief, type KClass, type KConflicts, type KEntity, type KPredicate, type ThingInput } from './shape.ts';

// The knowledge graph review's store (42 things, 298 observations) as the knowledge service would answer
// for Alex on Fri 20 Nov 2026, standing on her team's floor with her own: round 10's evidence, as data.
const store = JSON.parse(readFileSync(new URL('./fixtures/store.json', import.meta.url), 'utf8')) as {
  now: string;
  viewer: string;
  entities: KEntity[];
  classes: KClass[];
  predicates: KPredicate[];
  beliefs: KBelief[];
  conflicts: KConflicts;
  sources: Record<string, { id: string; title: string; author: string; who: string; on: string; floor: string }>;
  reports: Record<string, number>;
};
const now = new Date(store.now);
const inputFor = (id: string): ThingInput => ({
  entity: store.entities.find((e) => e.id === id)!,
  beliefs: store.beliefs.filter((b) => b.subject === id),
  edges: store.beliefs.filter((b) => b.kind === 'link' && b.state !== 'superseded' && (b.subject === id || b.object === id)),
  nodes: store.entities,
  conflicts: store.conflicts,
  neighbourBeliefs: store.beliefs.filter((b) => b.state !== 'superseded' && store.beliefs.some((l) => l.kind === 'link' && l.object === id && l.subject === b.subject)),
  predicates: store.predicates,
  classes: store.classes,
  reports: store.reports[id] ?? 0,
  now,
});
const sourceOf = (b: KBelief) => {
  const s = store.sources[b.evidence.seen!.at(-1)!]!;
  return { id: s.id, who: s.who, on: s.on, title: s.title, ...(s.author === store.viewer ? { byYou: true } : {}), ...(s.floor.startsWith('you-') ? { yours: true } : {}) };
};
const view = (id: string) => {
  const input = inputFor(id);
  return toView(input, choose(input), sourceOf);
};
const GRAPH_WORDS = /\b(entity|belief|observation|predicate|node|edge|graph|ontology|triple|provenance|superseded|schema)\b/i;

describe('the one shape, on every thing in the store', () => {
  it.each(store.entities.map((e) => [e.id]))('%s fills every slot or says it is empty, in plain words', (id) => {
    const v = view(id);
    expect(v.name).toBeTruthy();
    expect(v.answer.length).toBeLessThanOrEqual(2);
    expect(new Set(v.around.map((a) => a.id)).size).toBe(v.around.length);
    expect(JSON.stringify([v.answer, v.problems, v.facts.map((f) => [f.label, f.value]), v.around.map((a) => a.relation)])).not.toMatch(GRAPH_WORDS);
    for (const line of [...v.answer, ...v.problems]) if (line.source) expect(line.source.title).toBeTruthy();
  });

  it('answers the busiest thing with its state now and what is next, and says what disagrees', () => {
    const v = view('mv-saltmarsh-heron');
    expect(v.answer.map((a) => a.key)).toEqual(['now', 'next']);
    expect(v.answer[0]!.value).toBe('Discharging at Ardmor');
    expect(v.answer[1]!.value).toContain('Port of Kessick');
    expect(v.answer[1]!.source!.how).toBe('forecast');
    expect(v.problems[0]!.kind).toBe('conflict');
  });

  it('says what is due here, from the thing that is coming', () => {
    const v = view('port-of-kessick');
    expect(v.answer[0]!.key).toBe('next');
    expect(v.answer[0]!.value).toContain('MV Saltmarsh Heron, Tue 24 Nov');
  });

  it('says a person may be two', () => {
    expect(view('marta-kowal').problems.map((p) => p.kind)).toContain('duplicate');
  });

  it('answers an event with what it was', () => {
    expect(view('tern-bay-mooring-line-incident').answer[0]!.key).toBe('what');
  });

  it('says a forecast that passed with nothing newer is overdue', () => {
    expect(view('crane-c2-replacement-gearbox').problems.map((p) => p.kind)).toContain('slipped');
  });

  it('reads a turned-round link with its inverse label', () => {
    const v = view('brannock-lines');
    expect(v.around.some((a) => a.relation === 'Runs')).toBe(true);
  });

  it('answers a thing with nothing of its own by what is around it, or says little is known', () => {
    expect(view('dana-holt').answer[0]!.key).toBe('known-for');
    const alex = view('alex');
    expect(alex.answer).toEqual([]);
    expect(alex.facts).toEqual([]);
  });

  it('reads sources only for the lines that show at rest', () => {
    const input = inputFor('mv-saltmarsh-heron');
    expect(shownBeliefs(choose(input)).length).toBeLessThanOrEqual(7);
    expect(input.beliefs.length).toBeGreaterThan(20);
  });

  it('prefers the role the ontology serves over a guess', () => {
    const input = inputFor('mv-saltmarsh-heron');
    const b = input.beliefs.find((x) => x.predicate === 'cargo')!;
    expect(rulesFor(input).roleOf(b)).not.toBe('problem');
    const served = { ...input, predicates: [...input.predicates.filter((p) => p.iri !== 'cargo'), { iri: 'cargo', label: 'Cargo', kind: 'property' as const, singleValued: false, status: 'base', role: 'problem' as const }] };
    expect(rulesFor(served).roleOf(b)).toBe('problem');
  });

  it('marks a label nobody adopted, and keeps an adopted one', () => {
    const input = inputFor('mv-saltmarsh-heron');
    expect(rulesFor(input).labelOf('operatedBy')).toEqual({ label: 'Operated by', adopted: true });
    expect(rulesFor(input).labelOf('dischargedCargoTeu')).toEqual({ label: 'Discharged cargo teu', adopted: false });
  });
});

describe('guessRole', () => {
  it('reads a forecast as next, and a damage report as a problem unless it says none', () => {
    expect(guessRole({ predicate: 'forecastArrivalDate', kind: 'property', modality: 'expected', value: { v: '2026-11-24' } })).toBe('next');
    expect(guessRole({ predicate: 'damage', kind: 'property', modality: 'reported', value: { v: 'dented rail' } })).toBe('problem');
    expect(guessRole({ predicate: 'damage', kind: 'property', modality: 'reported', value: { v: 'none' } })).not.toBe('problem');
  });
});

describe('sayDate', () => {
  it('says a near date with its day, a far one with its year', () => {
    expect(sayDate('2026-11-24', now)).toBe('Tue 24 Nov');
    expect(sayDate('2025-03-01', now)).toBe('1 Mar 2025');
  });
});
