import { useCallback, useEffect, useState } from 'react';
import { Button, Heading, List, Select, type ListItem, type SelectOption } from '@augur/app-kit';
import type { AtlasApi, CheckFinding, Entity, FloorCheck, Ontology } from './api.js';

/** How many entities one press of "Check what's kept" checks. The service takes at most 500. */
const PAGE = 500;

const items = (findings: CheckFinding[], named: boolean): ListItem[] =>
  findings.map((f, i) => ({
    id: `${f.entity}:${i}`,
    title: named ? f.label : f.message,
    detail: named ? f.message : f.fact ? 'In a fact recorded about it' : 'In its details',
    icon: 'warning',
  }));

export interface DoesntFitProps {
  api: AtlasApi;
  entity: Entity;
}

/**
 * "Doesn't fit the ontology" (ADR 0062): what about this entity breaks the
 * ontology's shapes, such as an IMO number kept before its pattern existed.
 * Nothing found, nothing shown: there's nothing to explain. Fixing one is an
 * edit, or a correction of the fact it was found in.
 */
export function DoesntFit({ api, entity }: DoesntFitProps) {
  const [findings, setFindings] = useState<CheckFinding[]>([]);
  const [failure, setFailure] = useState('');
  const load = useCallback(async () => {
    setFailure('');
    try {
      const got = await api.checkEntity(entity.id);
      setFindings(Array.isArray(got.findings) ? got.findings : []);
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api, entity.id]);
  useEffect(() => void load(), [load, entity.updatedAt]);
  if (!failure && !findings.length) return null;
  return (
    <section className="atlas-section atlas-doesnt-fit">
      <Heading
        size="s"
        level={2}
        heading="Doesn’t fit the ontology"
        summary={entity.can.edit ? 'Kept before a rule existed, or brought in some other way. Edit it, or correct the fact, to make it fit.' : `Kept before a rule existed, or brought in some other way. ${entity.can.why ?? 'It can’t be changed from here.'}`}
      />
      <List label="Doesn’t fit the ontology" density="compact" noun={['finding', 'findings']} items={items(findings, false)} error={failure} onRetry={() => void load()} />
    </section>
  );
}

export interface KeptChecksProps {
  api: AtlasApi;
  ontology: Ontology;
  onOpenEntity?: (id: string) => void;
}

/**
 * The studio's Checks tab: everything in sight checked against the ontology's
 * shapes, a page at a time, each finding naming the entity and what's wrong.
 * The shapes themselves can be saved, to check against elsewhere.
 */
export function KeptChecks({ api, ontology, onOpenEntity }: KeptChecksProps) {
  const [type, setType] = useState('');
  const [result, setResult] = useState<FloorCheck>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const kinds: SelectOption[] = [{ value: '', label: 'Every kind' }, ...ontology.types.map((t) => ({ value: t.key, label: t.plural }))];

  const check = async (offset: number) => {
    setBusy(true);
    setFailure('');
    try {
      const got = await api.checks({ ...(type ? { type } : {}), limit: PAGE, offset });
      setResult((was) => (offset && was ? { ...got, offset: was.offset, checked: was.checked + got.checked, findings: [...was.findings, ...got.findings] } : got));
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    try {
      const text = await api.shacl();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/turtle' }));
      a.download = `data-atlas-shapes-v${ontology.version}.ttl`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setFailure((err as Error).message);
    }
  };

  const more = result ? result.total - result.offset - result.checked : 0;
  return (
    <section className="atlas-section atlas-checks">
      <Heading
        size="s"
        level={2}
        heading="Does what’s kept fit?"
        summary="Checks the entities that show from this floor against the ontology’s shapes: patterns, values, units and the kinds a link may reach. What’s added or changed is checked as it’s written; this finds what was kept before a rule existed."
      />
      <div className="atlas-actions">
        <Select label="Kinds to check" value={type} options={kinds} onChange={(v) => setType(v)} />
        <Button kind="secondary" size="sm" disabled={busy} reason="It’s checking." onPress={() => void check(0)}>
          {busy ? 'Checking…' : 'Check what’s kept'}
        </Button>
        <Button kind="ghost" size="sm" onPress={() => void save()}>
          Save the shapes (SHACL)
        </Button>
      </div>
      {result ? (
        <p className="atlas-note" role="status">
          {`Checked ${result.checked} of ${result.total} against version ${result.version}: `}
          {result.findings.length ? `${result.findings.length} ${result.findings.length === 1 ? 'thing doesn’t' : 'things don’t'} fit.` : 'everything fits.'}
        </p>
      ) : null}
      {result?.findings.length || failure ? (
        <List
          label="What doesn’t fit"
          density="compact"
          noun={['finding', 'findings']}
          items={items(result?.findings ?? [], true)}
          error={failure}
          onOpen={onOpenEntity ? (item) => onOpenEntity(item.id.split(':')[0]) : undefined}
          onRetry={() => void check(0)}
        />
      ) : null}
      {more > 0 ? (
        <Button kind="ghost" size="sm" disabled={busy} reason="It’s checking." onPress={() => void check(result!.offset + result!.checked)}>
          {`Check the next ${Math.min(more, PAGE)}`}
        </Button>
      ) : null}
    </section>
  );
}
