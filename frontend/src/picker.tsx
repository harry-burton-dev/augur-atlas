import { useEffect, useRef, useState } from 'react';
import type { EntityRef } from '@augur/mfe-sdk';
import { Button, Heading, List, Select, Tag, TextField, type IconName, type ListItem, type SelectOption } from '@augur/app-kit';
import { entityLine, typeTree, type AtlasApi, type Entity, type Ontology } from './api.js';

/** An entity as the picker answers with it: the SDK's EntityRef. */
export const refOf = (e: Entity): EntityRef => ({ kind: 'entity', id: e.id, type: e.type, label: e.label });

/** The kinds asked for and every kind below them; all of them when none were asked for. */
export const kindsOffered = (ontology: Ontology, asked: readonly string[]) => {
  const tree = typeTree(ontology);
  if (!asked.length) return tree;
  const keep = new Set(asked.filter((a) => ontology.types.some((t) => t.key === a)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of ontology.types)
      if (t.parent && keep.has(t.parent) && !keep.has(t.key)) {
        keep.add(t.key);
        grew = true;
      }
  }
  return tree.filter((t) => keep.has(t.type.key));
};

export interface PickerProps {
  api: AtlasApi;
  /** What the asking app says it's for: "Bind to this intent". */
  purpose?: string;
  /** Kinds the asking app takes; none for any. */
  types?: string[];
  multiple?: boolean;
  floorName?: string;
  onPicked: (entities: EntityRef[]) => void;
  onCancel: () => void;
}

/**
 * Data Atlas answering `entity.pick` for another app: find what shows from this
 * floor by name, other name or identity key, narrowed to the kinds asked for.
 * One entity is picked with a press; with `multiple`, presses gather a list to
 * give back together. What isn't offered says why, rather than vanishing.
 */
export function Picker({ api, purpose = '', types = [], multiple = false, floorName = '', onPicked, onCancel }: PickerProps) {
  const [ontology, setOntology] = useState<Ontology>();
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const list = async (o: Ontology | undefined, k: string, q: string) => {
    const mine = ++asked.current;
    setLoading(true);
    setFailure('');
    try {
      const kinds = k ? [k] : types.length && o ? kindsOffered(o, types).map((t) => t.type.key) : undefined;
      const found = kinds && !kinds.length ? { entities: [], total: 0 } : await api.entities({ q: q.trim(), type: kinds, limit: 50 });
      if (mine !== asked.current) return;
      setEntities(found.entities);
      setTotal(found.total);
    } catch (err) {
      if (mine === asked.current) setFailure((err as Error).message);
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  };

  useEffect(() => {
    let live = true;
    void api
      .ontology()
      .then((o) => {
        if (!live) return;
        setOntology(o);
        return list(o, '', '');
      })
      .catch((err: Error) => {
        if (!live) return;
        setFailure(err.message);
        setLoading(false);
      });
    return () => {
      live = false;
      clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const search = (q: string) => {
    setQuery(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void list(ontology, kind, q), 200);
  };

  const choose = (e: Entity) => {
    if (!multiple) return onPicked([refOf(e)]);
    setPicked((now) => (now.some((p) => p.id === e.id) ? now.filter((p) => p.id !== e.id) : [...now, e]));
  };

  const offered = ontology ? kindsOffered(ontology, types) : [];
  const options: SelectOption[] = [
    { value: '', label: types.length ? 'Any of the kinds asked for' : 'Any kind' },
    ...offered.map(({ type, depth }) => ({ value: type.key, label: `${'  '.repeat(depth)}${type.abstract ? `All ${type.plural.toLowerCase()}` : type.plural}` })),
  ];
  const chosen = new Set(picked.map((p) => p.id));
  const rows: ListItem[] = entities.map((e) => ({
    id: e.id,
    title: e.label,
    detail: entityLine(ontology, e),
    icon: (chosen.has(e.id) ? 'check' : (ontology?.types.find((t) => t.key === e.type)?.icon ?? 'atlas')) as IconName,
  }));
  const where = floorName ? `from ${floorName}` : 'from this floor';
  const askedFor = types.length && ontology ? offered.filter((t) => types.includes(t.type.key)).map((t) => t.type.plural.toLowerCase()) : [];
  const empty = query.trim()
    ? `Nothing that shows ${where} matches that. Something kept on a floor below or beside this one won’t show here: go to that floor to pick it.`
    : `Nothing shows ${where} yet. Add it in Data Atlas first.`;
  return (
    <div className="atlas-picker">
      <Heading
        eyebrow="Pick from Data Atlas"
        heading={purpose || (multiple ? 'Pick entities' : 'Pick an entity')}
        summary={`Find one by its name, another name it goes by, or a key like an IMO number. What shows is what can be seen ${where}.`}
      />
      {askedFor.length ? <p className="atlas-note">Only {askedFor.join(', ')} are asked for here, with their kinds below them.</p> : null}
      <div className="atlas-find">
        <TextField label="Find" placeholder="Name, other name or key" value={query} onChange={search} />
        <Select
          label="Kind"
          options={options}
          value={kind}
          onChange={(v) => {
            if (v === kind) return;
            setKind(v);
            void list(ontology, v, query);
          }}
        />
      </div>
      <List
        label="Entities to pick from"
        density="compact"
        noun={['entity', 'entities']}
        items={rows}
        loading={loading}
        error={failure}
        empty={empty}
        onOpen={(item) => {
          const entity = entities.find((x) => x.id === item.id);
          if (entity) choose(entity);
        }}
      />
      {total > entities.length ? (
        <p className="atlas-note">
          Showing the first {entities.length} of {total}. Narrow it with Find or Kind.
        </p>
      ) : null}
      {multiple && picked.length ? (
        <div className="atlas-tags" aria-label="Picked">
          {picked.map((p) => (
            <Tag key={p.id} label={p.label} onRemove={() => choose(p)} />
          ))}
        </div>
      ) : null}
      <div className="atlas-actions atlas-end">
        <Button kind="ghost" size="sm" onPress={onCancel}>
          Cancel
        </Button>
        {multiple ? (
          <Button kind="primary" size="sm" disabled={!picked.length} reason="Pick at least one first." onPress={() => onPicked(picked.map(refOf))}>
            {picked.length > 1 ? `Pick these ${picked.length}` : 'Pick it'}
          </Button>
        ) : null}
      </div>
      {multiple && !picked.length ? <p className="atlas-note">Pick at least one to go on.</p> : null}
    </div>
  );
}
