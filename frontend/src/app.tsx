import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DocumentRef } from '@augur/mfe-sdk';
import {
  AppFrame,
  Button,
  Details,
  Dialog,
  List,
  PageHead,
  RailLink,
  Select,
  State,
  Tag,
  TextField,
  relativeTime,
  type Detail,
  type DialogSubmit,
  type IconName,
  type ListItem,
  type PageAction,
  type SelectOption,
} from '@augur/app-kit';
import { AtlasError, entityLine, onEntity, typeTree, whyShown, type AtlasApi, type Entity, type EntityFields, type Ontology, type Place } from './api.js';
import { Explorer } from './explorer.js';
import { Knowledge } from './knowledge.js';
import { OntologyView } from './ontology.js';
import { Triage } from './triage.js';
import { UsedBy } from './used-by.js';

type DialogName = 'new' | 'edit' | 'retire';

/** Other names as one line to edit, comma separated. */
const aliasesFrom = (text: string) => [...new Set(text.split(',').map((a) => a.trim()).filter(Boolean))];

export interface AtlasAppProps {
  api: AtlasApi;
  floorName: string;
  floorKind: 'personal' | 'team' | 'org';
  place: Place;
  /** Who is looking: Triage says which proposals are theirs. */
  userId: string;
  /** Asks the person for a document, for an observation's source (the SDK's pickDocument). */
  pickDocument?: () => Promise<DocumentRef>;
  /** Opens a source in the app that keeps it (the SDK's openDocument). */
  openDocument?: (ref: DocumentRef) => void;
  /** Opens an intent in Mandate (its aim.open). */
  openIntent?: (id: string) => void;
  /** The person moved within the app. */
  onPlace?: (place: Place) => void;
}

/**
 * Data Atlas: the things the organisation keeps track of, as seen from the
 * floor the person is standing on. A floor shows what is kept on it and on the
 * floors above it; whatever can't be seen or done says why (explain, never hide).
 */
