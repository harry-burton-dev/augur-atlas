import { LitElement, html, nothing } from 'lit';
import { ago, type DialogSubmit, type SelectOption } from '@augur/ui-kit';
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

/**
 * The ontology, for everyone to read: the kinds of thing Data Atlas keeps,
 * their details, the kinds of link between them, the packs they come from and
 * every version. Admins change it here (the studio): they adopt pack terms,
 * decide the words sources ask for, and add their own. Anyone else sees the
 * same page with a note saying who can change it.
 *
 * @fires atlas-ontology - detail is the Ontology after a change
 */
export class AtlasOntology extends LitElement {
  static override properties = {
    api: { attribute: false },
    ontology: { attribute: false },
    tab: { state: true },
    rights: { state: true },
    packs: { state: true },
    pack: { state: true },
    filter: { state: true },
    versions: { state: true },
    asked: { state: true },
    waiting: { state: true },
    failure: { state: true },
    form: { state: true },
    editing: { state: true },
    loading: { state: true },
    turtle: { state: true },
    notice: { state: true },
  };

  declare api: AtlasApi;
  declare ontology: Ontology | undefined;
  declare tab: Tab;
  declare rights: Governs;
  declare packs: PackSummary[];
  declare pack: Pack | undefined;
  declare filter: string;
  declare versions: OntologyVersion[];
  declare asked: TermCandidate[];
  declare waiting: number;
  declare failure: string;
  declare form: TermForm | undefined;
  /** The kind or link being renamed. */
  declare editing: { what: 'type' | 'relation'; key: string } | undefined;
  /** The pack upload form, open, with its file once chosen. */
  declare loading: boolean;
  declare turtle: { name: string; text: string } | undefined | null;
  /** What just happened, said once. */
  declare notice: string;

