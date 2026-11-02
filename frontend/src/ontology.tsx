import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, DropZone, Icon, PageHead, Select, State, Tag, TextField, relativeTime, type DialogSubmit, type IconName, type SelectOption } from '@augur/app-kit';
import {
  keyFrom,
  pluralOf,
  typeTree,
  type AtlasApi,
  type DetailDef,
  type Governs,
  type Ontology,
  type OntologyChange,
  type OntologyVersion,
  type Pack,
  type PackSummary,
  type PackTerm,
  type TermCandidate,
} from './api.js';

type Tab = 'kinds' | 'links' | 'asked' | 'packs' | 'history';

/** Icons a kind can wear: the kit's, for things an org keeps track of. */
const ICONS = ['atlas', 'people', 'person', 'account', 'org', 'department', 'apps', 'vessel', 'aircraft', 'vehicle', 'place', 'port', 'facility', 'event', 'document', 'key', 'server', 'network', 'compass', 'tag', 'star'];
const HOLDS: SelectOption[] = [
  { value: 'text', label: 'Words' },
  { value: 'number', label: 'A number' },
  { value: 'date', label: 'A date' },
];

/** What a term or change is, in a word. */
const whatWord = (kind: 'class' | 'type' | 'detail' | 'relation') => (kind === 'relation' ? 'a kind of link' : kind === 'detail' ? 'a detail' : 'a kind of thing');
const capital = (words: string) => words.replace(/^\w/, (x) => x.toUpperCase());

/** The open form for adding to the ontology: from a pack, from what sources asked for, or from scratch. */
interface TermForm {
  heading: string;
  summary: string;
  what: 'type' | 'detail' | 'relation';
  via: { pack: Pack; term: PackTerm } | { candidate: TermCandidate } | { own: true };
  label: string;
  plural: string;
  inverse: string;
  parent: string;
  icon: string;
  type: string;
  holds: DetailDef['kind'];
  from: string;
  to: string;
}

export interface OntologyViewProps {
  api: AtlasApi;
  ontology: Ontology | undefined;
  /** The ontology after a change, for the app to keep. */
  onChange: (ontology: Ontology) => void;
}

/**
 * The ontology, for everyone to read: the kinds of thing Data Atlas keeps,
 * their details, the kinds of link between them, the packs they come from and
 * every version. Admins change it here (the studio): they adopt pack terms,
 * decide the words sources ask for, and add their own. Anyone else sees the
 * same page with a note saying who can change it.
 */