export function AtlasApp({ api, floorName, floorKind, place: start, userId, pickDocument, openDocument, openIntent, onPlace }: AtlasAppProps) {
  const [place, setPlace] = useState<Place>(start);
  const [ontology, setOntology] = useState<Ontology>();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [seeing, setSeeing] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<Entity>();
  /** Why the entity asked for can't be seen from here. */
  const [unseen, setUnseen] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<DialogName>();
  /** The kind being added, which decides the details asked for. */
  const [newType, setNewType] = useState('');
  const searching = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Read when a place opens, not watched: the ontology once, and the filters as they stand.
  const kept = useRef<{ ontology?: Ontology; q: string; type: string }>({ q: '', type: '' });
  kept.current.q = q;
  kept.current.type = type;
  const keep = (next: Ontology) => {
    kept.current.ontology = next;
    setOntology(next);
  };
  useEffect(() => () => clearTimeout(searching.current), []);

  const move = (to: Place) => {
    setPlace(to);
    onPlace?.(to);
  };

  const list = useCallback(
    async (query: string, kind: string) => {
      const found = await api.entities({ q: query, type: kind, limit: 200 });
      setEntities(found.entities);
      setTotal(found.total);
      setSeeing(found.seeing);
    },
    [api],
  );

  /** Shows a place: the list, the list with Add open, or one entity. */
  const go = useCallback(
    async (to: Place) => {
      setLoading(true);
      setError('');
      setUnseen('');
      setOpen(undefined);
      try {
        if (!kept.current.ontology) keep(await api.ontology());
        if (to.page === 'entity') setOpen(await api.entity(to.id));
        else if (to.page === 'entities' || to.page === 'new') {
          // The explorer, Triage and the ontology ask for their own.
          await list(kept.current.q, kept.current.type);
          setDialog(to.page === 'new' ? 'new' : undefined);
        }
      } catch (err) {
        if (err instanceof AtlasError && err.code === 'unseen') setUnseen(err.message);
        else setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api, list],
  );
  const placeKey = JSON.stringify(place);
  useEffect(() => void go(place), [go, placeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (text: string) => {
    setQ(text);
    clearTimeout(searching.current);
    searching.current = setTimeout(() => void list(text, type).catch((err: Error) => setError(err.message)), 250);
  };

  /** The kinds to pick from when adding: only those an entity can be made of. */
  const kindOptions = (): SelectOption[] => (ontology ? typeTree(ontology).filter(({ type: t }) => !t.abstract).map(({ type: t }) => ({ value: t.key, label: t.label })) : []);

  /** The kinds to filter by: every kind, a heading meaning everything under it. */
  const filterOptions = (): SelectOption[] => {
    const all = { value: '', label: 'Every kind' };
    if (!ontology) return [all];
    return [all, ...typeTree(ontology).map(({ type: t, depth }) => ({ value: t.key, label: `${'  '.repeat(depth)}${t.abstract ? `All ${t.plural.toLowerCase()}` : t.plural}` }))];
  };

  /** The fields as the dialog gave them, turned into what the service takes. */
  const fieldsFrom = (values: Record<string, string>, kind: string): EntityFields => {
    const details: Record<string, string> = {};
    for (const d of ontology ? onEntity(ontology, kind) : []) details[d.key] = values[`detail:${d.key}`] ?? '';
    return { label: values.label, aliases: aliasesFrom(values.aliases ?? ''), description: values.description ?? '', details };
  };

  /** Says a refusal; an identity key someone else holds offers the entity that has it, when it can be seen. */
  const refusal = (err: unknown): never => {
    if (err instanceof AtlasError && err.code === 'key-taken') {
      const holder = err.body.holder as { id: string; hidden?: boolean } | undefined;
      if (holder && !holder.hidden) {
        setDialog(undefined);
        move({ page: 'entity', id: holder.id });
      }
    }
    throw err;
  };

  const submitNew: DialogSubmit = async (values) => {
    const kind = newType || kindOptions()[0]?.value;
    if (!kind) return false as const;
    try {
      const made = await api.createEntity({ ...fieldsFrom(values, kind), type: kind, label: values.label });
      setDialog(undefined);
      move({ page: 'entity', id: made.id });
    } catch (err) {
      refusal(err);
    }
  };
  const submitEdit: DialogSubmit = async (values) => {
    if (!open) return false as const;
    try {
      setOpen(await api.updateEntity(open.id, fieldsFrom(values, open.type)));
      setDialog(undefined);
    } catch (err) {
      refusal(err);
    }
  };
  const submitRetire: DialogSubmit = async () => {
    if (!open) return false as const;
    setOpen(await api.retireEntity(open.id));
    setDialog(undefined);
  };
  const closeDialog = () => {
    const wasNew = dialog === 'new';
    setDialog(undefined);
    if (wasNew && place.page === 'new') move({ page: 'entities' });
  };

  /** Where knowledge shows from, said plainly: the fence is a rule, not a mystery. */
  const seeingLine = () => {
    const levels = seeing.join(', ');
    if (floorKind === 'org') return 'From the org floor, only the org’s own knowledge shows. Your own floor shows every level you belong to.';
    if (floorKind === 'personal') return `From your own floor, everything you can reach shows: ${levels}.`;
    return `From here, what’s kept on this floor and the floors above it shows: ${levels}. Teams below keep their own.`;
  };

  const iconOf = (kind: string) => (ontology?.types.find((t) => t.key === kind)?.icon ?? 'atlas') as IconName;

  const listPage = () => {
    const rows: ListItem[] = entities.map((e) => ({
      id: e.id,
      title: e.label,
      detail: entityLine(ontology, e),
      icon: iconOf(e.type),
      meta: e.aliases.length ? `aka ${e.aliases[0]}` : undefined,
    }));
    return (
      <>
        <PageHead eyebrow={floorName || 'Data Atlas'} heading="Everything here" summary={seeingLine()} actions={[{ id: 'new', label: 'Add an entity', kind: 'secondary' }]} onAction={() => move({ page: 'new' })} />
        <div className="atlas-filters">
          <TextField label="Find" placeholder="A name, another name, or a code such as an IMO number" value={q} onChange={search} />
          <Select
            label="Kind"
            options={filterOptions()}
            value={type}
            onChange={(v) => {
              if (v === type) return;
              setType(v);
              void list(q, v).catch((err: Error) => setError(err.message));
            }}
          />
        </div>
        <List
          label={floorName || 'Data Atlas'}
          noun={['entity', 'entities']}
          items={rows}
          loading={loading}
          error={error}
          empty={q || type ? 'Nothing here matches.' : 'Nothing is kept here yet. Add the first ship, port, organisation or person this floor tracks.'}
          onOpen={(item) => move({ page: 'entity', id: item.id })}
          onRetry={() => void go(place)}
        />
        {total > entities.length ? (
          <p className="atlas-note">
            Showing the first {entities.length} of {total}. Narrow it with Find or Kind.
          </p>
        ) : null}
      </>
    );
  };

  const entityPage = () => {
    const back = (
      <Button kind="ghost" size="sm" onPress={() => move({ page: 'entities' })}>
        Everything here
      </Button>
    );
    if (unseen)
      return (
        <>
          {back}
          <State heading="You can’t see this from here" body={unseen} />
        </>
      );
    if (error)
      return (
        <>
          {back}
          <State kind="error" heading="Couldn’t open it" body={error} action="Try again" onAction={() => void go(place)} />
        </>
      );
    const e = open;
    if (!e || !ontology)
      return (
        <>
          {back}
          <State kind="loading" heading="Opening…" />
        </>
      );
    const kind = ontology.types.find((t) => t.key === e.type);
    const details = onEntity(ontology, e.type);
    const explain = place.page === 'entity' && !!place.explain;
    const actions: PageAction[] = [
      { id: 'explore', label: 'Explore around it' },
      { id: 'edit', label: 'Edit', disabled: !e.can.edit, reason: e.can.why ?? 'You can’t edit what this floor keeps.' },
      { id: 'retire', label: 'Retire', kind: 'ghost', disabled: !e.can.retire, reason: e.can.why ?? 'You can’t retire what this floor keeps.' },
    ];
    const run: Record<string, () => void> = {
      explore: () => move({ page: 'explore', id: e.id }),
      edit: () => setDialog('edit'),
      retire: () => setDialog('retire'),
    };
    return (
      <>
        <PageHead trail={[{ id: 'entities', label: 'Everything here' }]} onTrail={() => move({ page: 'entities' })} eyebrow={kind?.label ?? e.type} heading={e.label} summary={e.description} actions={actions} onAction={(a) => run[a.id]?.()} />
        {e.state === 'retired' ? <p className="atlas-note atlas-retired">Retired {relativeTime(e.updatedAt)}. Its id stays, so whatever points at it still says what it was.</p> : null}
        {e.aliases.length ? (
          <div className="atlas-tags">
            {e.aliases.map((a) => (
              <Tag key={a} quiet label={a} />
            ))}
          </div>
        ) : null}
        <Details
          items={
            [
              ...details.map((d) => ({ label: d.label, value: e.details[d.key] ?? '', ...(d.identity ? { note: 'identity key' } : {}) })),
              { label: 'Kept on', value: e.floorName },
              { label: 'Why it shows here', value: whyShown(e, floorKind, floorName), explained: explain },
              { label: 'Added', value: relativeTime(e.createdAt) },
              ...(kind ? [{ label: 'In the ontology', value: kind.packTerm, note: kind.pack.toUpperCase() }] : []),
            ] satisfies Detail[]
          }
          limit={explain ? 0 : 8}
        />
        <Knowledge api={api} entity={e} ontology={ontology} pickDocument={pickDocument} onOpenEntity={(id) => move({ page: 'entity', id })} />
        <UsedBy api={api} entity={e.id} onOpenIntent={openIntent} onOpenDocument={openDocument} />
      </>
    );
  };

  const detailFields = (kind: string, values: Record<string, string> = {}) =>
    ontology
      ? onEntity(ontology, kind).map((d) => (
          <TextField
            key={`${kind}:${d.key}`}
            name={`detail:${d.key}`}
            label={d.label}
            optional
            maxLength={200}
            hint={[d.hint, d.identity ? 'Says which one it is: no two entities share it' : ''].filter(Boolean).join('. ') || undefined}
            defaultValue={values[d.key] ?? ''}
          />
        ))
      : null;

  const dialogs = () => {
    switch (dialog) {
      case 'new': {
        const kind = newType || kindOptions()[0]?.value || '';
        return (
          <Dialog
            open
            onClose={closeDialog}
            eyebrow={floorName || 'Data Atlas'}
            heading="Add an entity"
            summary={
              floorKind === 'personal'
                ? 'It’s kept on your own floor: only you see it.'
                : floorKind === 'org'
                  ? 'It’s kept on the org floor: everyone sees it.'
                  : 'It’s kept on this floor: its members and the teams below see it, not the floors above.'
            }
            actionLabel="Add it"
            busyLabel="Adding…"
            onSubmit={submitNew}
            fields={
              <>
                <Select label="Kind" options={kindOptions()} value={kind} onChange={setNewType} />
                <TextField name="label" label="Name" required maxLength={200} />
                <TextField name="aliases" label="Other names" optional hint="Separate them with commas" maxLength={2000} />
                <TextField name="description" label="What it is" optional multiline maxLength={2000} />
                {detailFields(kind)}
              </>
            }
          />
        );
      }
      case 'edit': {
        const e = open;
        if (!e) return null;
        return (
          <Dialog
            open
            onClose={() => setDialog(undefined)}
            eyebrow={e.floorName}
            heading={`Edit ${e.label}`}
            actionLabel="Save"
            busyLabel="Saving…"
            onSubmit={submitEdit}
            fields={
              <>
                <TextField name="label" label="Name" required maxLength={200} defaultValue={e.label} />
                <TextField name="aliases" label="Other names" optional hint="Separate them with commas" maxLength={2000} defaultValue={e.aliases.join(', ')} />
                <TextField name="description" label="What it is" optional multiline maxLength={2000} defaultValue={e.description} />
                {detailFields(e.type, e.details)}
              </>
            }
          />
        );
      }
      case 'retire': {
        const e = open;
        if (!e) return null;
        return (
          <Dialog open onClose={() => setDialog(undefined)} danger eyebrow={e.floorName} heading={`Retire ${e.label}?`} actionLabel="Retire" busyLabel="Retiring…" onSubmit={submitRetire}>
            <p>It stops showing in lists and its identity keys are free again. It keeps its id, so whatever points at it still says what it was.</p>
          </Dialog>
        );
      }
      default:
        return null;
    }
  };

  let main: ReactNode;
  switch (place.page) {
    case 'entity':
      main = entityPage();
      break;
    case 'explore': {
      const id = place.id;
      main = (
        <>
          <Button kind="ghost" size="sm" onPress={() => move({ page: 'entity', id })}>
            Back to its page
          </Button>
          <Explorer api={api} ontology={ontology} centre={id} floorName={floorName} onOpenEntity={(to) => move({ page: 'entity', id: to })} onExplore={(to) => move({ page: 'explore', id: to })} />
        </>
      );
      break;
    }
    case 'triage':
    case 'proposal':
      main = <Triage api={api} ontology={ontology} place={place} userId={userId} onMove={move} onOpenDocument={openDocument} />;
      break;
    case 'ontology':
      main = <OntologyView api={api} ontology={ontology} onChange={keep} />;
      break;
    default:
      main = listPage();
  }
  const listed = place.page === 'entities' || place.page === 'new' || place.page === 'entity' || place.page === 'explore';
  const rail = (
    <>
      <RailLink icon="atlas" label="Everything here" count={total || undefined} current={listed} onPress={() => move({ page: 'entities' })} />
      <RailLink icon="inbox" label="Triage" current={place.page === 'triage' || place.page === 'proposal'} onPress={() => move({ page: 'triage' })} />
      <RailLink icon="tag" label="Ontology" current={place.page === 'ontology'} onPress={() => move({ page: 'ontology' })} />
    </>
  );
  return (
    <div className="atlas-app">
      {/* The explorer takes the width it's given: a graph needs room. */}
      <AppFrame app={{ name: 'Data Atlas', icon: 'atlas' }} onFront={() => move({ page: 'entities' })} rail={rail} railLabel="Data Atlas" measure={place.page === 'explore' ? 'full' : 'wide'} busy={loading} screen={placeKey}>
        {main}
      </AppFrame>
      {dialogs()}
    </div>
  );
}