  constructor() {
    super();
    this.tab = 'kinds';
    this.rights = { govern: false };
    this.packs = [];
    this.filter = '';
    this.versions = [];
    this.asked = [];
    this.waiting = 0;
    this.failure = '';
    this.loading = true;
    this.turtle = null;
    this.notice = '';
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('api') && this.api) void this.load();
  }

  async load() {
    this.loading = true;
    this.failure = '';
    try {
      const [packs, versions, asked] = await Promise.all([this.api.packs(), this.api.versions(), this.api.candidates()]);
      this.rights = { govern: packs.govern, ...(packs.why ? { why: packs.why } : {}) };
      this.packs = packs.packs;
      this.versions = versions.versions;
      this.asked = asked.candidates;
      this.waiting = asked.waiting;
      if (this.pack) this.pack = await this.api.pack(this.pack.id);
    } catch (err) {
      this.failure = (err as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /** Takes the ontology a change answered with, tells the app, and reads the rest again. */
  private async changed(ontology: Ontology, notice: string) {
    this.ontology = ontology;
    this.notice = notice;
    this.dispatchEvent(new CustomEvent('atlas-ontology', { detail: ontology, bubbles: true }));
    await this.load();
  }

  private label(key: string) {
    return this.ontology?.types.find((t) => t.key === key)?.label ?? key;
  }

  private kindOptions(top?: string): SelectOption[] {
    if (!this.ontology) return [];
    const tree = typeTree(this.ontology).map(({ type, depth }) => ({ value: type.key, label: `${' '.repeat(depth)}${type.label}` }));
    return top ? [{ value: '', label: top }, ...tree] : tree;
  }

  private packTermKind(iri: string | undefined) {
    return iri ? this.ontology?.types.find((t) => t.packIri === iri)?.key : undefined;
  }

  /** Opens the form to adopt a pack's term, filled in from what the pack says. */
  private adoptTerm(pack: Pack, term: PackTerm) {
    const label = term.label.replace(/^\w/, (x) => x.toUpperCase());
    const parent = this.packTermKind(term.parent) ?? '';
    this.form = {
      heading: `Adopt ${label}`,
      summary: `${pack.name} has it as ${whatWord(term.kind)}.${term.note ? ` ${term.note}` : ''} It keeps the pack’s term, so it exports as that.`,
      what: term.kind === 'class' ? 'type' : term.kind,
      via: { pack, term },
      label,
      plural: pluralOf(label),
      inverse: '',
      parent,
      icon: this.ontology?.types.find((t) => t.key === parent)?.icon ?? 'tag',
      type: (term.domain ?? []).map((i) => this.packTermKind(i)).find(Boolean) ?? '',
      holds: 'text',
      from: (term.domain ?? []).map((i) => this.packTermKind(i)).find(Boolean) ?? '',
      to: (term.range ?? []).map((i) => this.packTermKind(i)).find(Boolean) ?? '',
    };
  }

  /** Opens the form to adopt a word sources asked for, filled in from where it would start. */
  private adoptCandidate(c: TermCandidate) {
    const s = c.start;
    const label = s.op === 'add-type' ? s.type.label : s.op === 'add-detail' ? s.detail.label : s.op === 'add-relation' ? s.relation.label : c.name;
    this.form = {
      heading: `Adopt ${label}`,
      summary: `Asked for ${c.asked === 1 ? 'once' : `${c.asked} times`}, as ${whatWord(c.kind)}. Every proposal that asked for it hears it was adopted.`,
      what: c.kind,
      via: { candidate: c },
      label,
      plural: s.op === 'add-type' ? s.type.plural : pluralOf(label),
      inverse: '',
      parent: s.op === 'add-type' ? (s.type.parent ?? '') : '',
      icon: s.op === 'add-type' ? s.type.icon : 'tag',
      type: s.op === 'add-detail' ? s.type : '',
      holds: 'text',
      from: s.op === 'add-relation' ? (s.relation.from[0] ?? '') : '',
      to: '',
    };
  }

  /** Opens the form to add something no pack or source offered. */
  private addOwn(what: TermForm['what'], on = '') {
    this.form = {
      heading: what === 'type' ? 'Add a kind of thing' : what === 'detail' ? `Add a detail${on ? ` of ${this.label(on)}` : ''}` : 'Add a kind of link',
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
    };
  }

  /** The change the form makes, from scratch or over where a candidate started. */
  private changeFrom(f: TermForm, values: Record<string, string>): OntologyChange {
    const label = values.label.trim();
    const key = keyFrom(label);
    const packed = 'candidate' in f.via ? { pack: 'augur', packTerm: f.via.candidate.name } : { pack: 'augur', packTerm: label };
    if (f.what === 'type') {
      return { op: 'add-type', type: { key, label, plural: values.plural?.trim() || pluralOf(label), abstract: false, icon: f.icon, ...packed, ...(f.parent ? { parent: f.parent } : {}) } };
    }
    if (f.what === 'detail') return { op: 'add-detail', type: f.type, detail: { key, label, kind: f.holds, identity: false } };
    return { op: 'add-relation', relation: { key, label, inverse: values.inverse.trim(), from: f.from ? [f.from] : [], to: f.to ? [f.to] : [], ...packed } };
  }

  private submitForm: DialogSubmit = async (values) => {
    const f = this.form;
    if (!f) return false;
    if (f.what === 'detail' && !f.type) throw new Error('Say which kind it’s a detail of.');
    if (f.what === 'relation' && (!f.from || !f.to)) throw new Error('Say which kinds it runs from and to.');
    let done: { ontology: Ontology };
    if ('pack' in f.via) {
      const { pack, term } = f.via;
      done = await this.api.adopt({
        pack: pack.id,
        iri: term.iri,
        label: values.label.trim(),
        ...(f.what === 'type' ? { plural: values.plural.trim(), parent: f.parent, icon: f.icon } : {}),
        ...(f.what === 'detail' ? { type: f.type, kind: f.holds } : {}),
        ...(f.what === 'relation' ? { from: [f.from], to: [f.to], inverse: values.inverse.trim() } : {}),
      });
    } else if ('candidate' in f.via) {
      const decided = await this.api.decideCandidate(f.via.candidate, { as: 'adopt', change: this.changeFrom(f, values) });
      if (!('ontology' in decided)) return false;
      done = decided;
    } else {
      done = await this.api.changeOntology([this.changeFrom(f, values)]);
    }
    this.form = undefined;
    await this.changed(done.ontology, `${values.label.trim()} is in the ontology now.`);
  };

  private submitRename: DialogSubmit = async (values) => {
    const e = this.editing;
    if (!e) return false;
    const change: OntologyChange =
      e.what === 'type'
        ? { op: 'edit-type', key: e.key, label: values.label.trim(), plural: values.plural.trim() }
        : { op: 'edit-relation', key: e.key, label: values.label.trim(), inverse: values.inverse.trim() };
    const done = await this.api.changeOntology([change]);
    this.editing = undefined;
    await this.changed(done.ontology, 'Renamed. What’s kept under it is the same.');
  };

  private submitPack: DialogSubmit = async (values) => {
    if (!this.turtle) throw new Error('Choose a Turtle file (.ttl) to load.');
    const loaded = await this.api.loadPack({ id: keyFrom(values.id || values.name), name: values.name.trim(), version: values.version.trim(), licence: values.licence.trim(), source: values.source.trim(), turtle: this.turtle.text });
    this.turtle = null;
    this.notice = `${loaded.name} is loaded: ${loaded.terms} terms to adopt from.`;
    this.pack = undefined;
    await this.load();
    this.pack = await this.api.pack(loaded.id);
  };

  private async dismiss(c: TermCandidate) {
    try {
      await this.api.decideCandidate(c, { as: 'dismiss' });
      this.notice = `${c.name} is dismissed. Sources that asked for it hear so.`;
      await this.load();
    } catch (err) {
      this.notice = (err as Error).message;
    }
  }

  private async exportOwl() {
    try {
      const text = await this.api.owl();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/turtle' }));
      a.download = `data-atlas-ontology-v${this.ontology?.version ?? ''}.ttl`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      this.notice = (err as Error).message;
    }
  }

  private kindsTab() {
    const o = this.ontology;
    if (!o) return nothing;
    const govern = this.rights.govern;
    return html`<ul class="atlas-rows">
      ${typeTree(o).map(
        ({ type: t, depth }) => html`<li class="atlas-row" style=${`--depth: ${depth}`}>
          <ui-icon name=${t.icon}></ui-icon>
          <div class="atlas-what">
            <span class="atlas-name">${t.label}</span>${t.abstract ? html` <span class="atlas-note">a heading only</span>` : nothing}
            <span class="atlas-note">${[t.plural, `${t.pack.toUpperCase()} · ${t.packTerm}`].join(' · ')}</span>
            ${t.details.length
              ? html`<span class="atlas-note">Details: ${t.details.map((d) => `${d.label}${d.identity ? ' (says which one)' : d.onEntity === false ? ' (through facts)' : ''}`).join(', ')}</span>`
              : nothing}
          </div>
          ${govern
            ? html`<div class="atlas-actions">
                <ui-button kind="ghost" size="sm" @click=${() => this.addOwn('detail', t.key)}>Add a detail</ui-button>
                <ui-button kind="ghost" size="sm" @click=${() => (this.editing = { what: 'type', key: t.key })}>Rename</ui-button>
              </div>`
            : nothing}
        </li>`,
      )}
    </ul>`;
  }

  private linksTab() {
    const o = this.ontology;
    if (!o) return nothing;
    return html`<ul class="atlas-rows">
      ${o.relations.map(
        (r) => html`<li class="atlas-row">
          <ui-icon name="arrow"></ui-icon>
          <div class="atlas-what">
            <span class="atlas-name">${r.label}</span>
            <span class="atlas-note">Read backwards: ${r.inverse} · ${r.pack.toUpperCase()} · ${r.packTerm}</span>
            <span class="atlas-note">From ${r.from.map((k) => this.label(k)).join(', ')} to ${r.to.map((k) => this.label(k)).join(', ')}</span>
          </div>
          ${this.rights.govern ? html`<ui-button kind="ghost" size="sm" @click=${() => (this.editing = { what: 'relation', key: r.key })}>Rename</ui-button>` : nothing}
        </li>`,
      )}
    </ul>`;
  }

  private askedTab() {
    if (!this.rights.govern) {
      return html`<p class="atlas-note">${this.waiting
        ? `${this.waiting === 1 ? 'One word' : `${this.waiting} words`} that sources asked for ${this.waiting === 1 ? 'waits' : 'wait'} for an admin. They came from every floor, so only admins see what they are.`
        : 'Nothing is waiting: no source has asked for a word the ontology hasn’t got.'}</p>`;
    }
    if (!this.asked.length) return html`<ui-state kind="empty" heading="Nothing asked for" body="When a source wants a kind, detail or link the ontology hasn’t got, it waits here for an admin."></ui-state>`;
    return html`<ul class="atlas-rows">
      ${this.asked.map(
        (c) => html`<li class="atlas-row">
          <ui-icon name="inbox"></ui-icon>
          <div class="atlas-what">
            <span class="atlas-name">${c.name}</span>
            <span class="atlas-note">${[whatWord(c.kind).replace(/^\w/, (x) => x.toUpperCase()), c.parents.length ? `under ${c.parents.map((p) => this.label(p)).join(', ')}` : '', `asked for ${c.asked === 1 ? 'once' : `${c.asked} times`}, last ${ago(c.lastAt)}`].filter(Boolean).join(' · ')}</span>
            ${c.note ? html`<span class="atlas-note">${c.note}</span>` : nothing}
          </div>
          <div class="atlas-actions">
            <ui-button kind="secondary" size="sm" @click=${() => this.adoptCandidate(c)}>Adopt…</ui-button>
            <ui-button kind="ghost" size="sm" @click=${() => void this.dismiss(c)}>Dismiss</ui-button>
          </div>
        </li>`,
      )}
    </ul>`;
  }

  private packsTab() {
    const govern = this.rights.govern;
    const p = this.pack;
    if (p) {
      const q = this.filter.trim().toLowerCase();
      const terms = p.terms.filter((t) => !q || t.label.toLowerCase().includes(q) || (t.note ?? '').toLowerCase().includes(q));
      const shown = terms.slice(0, 200);
      return html`<div class="atlas-head">
          <ui-button kind="ghost" size="sm" @click=${() => (this.pack = undefined)}>All packs</ui-button>
          <p class="atlas-note">${p.name}, version ${p.version} · ${p.licence} · ${p.terms.filter((t) => t.adopted).length} of ${p.terms.length} adopted</p>
        </div>
        <ui-text-field label="Find a term" .value=${this.filter} @ui-input=${(e: CustomEvent<{ value: string }>) => (this.filter = e.detail.value)}></ui-text-field>
        <ul class="atlas-rows">
          ${shown.map(
            (t) => html`<li class="atlas-row">
              <ui-icon name=${t.kind === 'class' ? 'tag' : t.kind === 'relation' ? 'arrow' : 'key'}></ui-icon>
              <div class="atlas-what">
                <span class="atlas-name">${t.label}</span>
                <span class="atlas-note">${[whatWord(t.kind).replace(/^\w/, (x) => x.toUpperCase()), t.parent ? `a kind of ${p.terms.find((x) => x.iri === t.parent)?.label ?? t.parent.split(/[#/]/).pop()}` : ''].filter(Boolean).join(' · ')}</span>
                ${t.note ? html`<span class="atlas-note">${t.note}</span>` : nothing}
              </div>
              ${t.adopted
                ? html`<ui-tag quiet icon="check" label=${`Kept as ${t.kind === 'class' ? this.label(t.adopted) : t.adopted}`}></ui-tag>`
                : html`<ui-button kind="secondary" size="sm" ?disabled=${!govern} reason=${this.rights.why ?? 'Only admins change the ontology.'} @click=${() => this.adoptTerm(p, t)}>Adopt…</ui-button>`}
            </li>`,
          )}
        </ul>
        ${terms.length > shown.length ? html`<p class="atlas-note">Showing 200 of ${terms.length}. Narrow it with Find a term.</p>` : nothing}`;
    }
    return html`<ul class="atlas-rows">
        ${this.packs.map(
          (k) => html`<li class="atlas-row">
            <ui-icon name="library"></ui-icon>
            <div class="atlas-what">
              <span class="atlas-name">${k.name}</span>
              <span class="atlas-note">Version ${k.version} · ${k.licence} · ${k.terms} terms · ${k.builtIn ? 'comes with Data Atlas' : `loaded ${ago(k.loadedAt)}`}</span>
              <span class="atlas-note">${k.source}</span>
            </div>
            <ui-button kind="secondary" size="sm" @click=${async () => {
              this.filter = '';
              this.pack = await this.api.pack(k.id);
            }}>Open</ui-button>
          </li>`,
        )}
      </ul>
      <div class="atlas-head">
        <p class="atlas-note">Load your org’s own vocabulary, such as MIP MIM or the full CCO, as OWL in Turtle. Its classes and properties can then be adopted here.</p>
        <ui-button kind="secondary" size="sm" ?disabled=${!govern} reason=${this.rights.why ?? 'Only admins change the ontology.'} @click=${() => (this.turtle = undefined)}>Load a pack…</ui-button>
      </div>`;
  }

  private historyTab() {
    return html`<ul class="atlas-rows">
      ${this.versions.map(
        (v) => html`<li class="atlas-row">
          <span class="atlas-version">${v.version}</span>
          <div class="atlas-what">
            <span class="atlas-name">${v.note}</span>
            <span class="atlas-note">${v.changedBy ? `By ${v.changedBy}, ${ago(v.madeAt)}` : `Came with Data Atlas, ${ago(v.madeAt)}`}${v.changes.length ? ` · ${v.changes.length} ${v.changes.length === 1 ? 'change' : 'changes'}` : ''}</span>
          </div>
        </li>`,
      )}
    </ul>`;
  }

  private dialogs() {
    const f = this.form;
    if (f) {
      return html`<ui-dialog open eyebrow="Ontology" heading=${f.heading} summary=${f.summary} action-label="Adopt it" busy-label="Adopting…" .submit=${this.submitForm} @ui-close=${() => (this.form = undefined)}>
        <ui-text-field slot="fields" name="label" label="Name" required maxlength="80" .value=${f.label} hint=${f.what === 'relation' ? 'Read forwards, as in “Operated by”' : ''}></ui-text-field>
        ${f.what === 'type'
          ? html`<ui-text-field slot="fields" name="plural" label="Plural" required maxlength="80" .value=${f.plural}></ui-text-field>
              <ui-select slot="fields" label="A kind of" .options=${this.kindOptions('Nothing: a kind on its own')} .value=${f.parent}
                @ui-change=${(e: CustomEvent<{ value: string }>) => (this.form = { ...f, parent: e.detail.value })}></ui-select>
              <ui-select slot="fields" label="Icon" .options=${ICONS.map((i) => ({ value: i, label: i }))} .value=${f.icon}
                @ui-change=${(e: CustomEvent<{ value: string }>) => (this.form = { ...f, icon: e.detail.value })}></ui-select>`
          : nothing}
        ${f.what === 'detail'
          ? html`<ui-select slot="fields" label="A detail of" .options=${this.kindOptions('Choose a kind')} .value=${f.type}
                @ui-change=${(e: CustomEvent<{ value: string }>) => (this.form = { ...f, type: e.detail.value })}></ui-select>
              <ui-select slot="fields" label="Holds" .options=${HOLDS} .value=${f.holds}
                @ui-change=${(e: CustomEvent<{ value: string }>) => (this.form = { ...f, holds: e.detail.value as DetailDef['kind'] })}></ui-select>`
          : nothing}
        ${f.what === 'relation'
          ? html`<ui-text-field slot="fields" name="inverse" label="Read backwards" required maxlength="80" .value=${f.inverse} hint="As in “Operates”"></ui-text-field>
              <ui-select slot="fields" label="From" .options=${this.kindOptions('Choose a kind')} .value=${f.from}
                @ui-change=${(e: CustomEvent<{ value: string }>) => (this.form = { ...f, from: e.detail.value })}></ui-select>
              <ui-select slot="fields" label="To" .options=${this.kindOptions('Choose a kind')} .value=${f.to}
                @ui-change=${(e: CustomEvent<{ value: string }>) => (this.form = { ...f, to: e.detail.value })}></ui-select>`
          : nothing}
      </ui-dialog>`;
    }
    const e = this.editing;
    if (e) {
      const t = e.what === 'type' ? this.ontology?.types.find((x) => x.key === e.key) : undefined;
      const r = e.what === 'relation' ? this.ontology?.relations.find((x) => x.key === e.key) : undefined;
      return html`<ui-dialog open eyebrow="Ontology" heading=${`Rename ${t?.label ?? r?.label ?? e.key}`} summary="Only the words change: its key, and everything kept under it, stay as they are."
        action-label="Rename" busy-label="Renaming…" .submit=${this.submitRename} @ui-close=${() => (this.editing = undefined)}>
        <ui-text-field slot="fields" name="label" label="Name" required maxlength="80" .value=${t?.label ?? r?.label ?? ''}></ui-text-field>
        ${t ? html`<ui-text-field slot="fields" name="plural" label="Plural" required maxlength="80" .value=${t.plural}></ui-text-field>` : nothing}
        ${r ? html`<ui-text-field slot="fields" name="inverse" label="Read backwards" required maxlength="80" .value=${r.inverse}></ui-text-field>` : nothing}
      </ui-dialog>`;
    }
    if (this.turtle !== null) {
      return html`<ui-dialog open eyebrow="Ontology" heading="Load a pack" summary="OWL in Turtle: its classes become kinds to adopt, its properties details and links. Nothing is adopted until you choose."
        action-label="Load it" busy-label="Loading…" .submit=${this.submitPack} @ui-close=${() => (this.turtle = null)}>
        <ui-drop-zone slot="fields" compact accept=".ttl,text/turtle" heading=${this.turtle ? this.turtle.name : 'Drop a .ttl file'} action="Choose a file"
          @ui-files=${async (ev: CustomEvent<{ files: File[] }>) => {
            const file = ev.detail.files[0];
            if (file) this.turtle = { name: file.name, text: await file.text() };
          }}></ui-drop-zone>
        <ui-text-field slot="fields" name="name" label="Name" required maxlength="120" hint="As in MIP Information Model"></ui-text-field>
        <ui-text-field slot="fields" name="id" label="Short id" optional maxlength="48" hint="As in mip-mim. Loading again under it replaces it"></ui-text-field>
        <ui-text-field slot="fields" name="version" label="Version" required maxlength="40"></ui-text-field>
        <ui-text-field slot="fields" name="licence" label="Licence" required maxlength="120" hint="What it may be used under, so others can check"></ui-text-field>
        <ui-text-field slot="fields" name="source" label="Where it came from" optional maxlength="500"></ui-text-field>
      </ui-dialog>`;
    }
    return nothing;
  }

  override render() {
    const o = this.ontology;
    const tabs: [Tab, string][] = [
      ['kinds', 'Kinds'],
      ['links', 'Kinds of link'],
      ['asked', this.waiting ? `Asked for (${this.waiting})` : 'Asked for'],
      ['packs', 'Packs'],
      ['history', 'History'],
    ];
    const govern = this.rights.govern;
    const body = this.failure
      ? html`<ui-state kind="error" heading="Couldn’t open the ontology" body=${this.failure} action="Try again" @ui-action=${() => void this.load()}></ui-state>`
      : !o || this.loading
        ? html`<ui-state kind="loading" heading="Opening…"></ui-state>`
        : { kinds: () => this.kindsTab(), links: () => this.linksTab(), asked: () => this.askedTab(), packs: () => this.packsTab(), history: () => this.historyTab() }[this.tab]();
    return html`<style>
        atlas-ontology { display: flex; flex-direction: column; gap: var(--space-5); }
        atlas-ontology .atlas-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
        atlas-ontology .atlas-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        atlas-ontology .atlas-note { margin: 0; font-size: var(--type-small); color: var(--ink-muted); }
        atlas-ontology .atlas-tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); border-bottom: 1px solid var(--hairline); padding-bottom: var(--space-2); }
        atlas-ontology .atlas-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
        atlas-ontology .atlas-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-3); align-items: start; padding: var(--space-3) 0; padding-left: calc(var(--depth, 0) * var(--space-5)); border-bottom: 1px solid var(--hairline); }
        atlas-ontology .atlas-what { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
        atlas-ontology .atlas-name { color: var(--ink); }
        atlas-ontology .atlas-version { font-variant-numeric: tabular-nums; color: var(--ink-muted); min-width: 2ch; text-align: right; }
        @media (max-width: 640px) { atlas-ontology .atlas-row { grid-template-columns: auto minmax(0, 1fr); } atlas-ontology .atlas-row > :last-child:not(.atlas-what) { grid-column: 2; } }
      </style>
      <div class="atlas-head">
        <ui-page-head eyebrow=${o ? `Data Atlas · Version ${o.version}` : 'Data Atlas'} heading="The ontology"
          summary="The kinds of thing Data Atlas keeps, what’s known of them and how they link."></ui-page-head>
        <div class="atlas-actions">
          <ui-button kind="ghost" size="sm" ?disabled=${!o} reason="The ontology is still loading." @click=${() => void this.exportOwl()}>Export as OWL</ui-button>
          <ui-button kind="secondary" size="sm" ?disabled=${!govern} reason=${this.rights.why ?? 'Only admins change the ontology.'} @click=${() => this.addOwn('type')}>Add a kind</ui-button>
          <ui-button kind="secondary" size="sm" ?disabled=${!govern} reason=${this.rights.why ?? 'Only admins change the ontology.'} @click=${() => this.addOwn('relation')}>Add a kind of link</ui-button>
        </div>
      </div>
      ${this.rights.why ? html`<p class="atlas-note">${this.rights.why}</p>` : nothing}
      ${this.notice ? html`<p class="atlas-note" role="status">${this.notice}</p>` : nothing}
      <nav class="atlas-tabs" aria-label="Parts of the ontology">
        ${tabs.map(
          ([id, word]) => html`<ui-button kind=${this.tab === id ? 'secondary' : 'ghost'} size="sm" aria-pressed=${this.tab === id ? 'true' : 'false'}
            @click=${() => {
              this.tab = id;
              this.notice = '';
            }}>${word}</ui-button>`,
        )}
      </nav>
      ${body} ${this.dialogs()}`;
  }
}

if (!customElements.get('atlas-ontology')) customElements.define('atlas-ontology', AtlasOntology);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-ontology': AtlasOntology;
  }
}
