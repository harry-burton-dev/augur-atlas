import { LitElement, html, nothing } from 'lit';
import type { EntityRef } from '@augur/mfe-sdk';
import type { ListItem, SelectOption } from '@augur/ui-kit';
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
    for (const t of ontology.types) if (t.parent && keep.has(t.parent) && !keep.has(t.key)) keep.add(t.key), (grew = true);
  }
  return tree.filter((t) => keep.has(t.type.key));
};

/**
 * Data Atlas answering `entity.pick` for another app: find what shows from this
 * floor by name, other name or identity key, narrowed to the kinds asked for.
 * One entity is picked with a press; with `multiple`, presses gather a list to
 * give back together. What isn't offered says why, rather than vanishing.
 *
 * @fires atlas-picked - detail `{ entities: EntityRef[] }`
 * @fires atlas-cancel - the person closed it without picking
 */
export class AtlasPicker extends LitElement {
  static override properties = {
    api: { attribute: false },
    purpose: { type: String },
    types: { attribute: false },
    multiple: { type: Boolean },
    floorName: { type: String, attribute: 'floor-name' },
    ontology: { state: true },
    kind: { state: true },
    query: { state: true },
    entities: { state: true },
    total: { state: true },
    picked: { state: true },
    loading: { state: true },
    failure: { state: true },
  };

  declare api: AtlasApi;
  /** What the asking app says it's for: "Bind to this intent". */
  declare purpose: string;
  /** Kinds the asking app takes; none for any. */
  declare types: string[];
  declare multiple: boolean;
  declare floorName: string;
  declare ontology: Ontology | undefined;
  declare kind: string;
  declare query: string;
  declare entities: Entity[];
  declare total: number;
  declare picked: Entity[];
  declare loading: boolean;
  declare failure: string;

  private timer?: ReturnType<typeof setTimeout>;
  private asked = 0;

  constructor() {
    super();
    this.purpose = '';
    this.types = [];
    this.multiple = false;
    this.floorName = '';
    this.kind = '';
    this.query = '';
    this.entities = [];
    this.total = 0;
    this.picked = [];
    this.loading = true;
    this.failure = '';
  }

