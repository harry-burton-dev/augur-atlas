// "Everything we know" (App patterns, "A thing's page": the way to everything, one step from the page): every
// belief in sight about a thing, in three plain sections. What is true now, best first by the page's own
// ranking; what it is linked to, both ways, in the words of each link; and what was true before. Pure, like
// shape.ts: the service reads the graph and this writes the rows.
import type { Everything, EverythingRow } from './api-types.ts';
import { rulesFor, sayDate, type KBelief, type Rules, type ThingInput } from './shape.ts';

const MODALITY: Record<string, string> = { expected: 'Expected', planned: 'Planned', possible: 'Possibly', denied: 'Said not to be' };
const gone = (b: KBelief) => !!b.supersededAt || !!b.endedAt || b.state === 'superseded' || b.state === 'ended' || b.state === 'fallen';

/** When it was said, how sure, and how many reports agree, in a few words. */
const detailOf = (b: KBelief, now: Date) => {
  const said = `Said ${sayDate(b.validFrom ?? b.recordedAt, now)}`;
  const how = MODALITY[b.modality];
  const reports = b.evidence.sources === 1 ? 'one report' : `${b.evidence.sources} reports`;
  const until = b.supersededAt ?? b.endedAt;
  return [how, said, until ? `until ${sayDate(until, now)}` : undefined, reports].filter(Boolean).join(' · ');
};

export function everything(input: ThingInput, rules: Rules = rulesFor(input)): Everything {
  const { entity, now } = input;
  const own = input.beliefs.filter((b) => b.subject === entity.id);
  const row = (b: KBelief, label: string, value: string, opens?: string): EverythingRow => ({ belief: b.id, label, value, detail: detailOf(b, now), ...(opens ? { opens } : {}) });

  const current = own.filter((b) => !gone(b) && b.kind !== 'link').sort((a, b) => rules.rank(b) - rules.rank(a));
  const outward = own.filter((b) => !gone(b) && b.kind === 'link' && b.object);
  // A link pointing here is said in its inverse words when the ontology has them ("Due here"), else as "<link> of".
  const inward = input.edges.filter((b) => !gone(b) && b.kind === 'link' && b.object === entity.id && b.subject !== entity.id);
  const links = [
    ...outward.map((b) => row(b, rules.labelOf(b.predicate).label, rules.value(b), b.object)),
    ...inward.map((b) => row(b, rules.inverseOf(b.predicate) ?? `${rules.labelOf(b.predicate).label} of`, rules.nameOf(b.subject) ?? 'something not yet named', b.subject)),
  ].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  const before = own.filter(gone).sort((a, b) => (b.supersededAt ?? b.endedAt ?? b.recordedAt).localeCompare(a.supersededAt ?? a.endedAt ?? a.recordedAt));

  return {
    id: entity.id,
    name: entity.label ?? 'Not yet named',
    sections: [
      { key: 'now', label: 'What is known now', rows: current.map((b) => row(b, rules.labelOf(b.predicate).label, rules.value(b))) },
      { key: 'links', label: 'What it is linked to', rows: links },
      { key: 'before', label: 'What was true before', rows: before.map((b) => row(b, rules.labelOf(b.predicate).label, rules.value(b), b.kind === 'link' ? b.object : undefined)) },
    ],
  };
}

/** The lines a person can say are wrong: what the page shows, then everything else known now. */
export function wrongLines(input: ThingInput, shown: KBelief[], rules: Rules = rulesFor(input)): { belief: string; line: string }[] {
  const all = everything(input, rules);
  const rows = all.sections.filter((s) => s.key !== 'before').flatMap((s) => s.rows);
  const first = new Set(shown.map((b) => b.id));
  const ordered = [...rows.filter((r) => first.has(r.belief)), ...rows.filter((r) => !first.has(r.belief))];
  return [...new Map(ordered.map((r) => [r.belief, { belief: r.belief, line: `${r.label}: ${r.value}` }])).values()];
}
