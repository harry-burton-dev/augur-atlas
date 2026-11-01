import { LitElement, html, nothing } from 'lit';
import type { SelectOption } from '@augur/ui-kit';
import { MultiDirectedGraph } from 'graphology';
import type Sigma from 'sigma';
import type FA2Layout from 'graphology-layout-forceatlas2/worker';
import { PAST_DAYS, floorWords, type AtlasApi, type Fold, type GraphNode, type Ontology, type Subgraph } from './api.js';
import { FOLD, HIDDEN, foldsOf, hiddenNear, hoverDrawer, linksOf, rings, syncGraph, widen, type Explored, type Look } from './graph.js';

/** Links drawn from each entity before the rest fold into a count. */
const PER_NODE = 12;
/** Past this many links, their names stay in the panel and the list: on the graph they'd only be noise. */
const NAMED_LINKS = 24;

/** Whether this browser can draw with WebGL, which the graph needs. */
export const canDraw = () => {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

const RING_WORDS = ['', 'One ring', 'Two rings', 'Three rings'];

/**
 * The explorer: the graph around one entity, as seen from this floor, opened a
 * ring at a time. Each ring shows the strongest links and folds the rest into
 * counts to open; nothing loads the whole graph. What is linked but can't be
 * seen from here shows as a count that says why (explain, never hide). Drawn
 * with Sigma.js on graphology, laid out by ForceAtlas2 in a worker; the same
 * graph is always there as a list, for keyboards and screen readers, and for
 * browsers that can't draw it.
 *
 * @fires atlas-open-entity - detail `{ id }`: open its page
 * @fires atlas-explore - detail `{ id }`: make it the centre
 */
export class AtlasExplorer extends LitElement {
  static override properties = {
    api: { attribute: false },
    ontology: { attribute: false },
    centre: { type: String },
    floorName: { type: String, attribute: 'floor-name' },
    open: { state: true },
    depth: { state: true },
    kinds: { state: true },
    relations: { state: true },
    hideDisputed: { state: true },
    at: { state: true },
    selected: { state: true },
    loading: { state: true },
    busy: { state: true },
    error: { state: true },
    unseen: { state: true },
    view: { state: true },
  };

  declare api: AtlasApi;
  declare ontology: Ontology | undefined;
  /** The entity in the middle. */
  declare centre: string;
  declare floorName: string;
  declare open: Explored | undefined;
  declare depth: number;
  /** The top kinds to show, as ontology keys; all of them shows everything. */
  declare kinds: string[];
  declare relations: string[];
  declare hideDisputed: boolean;
  /** "True on": a day, or empty for today. */
  declare at: string;
  /** The node selected: an entity id, or a fold or hidden count. */
  declare selected: string;
  declare loading: boolean;
  /** Opening a fold or a ring. */
  declare busy: boolean;
  declare error: string;
  /** Why the centre can't be seen from here. */
  declare unseen: string;
  declare view: 'graph' | 'list';

  private readonly drawable = canDraw();
  private graph = new MultiDirectedGraph();
  private sigma?: Sigma;
  private layout?: FA2Layout;
  private settle?: ReturnType<typeof setTimeout>;
  private asked = 0;

  constructor() {
    super();
    this.centre = '';
    this.floorName = '';
    this.depth = 1;
    this.kinds = [];
    this.relations = [];
    this.hideDisputed = false;
    this.at = '';
    this.selected = '';
    this.loading = true;
    this.busy = false;
    this.error = '';
    this.unseen = '';
    this.view = this.drawable ? 'graph' : 'list';
  }

  override createRenderRoot() {
    return this;
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopDrawing();
  }

  private stopDrawing() {
    clearTimeout(this.settle);
    this.layout?.kill();
    this.sigma?.kill();
    this.layout = undefined;
    this.sigma = undefined;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('ontology') && this.ontology && !this.kinds.length) {
      this.kinds = this.topKinds().map((o) => o.value);
      this.relations = this.ontology.relations.map((r) => r.key);
    }
    if ((changed.has('api') || changed.has('centre')) && this.api && this.centre) void this.load();
  }

  override updated() {
    if (this.view === 'graph' && this.drawable && this.open?.nodes.size) void this.draw();
  }

  private topKinds(): SelectOption[] {
    return (this.ontology?.types ?? []).filter((t) => !t.parent).map((t) => ({ value: t.key, label: t.plural }));
  }

  /** What the filters ask the service for: nothing, when everything is chosen. */
  private narrowing() {
    const allKinds = this.kinds.length === this.topKinds().length;
    const allRelations = this.relations.length === (this.ontology?.relations.length ?? 0);
    return {
      ...(allKinds ? {} : { types: this.kinds }),
      ...(allRelations ? {} : { relations: this.relations }),
      ...(this.at ? { asOf: new Date(this.at).toISOString() } : {}),
    };
  }

  /** Starts again from the centre: on arriving, or when a filter or the day changes. */
  async load() {
    const asked = ++this.asked;
    this.loading = true;
    this.error = '';
    this.unseen = '';
    try {
      const sub = await this.api.subgraph({ seeds: [this.centre], depth: this.depth, limitPerNode: PER_NODE, ...this.narrowing() });
      if (asked !== this.asked) return;
      if (sub.missing.includes(this.centre)) throw new Error('There’s no such entity. It may have been merged into another.');
      const hidden = sub.unseen.find((u) => u.id === this.centre);
      if (hidden) {
        this.unseen = hidden.message;
        this.open = undefined;
        return;
      }
      this.open = widen(undefined, sub, this.centre);
      if (!this.open.nodes.has(this.selected)) this.selected = this.centre;
      // A fresh start draws afresh, so places from another centre don't linger.
      this.graph.clear();
    } catch (err) {
      if (asked === this.asked) this.error = (err as Error).message;
    } finally {
      if (asked === this.asked) this.loading = false;
    }
  }

  /** Adds to what is open, from one entity: a fold's links, or a ring past it. */
  private async widenFrom(from: string, query: Omit<Parameters<AtlasApi['subgraph']>[0], 'seeds'>, relation?: string) {
    this.busy = true;
    this.error = '';
    try {
      const sub: Subgraph = await this.api.subgraph({ seeds: [from], ...this.narrowing(), ...query });
      if (this.open) this.open = widen(this.open, sub, from, relation);
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private openFold(fold: Fold) {
    return this.widenFrom(fold.entity, { depth: 1, relations: [fold.relation], limitPerNode: 200 }, fold.relation);
  }

  private ringFrom(id: string) {
    return this.widenFrom(id, { depth: 1, limitPerNode: PER_NODE });
  }

  private look(): Look {
    const style = getComputedStyle(this);
    const token = (name: string, fallback: string) => style.getPropertyValue(`--${name}`).trim() || fallback;
    return {
      you: token('floor-you-high', '#34D399'),
      team: token('floor-team-high', '#F2B24C'),
      org: token('floor-org-high', '#86A0F4'),
      ink: token('ink', '#D1D5DB'),
      muted: token('ink-muted', '#9CA3AF'),
      line: token('hairline-strong', 'rgba(209, 213, 219, 0.24)'),
      disputed: token('warning', '#FBBF24'),
      ground: token('slate-deep', '#1C222C'),
    };
  }

  /** Draws what is open, laying out only while something new settles in. */
  private async draw() {
    const container = this.querySelector<HTMLElement>('.atlas-graph-canvas');
    if (!container || !this.open) return;
    const look = this.look();
    const added = syncGraph(this.graph, this.open, this.ontology, look, { hideDisputed: this.hideDisputed });
    if (!this.sigma) {
      const [{ default: SigmaDraw }, { default: Layout }, { default: forceAtlas2 }] = await Promise.all([
        import('sigma'),
        import('graphology-layout-forceatlas2/worker'),
        import('graphology-layout-forceatlas2'),
      ]);
      if (this.sigma || !this.isConnected) return;
      const font = getComputedStyle(this).fontFamily;
      this.sigma = new SigmaDraw(this.graph, container, {
        allowInvalidContainer: true,
        stagePadding: 60,
        labelRenderedSizeThreshold: 0,
        labelDensity: 1,
        labelGridCellSize: 60,
        defaultDrawNodeHover: hoverDrawer(look),
        labelFont: font,
        labelSize: 13,
        labelColor: { color: look.ink },
        edgeLabelFont: font,
        edgeLabelSize: 11,
        edgeLabelColor: { color: look.muted },
        defaultEdgeType: 'arrow',
        zIndex: true,
        nodeReducer: (node, attrs) => (node === this.selected ? { ...attrs, highlighted: true, zIndex: 1 } : attrs),
      });
      this.sigma.on('clickNode', ({ node }) => this.choose(node));
      this.sigma.on('clickStage', () => (this.selected = ''));
      this.sigma.on('enterNode', () => (container.style.cursor = 'pointer'));
      this.sigma.on('leaveNode', () => (container.style.cursor = ''));
      this.layout = new Layout(this.graph, { settings: { ...forceAtlas2.inferSettings(this.graph), slowDown: 4, gravity: 0.6 } });
    }
    if (added.length) {
      this.layout?.start();
      clearTimeout(this.settle);
      this.settle = setTimeout(() => this.layout?.stop(), 1600);
    }
    this.sigma.setSetting('renderEdgeLabels', this.graph.size <= NAMED_LINKS);
    this.sigma.refresh();
  }

  /** A press on a node: a fold opens, anything else is selected. */
  private choose(node: string) {
    if (node.startsWith(FOLD)) {
      const fold = this.open?.folds.get(node.slice(FOLD.length));
      if (fold) void this.openFold(fold);
      return;
    }
    this.selected = node;
  }

  private emit(name: string, id: string) {
    this.dispatchEvent(new CustomEvent(name, { detail: { id }, bubbles: true }));
  }

  /** A fold's links, read from its entity's side: "operates", "located at". */
  private foldWord(fold: Fold) {
    const r = this.ontology?.relations.find((x) => x.key === fold.relation);
    return ((fold.direction === 'in' ? r?.inverse : r?.label) ?? fold.relation).toLowerCase();
  }

  private foldButton(fold: Fold) {
    return html`<ui-button kind="secondary" size="sm" ?busy=${this.busy} @click=${() => void this.openFold(fold)}
      >Open ${fold.count} more ${this.foldWord(fold)}</ui-button>`;
  }

  private typeLabel(n: GraphNode) {
    return this.ontology?.types.find((t) => t.key === n.ref.type)?.label ?? n.ref.type;
  }

  /** What is selected, and what can be done with it from here. */
  private selection() {
    const open = this.open;
    if (!open) return nothing;
    if (this.selected.startsWith(HIDDEN)) {
      const near = this.selected.slice(HIDDEN.length);
      const hidden = hiddenNear(open, near);
      return html`<ui-heading eyebrow="Hidden from here" heading=${`${hidden.length} linked to ${open.nodes.get(near)?.ref.label ?? 'it'}`}></ui-heading>
        <ul class="atlas-why">${hidden.map((u) => html`<li>${u.message}</li>`)}</ul>`;
    }
    const n = open.nodes.get(this.selected);
    if (!n) return html`<p class="atlas-note">Select an entity to see how it’s linked, make it the centre, or open its page.</p>`;
    const links = linksOf(open, this.ontology, n.ref.id);
    const folds = foldsOf(open, n.ref.id);
    const hidden = hiddenNear(open, n.ref.id);
    const centre = n.ref.id === open.centre;
    return html`<ui-heading eyebrow=${`${this.typeLabel(n)} · ${n.floorName === 'Org' ? 'Org floor' : n.floorName === 'You' ? 'Your own floor' : n.floorName}`} heading=${n.ref.label}></ui-heading>
      ${n.state === 'retired' ? html`<p class="atlas-note">Retired. It keeps its id, so its links still say what it was.</p>` : nothing}
      ${links.length
        ? html`<ul class="atlas-links">
            ${links.map(
              (l) => html`<li>
                <span class="atlas-relation">${l.label}</span>
                <ui-ref .ref=${l.other.ref} @ui-open=${() => (this.selected = l.other.ref.id)}></ui-ref>
                ${l.edge.disputed ? html`<span class="atlas-disputed">disputed</span>` : nothing}
              </li>`,
            )}
          </ul>`
        : html`<p class="atlas-note">No links drawn yet.</p>`}
      ${hidden.length ? html`<p class="atlas-note">${hidden.length} more linked ${hidden.length === 1 ? 'one doesn’t' : 'ones don’t'} show from here. <button class="atlas-link" @click=${() => (this.selected = `${HIDDEN}${n.ref.id}`)}>Why</button></p>` : nothing}
      <div class="atlas-panel-actions">
        ${folds.map((f) => this.foldButton(f))}
        <ui-button kind="secondary" size="sm" ?disabled=${centre} reason="It’s already the centre." @click=${() => this.emit('atlas-explore', n.ref.id)}>Make it the centre</ui-button>
        <ui-button kind="ghost" size="sm" @click=${() => this.emit('atlas-open-entity', n.ref.id)}>Open its page</ui-button>
      </div>
      ${centre ? html`<p class="atlas-note">It’s the centre already.</p>` : nothing}
      ${!folds.length ? html`<p class="atlas-note">Everything linked to it from here is open.</p>` : nothing}`;
  }

  /** The same graph as a list, a ring at a time. Always there for keyboards and screen readers. */
  private list() {
    const open = this.open;
    if (!open) return nothing;
    return html`<div class="atlas-rings">
      ${rings(open).map(
        ({ depth, nodes }) => html`<section>
          <h3 class="atlas-ring">${depth === 0 ? 'Centre' : `Ring ${depth}`}</h3>
          <ul>
            ${nodes.map((n) => {
              const links = depth === 0 ? [] : linksOf(open, this.ontology, n.ref.id).filter((l) => l.other.depth < depth);
              const folds = foldsOf(open, n.ref.id);
              const hidden = hiddenNear(open, n.ref.id);
              return html`<li>
                <button class="atlas-link ${n.ref.id === this.selected ? 'atlas-chosen' : ''}" @click=${() => (this.selected = n.ref.id)}>${n.ref.label}</button>
                <span class="atlas-note">${this.typeLabel(n)} · ${floorWords(n.floorName)}</span>
                ${links.map((l) => html`<span class="atlas-note">· ${l.label} ${l.other.ref.label}${l.edge.disputed ? ' (disputed)' : ''}</span>`)}
                ${folds.map((f) => html`<button class="atlas-fold" ?disabled=${this.busy} @click=${() => void this.openFold(f)}>+${f.count} ${this.foldWord(f)}</button>`)}
                ${hidden.length ? html`<button class="atlas-fold" @click=${() => (this.selected = `${HIDDEN}${n.ref.id}`)}>${hidden.length} hidden</button>` : nothing}
              </li>`;
            })}
          </ul>
        </section>`,
      )}
    </div>`;
  }

  private filters() {
    const relationOptions = (this.ontology?.relations ?? []).map((r) => ({ value: r.key, label: r.label }));
    const rings: SelectOption[] = [1, 2, 3].map((d) => ({ value: String(d), label: RING_WORDS[d] }));
    return html`<aside class="atlas-filters-pane" aria-label="What to show">
      <ui-select label="Rings out" .options=${rings} .value=${String(this.depth)}
        @ui-change=${(e: CustomEvent<{ value: string }>) => {
          if (Number(e.detail.value) === this.depth) return;
          this.depth = Number(e.detail.value);
          void this.load();
        }}></ui-select>
      <ui-checkbox-group label="Kinds" required .options=${this.topKinds()} .values=${this.kinds}
        hint="The centre always shows"
        @ui-change=${(e: CustomEvent<{ values: string[] }>) => {
          this.kinds = e.detail.values;
          if (this.kinds.length) void this.load();
        }}></ui-checkbox-group>
      <ui-checkbox-group label="Links" required .options=${relationOptions} .values=${this.relations}
        @ui-change=${(e: CustomEvent<{ values: string[] }>) => {
          this.relations = e.detail.values;
          if (this.relations.length) void this.load();
        }}></ui-checkbox-group>
      <ui-toggle label="Hide disputed" .checked=${this.hideDisputed} hint="Disputed links, and what only they reach"
        @ui-change=${(e: CustomEvent<{ checked: boolean }>) => (this.hideDisputed = e.detail.checked)}></ui-toggle>
      <ui-date label="True on" optional empty="Today" .quick=${PAST_DAYS} .value=${this.at} hint="The day in the world"
        @ui-change=${(e: CustomEvent<{ value: string }>) => {
          if (e.detail.value === this.at) return;
          this.at = e.detail.value;
          void this.load();
        }}></ui-date>
    </aside>`;
  }

  private legend() {
    return html`<ul class="atlas-legend" aria-label="Key">
      <li><span class="atlas-dot" style="background: var(--floor-you-high)"></span>Kept on your own floor</li>
      <li><span class="atlas-dot" style="background: var(--floor-team-high)"></span>On a team’s floor</li>
      <li><span class="atlas-dot" style="background: var(--floor-org-high)"></span>On the org floor</li>
      <li><span class="atlas-dot atlas-dot-small" style="background: var(--ink-muted)"></span>Folded or hidden: press to open or see why</li>
      <li><span class="atlas-line" style="background: var(--warning)"></span>Disputed</li>
    </ul>`;
  }

  private body() {
    if (this.unseen) return html`<ui-state kind="empty" heading="You can’t see this from here" body=${this.unseen}></ui-state>`;
    if (this.error && !this.open) return html`<ui-state kind="error" heading="Couldn’t open the graph" body=${this.error} action="Try again" @ui-action=${() => void this.load()}></ui-state>`;
    if (this.loading && !this.open) return html`<ui-state kind="loading" heading="Opening the graph…"></ui-state>`;
    return html`<div class="atlas-explore">
      ${this.filters()}
      <div class="atlas-stage">
        <div class="atlas-stage-bar">
          ${this.drawable
            ? html`<ui-button kind="ghost" size="sm" @click=${() => {
                this.view = this.view === 'graph' ? 'list' : 'graph';
                if (this.view === 'list') this.stopDrawing();
                this.graph.clear();
              }}>${this.view === 'graph' ? 'Show as a list' : 'Show as a graph'}</ui-button>`
            : html`<p class="atlas-note">This browser can’t draw the graph (it needs WebGL), so it shows as a list.</p>`}
          ${this.busy || this.loading ? html`<span class="atlas-note" role="status">Opening…</span>` : nothing}
          ${this.error ? html`<span class="atlas-note atlas-error" role="alert">${this.error}</span>` : nothing}
        </div>
        ${this.view === 'graph'
          ? html`<div class="atlas-graph-canvas" role="img" aria-label=${`The graph around ${this.open?.nodes.get(this.centre)?.ref.label ?? 'this entity'}. The same graph is offered as a list.`}></div>${this.legend()}`
          : this.list()}
      </div>
      <aside class="atlas-panel" aria-label="Selected">${this.selection()}</aside>
    </div>`;
  }

  override render() {
    const label = this.open?.nodes.get(this.centre)?.ref.label;
    return html`<style>
        atlas-explorer { display: flex; flex-direction: column; gap: var(--space-5); }
        atlas-explorer .atlas-explore { display: grid; grid-template-columns: 15rem minmax(0, 1fr) 18rem; gap: var(--space-5); align-items: start; }
        atlas-explorer .atlas-filters-pane, atlas-explorer .atlas-panel { display: flex; flex-direction: column; gap: var(--space-4); }
        atlas-explorer .atlas-panel { background: var(--surface-pane); border-radius: var(--radius-md, 12px); padding: var(--space-4); }
        atlas-explorer .atlas-stage { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
        atlas-explorer .atlas-stage-bar { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; min-height: 2rem; }
        atlas-explorer .atlas-graph-canvas { height: min(70vh, 40rem); min-height: 24rem; background: var(--surface-inset); border-radius: var(--radius-md, 12px); }
        atlas-explorer .atlas-note { margin: 0; font-size: var(--type-small); color: var(--ink-muted); }
        atlas-explorer .atlas-error { color: var(--danger); }
        atlas-explorer .atlas-legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin: 0; padding: 0; list-style: none; font-size: var(--type-small); color: var(--ink-muted); }
        atlas-explorer .atlas-legend li { display: flex; align-items: center; gap: var(--space-2); }
        atlas-explorer .atlas-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
        atlas-explorer .atlas-dot-small { width: 6px; height: 6px; }
        atlas-explorer .atlas-line { width: 16px; height: 2px; display: inline-block; }
        atlas-explorer .atlas-links, atlas-explorer .atlas-why, atlas-explorer .atlas-rings ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
        atlas-explorer .atlas-why li { font-size: var(--type-small); }
        atlas-explorer .atlas-relation { color: var(--ink-muted); font-size: var(--type-small); margin-right: var(--space-2); }
        atlas-explorer .atlas-disputed { color: var(--warning); font-size: var(--type-small); margin-left: var(--space-2); }
        atlas-explorer .atlas-link { background: none; border: 0; padding: 0; color: var(--ink); font: inherit; text-decoration: underline; text-decoration-color: var(--hairline-strong); text-underline-offset: 3px; cursor: pointer; }
        atlas-explorer .atlas-link:focus-visible, atlas-explorer .atlas-fold:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
        atlas-explorer .atlas-chosen { color: var(--green); }
        atlas-explorer .atlas-fold { background: none; border: 1px solid var(--hairline-strong); border-radius: 999px; padding: 0 var(--space-2); margin-left: var(--space-2); color: var(--ink); font: inherit; font-size: var(--type-small); cursor: pointer; }
        atlas-explorer .atlas-fold:disabled { color: var(--ink-muted); cursor: default; }
        atlas-explorer .atlas-rings { display: flex; flex-direction: column; gap: var(--space-4); }
        atlas-explorer .atlas-rings li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); }
        atlas-explorer .atlas-ring { margin: 0 0 var(--space-2); font-size: var(--type-small); font-weight: 400; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-muted); }
        atlas-explorer .atlas-panel-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        @media (max-width: 1100px) { atlas-explorer .atlas-explore { grid-template-columns: minmax(0, 1fr); } }
      </style>
      <ui-page-head eyebrow=${this.floorName ? `${this.floorName} · Explore` : 'Explore'} heading=${label ? `Around ${label}` : 'Explore'}
        summary="What it’s linked to, as seen from this floor, a ring at a time."></ui-page-head>
      ${this.body()}`;
  }
}

if (!customElements.get('atlas-explorer')) customElements.define('atlas-explorer', AtlasExplorer);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-explorer': AtlasExplorer;
  }
}