  override createRenderRoot() {
    return this;
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.timer);
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('api') && this.api) void this.start();
  }

  private async start() {
    try {
      this.ontology = await this.api.ontology();
      await this.list();
    } catch (err) {
      this.failure = (err as Error).message;
      this.loading = false;
    }
  }

  /** The kinds to ask the service for: the one chosen, or else every kind asked for. */
  private kindsAsked() {
    if (this.kind) return [this.kind];
    return this.types.length && this.ontology ? kindsOffered(this.ontology, this.types).map((t) => t.type.key) : undefined;
  }

  private async list() {
    const asked = ++this.asked;
    this.loading = true;
    this.failure = '';
    try {
      const kinds = this.kindsAsked();
      const { entities, total } =
        kinds && !kinds.length ? { entities: [], total: 0 } : await this.api.entities({ q: this.query.trim(), type: kinds, limit: 50 });
      if (asked !== this.asked) return;
      this.entities = entities;
      this.total = total;
    } catch (err) {
      if (asked === this.asked) this.failure = (err as Error).message;
    } finally {
      if (asked === this.asked) this.loading = false;
    }
  }

  private search(q: string) {
    this.query = q;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.list(), 200);
  }

  private emit(name: string, detail: object = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  private choose(e: Entity) {
    if (!this.multiple) return this.emit('atlas-picked', { entities: [refOf(e)] });
    this.picked = this.picked.some((p) => p.id === e.id) ? this.picked.filter((p) => p.id !== e.id) : [...this.picked, e];
  }

  override render() {
    const offered = this.ontology ? kindsOffered(this.ontology, this.types) : [];
    const options: SelectOption[] = [
      { value: '', label: this.types.length ? 'Any of the kinds asked for' : 'Any kind' },
      ...offered.map(({ type, depth }) => ({ value: type.key, label: `${'  '.repeat(depth)}${type.abstract ? `All ${type.plural.toLowerCase()}` : type.plural}` })),
    ];
    const chosen = new Set(this.picked.map((p) => p.id));
    const rows: ListItem[] = this.entities.map((e) => ({
      id: e.id,
      title: e.label,
      detail: entityLine(this.ontology, e),
      icon: chosen.has(e.id) ? 'check' : (this.ontology?.types.find((t) => t.key === e.type)?.icon ?? 'atlas'),
    }));
    const where = this.floorName ? `from ${this.floorName}` : 'from this floor';
    const asked = this.types.length && this.ontology ? offered.filter((t) => this.types.includes(t.type.key)).map((t) => t.type.plural.toLowerCase()) : [];
    const empty = this.query.trim()
      ? `Nothing that shows ${where} matches that. Something kept on a floor below or beside this one won’t show here: go to that floor to pick it.`
      : `Nothing shows ${where} yet. Add it in Data Atlas first.`;
    return html`<style>
        atlas-picker { display: flex; flex-direction: column; gap: var(--space-5); min-width: min(40rem, 100%); }
        atlas-picker .atlas-picker-find { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-4); }
        atlas-picker .atlas-picker-chosen { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        atlas-picker .atlas-picker-actions { display: flex; gap: var(--space-2); justify-content: flex-end; }
        atlas-picker .atlas-note { margin: 0; font-size: var(--type-small); color: var(--ink-muted); }
      </style>
      <ui-heading eyebrow="Pick from Data Atlas" heading=${this.purpose || (this.multiple ? 'Pick entities' : 'Pick an entity')}
        summary=${`Find one by its name, another name it goes by, or a key like an IMO number. What shows is what can be seen ${where}.`}></ui-heading>
      ${asked.length ? html`<p class="atlas-note">Only ${asked.join(', ')} are asked for here, with their kinds below them.</p>` : nothing}
      <div class="atlas-picker-find">
        <ui-text-field label="Find" placeholder="Name, other name or key" .value=${this.query} @ui-input=${(e: CustomEvent<{ value: string }>) => this.search(e.detail.value)}></ui-text-field>
        <ui-select label="Kind" .options=${options} .value=${this.kind}
          @ui-change=${(e: CustomEvent<{ value: string }>) => {
            if (e.detail.value === this.kind) return;
            this.kind = e.detail.value;
            void this.list();
          }}></ui-select>
      </div>
      <ui-list label="Entities to pick from" density="compact" .noun=${['entity', 'entities']} .items=${rows} ?loading=${this.loading} error=${this.failure} empty=${empty}
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => {
          const entity = this.entities.find((x) => x.id === e.detail.item.id);
          if (entity) this.choose(entity);
        }}></ui-list>
      ${this.total > this.entities.length ? html`<p class="atlas-note">Showing the first ${this.entities.length} of ${this.total}. Narrow it with Find or Kind.</p>` : nothing}
      ${this.multiple && this.picked.length
        ? html`<div class="atlas-picker-chosen" aria-label="Picked">
            ${this.picked.map((p) => html`<ui-tag removable label=${p.label} @ui-remove=${() => this.choose(p)}></ui-tag>`)}
          </div>`
        : nothing}
      <div class="atlas-picker-actions">
        <ui-button kind="ghost" size="sm" @click=${() => this.emit('atlas-cancel')}>Cancel</ui-button>
        ${this.multiple
          ? html`<ui-button kind="primary" size="sm" ?disabled=${!this.picked.length} reason="Pick at least one first." @click=${() => this.emit('atlas-picked', { entities: this.picked.map(refOf) })}
              >${this.picked.length > 1 ? `Pick these ${this.picked.length}` : 'Pick it'}</ui-button>`
          : nothing}
      </div>
      ${this.multiple && !this.picked.length ? html`<p class="atlas-note">Pick at least one to go on.</p>` : nothing}`;
  }
}

if (!customElements.get('atlas-picker')) customElements.define('atlas-picker', AtlasPicker);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-picker': AtlasPicker;
  }
}