export function OntologyView({ api, ontology: o, onChange }: OntologyViewProps) {
  const [tab, setTab] = useState<Tab>('kinds');
  const [rights, setRights] = useState<Governs>({ govern: false });
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [pack, setPack] = useState<Pack>();
  const [filter, setFilter] = useState('');
  const [versions, setVersions] = useState<OntologyVersion[]>([]);
  const [asked, setAsked] = useState<TermCandidate[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [failure, setFailure] = useState('');
  const [form, setForm] = useState<TermForm>();
  /** The kind or link being renamed. */
  const [editing, setEditing] = useState<{ what: 'type' | 'relation'; key: string }>();
  const [loading, setLoading] = useState(true);
  /** The pack upload form: null while shut, undefined while open with no file yet. */
  const [turtle, setTurtle] = useState<{ name: string; text: string } | undefined | null>(null);
  /** What just happened, said once. */
  const [notice, setNotice] = useState('');

  const load = useCallback(
    async (reopen?: string) => {
      setLoading(true);
      setFailure('');
      try {
        const [p, v, a] = await Promise.all([api.packs(), api.versions(), api.candidates()]);
        setRights({ govern: p.govern, ...(p.why ? { why: p.why } : {}) });
        setPacks(p.packs);
        setVersions(v.versions);
        setAsked(a.candidates);
        setWaiting(a.waiting);
        if (reopen) setPack(await api.pack(reopen));
      } catch (err) {
        setFailure((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => void load(), [load]);

  /** Takes the ontology a change answered with, tells the app, and reads the rest again. */
  const changed = async (next: Ontology, words: string) => {
    setNotice(words);
    onChange(next);
    await load(pack?.id);
  };

  const label = (key: string) => o?.types.find((t) => t.key === key)?.label ?? key;
  const kindOptions = (top?: string): SelectOption[] => {
    if (!o) return [];
    const tree = typeTree(o).map(({ type, depth }) => ({ value: type.key, label: `${' '.repeat(depth)}${type.label}` }));
    return top ? [{ value: '', label: top }, ...tree] : tree;
  };
  const packTermKind = (iri: string | undefined) => (iri ? o?.types.find((t) => t.packIri === iri)?.key : undefined);

  /** Opens the form to adopt a pack's term, filled in from what the pack says. */
  const adoptTerm = (p: Pack, term: PackTerm) => {
    const name = capital(term.label);
    const parent = packTermKind(term.parent) ?? '';
    setForm({
      heading: `Adopt ${name}`,
      summary: `${p.name} has it as ${whatWord(term.kind)}.${term.note ? ` ${term.note}` : ''} It keeps the pack’s term, so it exports as that.`,
      what: term.kind === 'class' ? 'type' : term.kind,
      via: { pack: p, term },
      label: name,
      plural: pluralOf(name),
      inverse: '',
      parent,
      icon: o?.types.find((t) => t.key === parent)?.icon ?? 'tag',
      type: (term.domain ?? []).map((i) => packTermKind(i)).find(Boolean) ?? '',
      holds: 'text',
      from: (term.domain ?? []).map((i) => packTermKind(i)).find(Boolean) ?? '',
      to: (term.range ?? []).map((i) => packTermKind(i)).find(Boolean) ?? '',
    });
  };

  /** Opens the form to adopt a word sources asked for, filled in from where it would start. */
  const adoptCandidate = (c: TermCandidate) => {
    const s = c.start;
    const name = s.op === 'add-type' ? s.type.label : s.op === 'add-detail' ? s.detail.label : s.op === 'add-relation' ? s.relation.label : c.name;
    setForm({
      heading: `Adopt ${name}`,
      summary: `Asked for ${c.asked === 1 ? 'once' : `${c.asked} times`}, as ${whatWord(c.kind)}. Every proposal that asked for it hears it was adopted.`,
      what: c.kind,
      via: { candidate: c },
      label: name,
      plural: s.op === 'add-type' ? s.type.plural : pluralOf(name),
      inverse: '',
      parent: s.op === 'add-type' ? (s.type.parent ?? '') : '',
      icon: s.op === 'add-type' ? s.type.icon : 'tag',
      type: s.op === 'add-detail' ? s.type : '',
      holds: 'text',
      from: s.op === 'add-relation' ? (s.relation.from[0] ?? '') : '',
      to: '',
    });
  };

  /** Opens the form to add something no pack or source offered. */
  const addOwn = (what: TermForm['what'], on = '') =>
    setForm({
      heading: what === 'type' ? 'Add a kind of thing' : what === 'detail' ? `Add a detail${on ? ` of ${label(on)}` : ''}` : 'Add a kind of link',
      summary: 'It’s AUGUR’s own term: no pack names it. Kinds and links are only ever added or renamed, so nothing kept stops fitting.',
      what,
      via: { own: true },
      label: '',
      plural: '',
      inverse: '',
      parent: '',
      icon: 'tag',
      type: on,
      holds: 'text',
      from: '',
      to: '',
    });

  /** The change the form makes, from scratch or over where a candidate started. */
  const changeFrom = (f: TermForm, values: Record<string, string>): OntologyChange => {
    const name = values.label.trim();
    const key = keyFrom(name);
    const packed = 'candidate' in f.via ? { pack: 'augur', packTerm: f.via.candidate.name } : { pack: 'augur', packTerm: name };
    if (f.what === 'type') return { op: 'add-type', type: { key, label: name, plural: values.plural?.trim() || pluralOf(name), abstract: false, icon: f.icon, ...packed, ...(f.parent ? { parent: f.parent } : {}) } };
    if (f.what === 'detail') return { op: 'add-detail', type: f.type, detail: { key, label: name, kind: f.holds, identity: false } };
    return { op: 'add-relation', relation: { key, label: name, inverse: values.inverse.trim(), from: f.from ? [f.from] : [], to: f.to ? [f.to] : [], ...packed } };
  };

  const submitForm: DialogSubmit = async (values) => {
    const f = form;
    if (!f) return false as const;
    if (f.what === 'detail' && !f.type) throw new Error('Say which kind it’s a detail of.');
    if (f.what === 'relation' && (!f.from || !f.to)) throw new Error('Say which kinds it runs from and to.');
    let done: { ontology: Ontology };
    if ('pack' in f.via) {
      const { pack: p, term } = f.via;
      done = await api.adopt({
        pack: p.id,
        iri: term.iri,
        label: values.label.trim(),
        ...(f.what === 'type' ? { plural: values.plural.trim(), parent: f.parent, icon: f.icon } : {}),
        ...(f.what === 'detail' ? { type: f.type, kind: f.holds } : {}),
        ...(f.what === 'relation' ? { from: [f.from], to: [f.to], inverse: values.inverse.trim() } : {}),
      });
    } else if ('candidate' in f.via) {
      const decided = await api.decideCandidate(f.via.candidate, { as: 'adopt', change: changeFrom(f, values) });
      if (!('ontology' in decided)) return false as const;
      done = decided;
    } else {
      done = await api.changeOntology([changeFrom(f, values)]);
    }
    setForm(undefined);
    await changed(done.ontology, `${values.label.trim()} is in the ontology now.`);
  };

  const submitRename: DialogSubmit = async (values) => {
    const e = editing;
    if (!e) return false as const;
    const change: OntologyChange =
      e.what === 'type' ? { op: 'edit-type', key: e.key, label: values.label.trim(), plural: values.plural.trim() } : { op: 'edit-relation', key: e.key, label: values.label.trim(), inverse: values.inverse.trim() };
    const done = await api.changeOntology([change]);
    setEditing(undefined);
    await changed(done.ontology, 'Renamed. What’s kept under it is the same.');
  };

  const submitPack: DialogSubmit = async (values) => {
    if (!turtle) throw new Error('Choose a Turtle file (.ttl) to load.');
    const loaded = await api.loadPack({ id: keyFrom(values.id || values.name), name: values.name.trim(), version: values.version.trim(), licence: values.licence.trim(), source: (values.source ?? '').trim(), turtle: turtle.text });
    setTurtle(null);
    setNotice(`${loaded.name} is loaded: ${loaded.terms} terms to adopt from.`);
    setPack(undefined);
    await load(loaded.id);
  };

  const dismiss = async (c: TermCandidate) => {
    try {
      await api.decideCandidate(c, { as: 'dismiss' });
      setNotice(`${c.name} is dismissed. Sources that asked for it hear so.`);
      await load(pack?.id);
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  const exportOwl = async () => {
    try {
      const text = await api.owl();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/turtle' }));
      a.download = `data-atlas-ontology-v${o?.version ?? ''}.ttl`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setNotice((err as Error).message);
    }
  };

  const govern = rights.govern;
  const onlyAdmins = rights.why ?? 'Only admins change the ontology.';

  const kindsTab = () =>
    o ? (
      <ul className="atlas-rows">
        {typeTree(o).map(({ type: t, depth }) => (
          <li key={t.key} className="atlas-row" style={{ paddingInlineStart: `calc(${depth} * var(--space-5))` }}>
            <Icon name={t.icon as IconName} size={16} />
            <div className="atlas-what">
              <span className="atlas-name">
                {t.label}
                {t.abstract ? <span className="atlas-note"> a heading only</span> : null}
              </span>
              <span className="atlas-note">{[t.plural, `${t.pack.toUpperCase()} · ${t.packTerm}`].join(' · ')}</span>
              {t.details.length ? <span className="atlas-note">Details: {t.details.map((d) => `${d.label}${d.identity ? ' (says which one)' : d.onEntity === false ? ' (through facts)' : ''}`).join(', ')}</span> : null}
            </div>
            {govern ? (
              <div className="atlas-actions">
                <Button kind="ghost" size="sm" onPress={() => addOwn('detail', t.key)}>
                  Add a detail
                </Button>
                <Button kind="ghost" size="sm" onPress={() => setEditing({ what: 'type', key: t.key })}>
                  Rename
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    ) : null;

  const linksTab = () =>
    o ? (
      <ul className="atlas-rows">
        {o.relations.map((r) => (
          <li key={r.key} className="atlas-row">
            <Icon name="arrow" size={16} />
            <div className="atlas-what">
              <span className="atlas-name">{r.label}</span>
              <span className="atlas-note">
                Read backwards: {r.inverse} · {r.pack.toUpperCase()} · {r.packTerm}
              </span>
              <span className="atlas-note">
                From {r.from.map(label).join(', ')} to {r.to.map(label).join(', ')}
              </span>
            </div>
            {govern ? (
              <Button kind="ghost" size="sm" onPress={() => setEditing({ what: 'relation', key: r.key })}>
                Rename
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    ) : null;

  const askedTab = () => {
    if (!govern)
      return (
        <p className="atlas-note">
          {waiting
            ? `${waiting === 1 ? 'One word' : `${waiting} words`} that sources asked for ${waiting === 1 ? 'waits' : 'wait'} for an admin. They came from every floor, so only admins see what they are.`
            : 'Nothing is waiting: no source has asked for a word the ontology hasn’t got.'}
        </p>
      );
    if (!asked.length) return <State heading="Nothing asked for" body="When a source wants a kind, detail or link the ontology hasn’t got, it waits here for an admin." />;
    return (
      <ul className="atlas-rows">
        {asked.map((c) => (
          <li key={`${c.kind}:${c.name}`} className="atlas-row">
            <Icon name="inbox" size={16} />
            <div className="atlas-what">
              <span className="atlas-name">{c.name}</span>
              <span className="atlas-note">
                {[capital(whatWord(c.kind)), c.parents.length ? `under ${c.parents.map(label).join(', ')}` : '', `asked for ${c.asked === 1 ? 'once' : `${c.asked} times`}, last ${relativeTime(c.lastAt)}`].filter(Boolean).join(' · ')}
              </span>
              {c.note ? <span className="atlas-note">{c.note}</span> : null}
            </div>
            <div className="atlas-actions">
              <Button kind="secondary" size="sm" onPress={() => adoptCandidate(c)}>
                Adopt…
              </Button>
              <Button kind="ghost" size="sm" onPress={() => void dismiss(c)}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const packsTab = () => {
    const p = pack;
    if (p) {
      const q = filter.trim().toLowerCase();
      const terms = p.terms.filter((t) => !q || t.label.toLowerCase().includes(q) || (t.note ?? '').toLowerCase().includes(q));
      const shown = terms.slice(0, 200);
      return (
        <>
          <div className="atlas-head">
            <Button kind="ghost" size="sm" onPress={() => setPack(undefined)}>
              All packs
            </Button>
            <p className="atlas-note">
              {p.name}, version {p.version} · {p.licence} · {p.terms.filter((t) => t.adopted).length} of {p.terms.length} adopted
            </p>
          </div>
          <TextField label="Find a term" value={filter} onChange={setFilter} />
          <ul className="atlas-rows">
            {shown.map((t) => (
              <li key={t.iri} className="atlas-row">
                <Icon name={t.kind === 'class' ? 'tag' : t.kind === 'relation' ? 'arrow' : 'key'} size={16} />
                <div className="atlas-what">
                  <span className="atlas-name">{t.label}</span>
                  <span className="atlas-note">
                    {[capital(whatWord(t.kind)), t.parent ? `a kind of ${p.terms.find((x) => x.iri === t.parent)?.label ?? t.parent.split(/[#/]/).pop()}` : ''].filter(Boolean).join(' · ')}
                  </span>
                  {t.note ? <span className="atlas-note">{t.note}</span> : null}
                </div>
                {t.adopted ? (
                  <Tag quiet icon="check" label={`Kept as ${t.kind === 'class' ? label(t.adopted) : t.adopted}`} />
                ) : (
                  <Button kind="secondary" size="sm" disabled={!govern} reason={onlyAdmins} onPress={() => adoptTerm(p, t)}>
                    Adopt…
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {terms.length > shown.length ? <p className="atlas-note">Showing 200 of {terms.length}. Narrow it with Find a term.</p> : null}
        </>
      );
    }
    return (
      <>
        <ul className="atlas-rows">
          {packs.map((k) => (
            <li key={k.id} className="atlas-row">
              <Icon name="library" size={16} />
              <div className="atlas-what">
                <span className="atlas-name">{k.name}</span>
                <span className="atlas-note">
                  Version {k.version} · {k.licence} · {k.terms} terms · {k.builtIn ? 'comes with Data Atlas' : `loaded ${relativeTime(k.loadedAt)}`}
                </span>
                <span className="atlas-note">{k.source}</span>
              </div>
              <Button
                kind="secondary"
                size="sm"
                onPress={async () => {
                  setFilter('');
                  setPack(await api.pack(k.id));
                }}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
        <div className="atlas-head">
          <p className="atlas-note">Load your org’s own vocabulary, such as MIP MIM or the full CCO, as OWL in Turtle. Its classes and properties can then be adopted here.</p>
          <Button kind="secondary" size="sm" disabled={!govern} reason={onlyAdmins} onPress={() => setTurtle(undefined)}>
            Load a pack…
          </Button>
        </div>
      </>
    );
  };

  const historyTab = () => (
    <ul className="atlas-rows">
      {versions.map((v) => (
        <li key={v.version} className="atlas-row">
          <span className="atlas-version">{v.version}</span>
          <div className="atlas-what">
            <span className="atlas-name">{v.note}</span>
            <span className="atlas-note">
              {v.changedBy ? `By ${v.changedBy}, ${relativeTime(v.madeAt)}` : `Came with Data Atlas, ${relativeTime(v.madeAt)}`}
              {v.changes.length ? ` · ${v.changes.length} ${v.changes.length === 1 ? 'change' : 'changes'}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );

  const dialogs = () => {
    const f = form;
    if (f)
      return (
        <Dialog
          open
          onClose={() => setForm(undefined)}
          eyebrow="Ontology"
          heading={f.heading}
          summary={f.summary}
          actionLabel="Adopt it"
          busyLabel="Adopting…"
          onSubmit={submitForm}
          fields={
            <>
              <TextField name="label" label="Name" required maxLength={80} defaultValue={f.label} hint={f.what === 'relation' ? 'Read forwards, as in “Operated by”' : undefined} />
              {f.what === 'type' ? (
                <>
                  <TextField name="plural" label="Plural" required maxLength={80} defaultValue={f.plural} />
                  <Select label="A kind of" options={kindOptions('Nothing: a kind on its own')} value={f.parent} onChange={(v) => setForm({ ...f, parent: v })} />
                  <Select label="Icon" options={ICONS.map((i) => ({ value: i, label: i }))} value={f.icon} onChange={(v) => setForm({ ...f, icon: v })} />
                </>
              ) : null}
              {f.what === 'detail' ? (
                <>
                  <Select label="A detail of" options={kindOptions('Choose a kind')} value={f.type} onChange={(v) => setForm({ ...f, type: v })} />
                  <Select label="Holds" options={HOLDS} value={f.holds} onChange={(v) => setForm({ ...f, holds: v as DetailDef['kind'] })} />
                </>
              ) : null}
              {f.what === 'relation' ? (
                <>
                  <TextField name="inverse" label="Read backwards" required maxLength={80} defaultValue={f.inverse} hint="As in “Operates”" />
                  <Select label="From" options={kindOptions('Choose a kind')} value={f.from} onChange={(v) => setForm({ ...f, from: v })} />
                  <Select label="To" options={kindOptions('Choose a kind')} value={f.to} onChange={(v) => setForm({ ...f, to: v })} />
                </>
              ) : null}
            </>
          }
        />
      );
    const e = editing;
    if (e) {
      const t = e.what === 'type' ? o?.types.find((x) => x.key === e.key) : undefined;
      const r = e.what === 'relation' ? o?.relations.find((x) => x.key === e.key) : undefined;
      return (
        <Dialog
          open
          onClose={() => setEditing(undefined)}
          eyebrow="Ontology"
          heading={`Rename ${t?.label ?? r?.label ?? e.key}`}
          summary="Only the words change: its key, and everything kept under it, stay as they are."
          actionLabel="Rename"
          busyLabel="Renaming…"
          onSubmit={submitRename}
          fields={
            <>
              <TextField name="label" label="Name" required maxLength={80} defaultValue={t?.label ?? r?.label ?? ''} />
              {t ? <TextField name="plural" label="Plural" required maxLength={80} defaultValue={t.plural} /> : null}
              {r ? <TextField name="inverse" label="Read backwards" required maxLength={80} defaultValue={r.inverse} /> : null}
            </>
          }
        />
      );
    }
    if (turtle !== null)
      return (
        <Dialog
          open
          onClose={() => setTurtle(null)}
          eyebrow="Ontology"
          heading="Load a pack"
          summary="OWL in Turtle: its classes become kinds to adopt, its properties details and links. Nothing is adopted until you choose."
          actionLabel="Load it"
          busyLabel="Loading…"
          onSubmit={submitPack}
          fields={
            <>
              <DropZone
                compact
                accept=".ttl,text/turtle"
                heading={turtle ? turtle.name : 'Drop a .ttl file'}
                action="Choose a file"
                onFiles={async (files) => {
                  const file = files[0];
                  if (file) setTurtle({ name: file.name, text: await file.text() });
                }}
              />
              <TextField name="name" label="Name" required maxLength={120} hint="As in MIP Information Model" />
              <TextField name="id" label="Short id" optional maxLength={48} hint="As in mip-mim. Loading again under it replaces it" />
              <TextField name="version" label="Version" required maxLength={40} />
              <TextField name="licence" label="Licence" required maxLength={120} hint="What it may be used under, so others can check" />
              <TextField name="source" label="Where it came from" optional maxLength={500} />
            </>
          }
        />
      );
    return null;
  };

  const tabs: [Tab, string][] = [
    ['kinds', 'Kinds'],
    ['links', 'Kinds of link'],
    ['asked', waiting ? `Asked for (${waiting})` : 'Asked for'],
    ['packs', 'Packs'],
    ['history', 'History'],
  ];
  const body = failure ? (
    <State kind="error" heading="Couldn’t open the ontology" body={failure} action="Try again" onAction={() => void load(pack?.id)} />
  ) : !o || loading ? (
    <State kind="loading" heading="Opening…" />
  ) : (
    { kinds: kindsTab, links: linksTab, asked: askedTab, packs: packsTab, history: historyTab }[tab]()
  );
  return (
    <div className="atlas-ontology">
      <PageHead eyebrow={o ? `Data Atlas · Version ${o.version}` : 'Data Atlas'} heading="The ontology" summary="The kinds of thing Data Atlas keeps, what’s known of them and how they link.">
        <div className="atlas-actions">
          <Button kind="ghost" size="sm" disabled={!o} reason="The ontology is still loading." onPress={() => void exportOwl()}>
            Export as OWL
          </Button>
          <Button kind="secondary" size="sm" disabled={!govern} reason={onlyAdmins} onPress={() => addOwn('type')}>
            Add a kind
          </Button>
          <Button kind="secondary" size="sm" disabled={!govern} reason={onlyAdmins} onPress={() => addOwn('relation')}>
            Add a kind of link
          </Button>
        </div>
      </PageHead>
      {rights.why ? <p className="atlas-note">{rights.why}</p> : null}
      {notice ? (
        <p className="atlas-note" role="status">
          {notice}
        </p>
      ) : null}
      <nav className="atlas-tabs" aria-label="Parts of the ontology">
        {tabs.map(([id, word]) => (
          <Button
            key={id}
            kind={tab === id ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={tab === id}
            onPress={() => {
              setTab(id);
              setNotice('');
            }}
          >
            {word}
          </Button>
        ))}
      </nav>
      {body}
      {dialogs()}
    </div>
  );
}
