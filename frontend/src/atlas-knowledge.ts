import { LitElement, html, nothing } from 'lit';
import { isIntentCancelled, type DocumentRef } from '@augur/mfe-sdk';
import { ago, type DialogSubmit, type ListItem, type SelectOption } from '@augur/ui-kit';
import {
  PAST_DAYS,
  day,
  floorWords,
  propertiesOf,
  saying,
  sourceLine,
  span,
  type AtlasApi,
  type Entity,
  type FactView,
  type Knowledge,
  type ObservationView,
  type Ontology,
  type OtherEnd,
  type Source,
} from './api.js';

type Panel =
  | { kind: 'observe' }
  | { kind: 'fact'; fact: FactView }
  | { kind: 'observation'; observation: ObservationView }
  | { kind: 'accept'; observation: ObservationView }
  | { kind: 'raise'; observation: ObservationView }
  | { kind: 'end'; fact: FactView }
  | { kind: 'withdraw'; fact: FactView }
  | { kind: 'dispute'; fact: FactView };

const RELIABILITY: SelectOption[] = [
  { value: '', label: 'Not graded' },
  { value: 'A', label: 'A: completely reliable' },
  { value: 'B', label: 'B: usually reliable' },
  { value: 'C', label: 'C: fairly reliable' },
  { value: 'D', label: 'D: not usually reliable' },
  { value: 'E', label: 'E: unreliable' },
  { value: 'F', label: 'F: reliability can’t be judged' },
];
const CREDIBILITY: SelectOption[] = [
  { value: '', label: 'Not graded' },
  { value: '1', label: '1: confirmed by other sources' },
  { value: '2', label: '2: probably true' },
  { value: '3', label: '3: possibly true' },
  { value: '4', label: '4: doubtful' },
  { value: '5', label: '5: improbable' },
  { value: '6', label: '6: truth can’t be judged' },
];

/** A date from a date field, as the start of that day (UTC); blank stays blank. */
const startOf = (date: string) => (date ? `${date}T00:00:00.000Z` : undefined);
/** A date from an "as of" field, as the end of that day, so the whole day counts. */
const endOf = (date: string) => (date ? `${date}T23:59:59.999Z` : undefined);

/**
 * What is known about one entity, as seen from the floor the person stands on:
 * the facts floors hold (each saying which floor holds it, so a team's working
 * view sits beside the org's confirmed record), links to other entities both
 * ways, and the observations behind them. "As of" and "as known on" move the
 * two clocks. Whatever can't be done says why, rather than vanishing.
 *
 * @fires atlas-open-entity - detail `{ id }`: open the entity at a link's other end
 */
export class AtlasKnowledge extends LitElement {
  static override properties = {
    api: { attribute: false },
    entity: { attribute: false },
    ontology: { attribute: false },
    pickDocument: { attribute: false },
    knowledge: { state: true },
    at: { state: true },
    known: { state: true },
    failure: { state: true },
    panel: { state: true },
    property: { state: true },
    targets: { state: true },
    sourceKind: { state: true },
    document: { state: true },
  };

  declare api: AtlasApi;
  declare entity: Entity;
  declare ontology: Ontology;
  /** Asks the person for a document (the SDK's pickDocument), when an app that keeps them is there. */
  declare pickDocument: (() => Promise<DocumentRef>) | undefined;
  declare knowledge: Knowledge | undefined;
  /** The valid clock: what was true on this day. Blank for now. */
  declare at: string;
  /** The recorded clock: what was on record on this day. Blank for now. */
  declare known: string;
  declare failure: string;
  declare panel: Panel | undefined;
  /** The detail or link being observed. */
  declare property: string;
  /** Entities a link being observed may point at. */
  declare targets: SelectOption[];
  declare sourceKind: Source['kind'];
  declare document: DocumentRef | undefined;

  constructor() {
    super();
    this.at = '';
    this.known = '';
    this.failure = '';
    this.property = '';
    this.targets = [];
    this.sourceKind = 'person';
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if ((changed.has('api') || changed.has('entity')) && this.api && this.entity) void this.load();
  }

  async load() {
    this.failure = '';
    try {
      this.knowledge = await this.api.knowledge(this.entity.id, { at: endOf(this.at), known: endOf(this.known) });
    } catch (err) {
      this.failure = (err as Error).message;
    }
  }

  private emit(name: string, detail: object) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }

  private says(x: FactView | ObservationView) {
    return saying(this.ontology, this.entity.type, x);
  }

  private properties() {
    return propertiesOf(this.ontology, this.entity.type);
  }

  /** Picks what to observe; a link loads the entities it may point at that show from here. */
  private async choose(key: string) {
    if (key === this.property) return;
    this.property = key;
    this.targets = [];
    const link = this.properties().find((p) => p.key === key)?.link;
    if (!link) return;
    try {
      const { entities } = await this.api.entities({ type: link.to, limit: 200 });
      this.targets = entities.filter((e) => e.id !== this.entity.id).map((e) => ({ value: e.id, label: `${e.label} (${e.floorName})` }));
    } catch (err) {
      this.failure = (err as Error).message;
    }
  }

  private async askForDocument() {
    if (!this.pickDocument) return;
    try {
      this.document = await this.pickDocument();
    } catch (err) {
      // Closed without picking is nothing to say; anything else is.
      if (!isIntentCancelled(err)) this.failure = (err as Error).message;
    }
  }

  private open(panel: Panel | undefined) {
    this.panel = panel;
    if (panel?.kind === 'observe') {
      this.property = '';
      this.document = undefined;
      this.sourceKind = 'person';
      void this.choose(this.properties()[0]?.key ?? '');
    }
  }

  private done = async () => {
    this.panel = undefined;
    await this.load();
  };

  private submitObserve: DialogSubmit = async (values) => {
    const link = this.properties().find((p) => p.key === this.property)?.link;
    const source: Source | undefined =
      this.sourceKind === 'person'
        ? { kind: 'person' }
        : this.sourceKind === 'document'
          ? this.document && { kind: 'document', document: { app: this.document.app, id: this.document.id, title: this.document.title, ...(this.document.version ? { version: this.document.version } : {}) } }
          : { kind: 'other', note: values.sourceNote ?? '' };
    if (!source) throw new Error('Pick the document it came from, or say it came from somewhere else.');
    const grade = values.reliability && values.credibility ? `${values.reliability}${values.credibility}` : undefined;
    if ((values.reliability || values.credibility) && !grade) throw new Error('A grade has both parts: how reliable the source is, and how credible what it says is.');
    await this.api.observe(this.entity.id, {
      property: this.property,
      ...(link ? { target: values.target } : { value: values.value }),
      ...(values.observedAt ? { observedAt: startOf(values.observedAt) } : {}),
      source,
      ...(grade ? { grade } : {}),
      ...(values.note?.trim() ? { note: values.note } : {}),
      ...(values.accept === 'yes' ? { accept: true } : {}),
    });
    await this.done();
  };

  private submitAccept: DialogSubmit = async (values) => {
    if (this.panel?.kind !== 'accept') return false;
    await this.api.acceptFact(this.entity.id, {
      backedBy: [this.panel.observation.id],
      ...(values.validFrom ? { validFrom: startOf(values.validFrom) } : {}),
      ...(values.validTo ? { validTo: startOf(values.validTo) } : {}),
      ...(values.note?.trim() ? { note: values.note } : {}),
    });
    await this.done();
  };

  private submitRaise: DialogSubmit = async (values) => {
    if (this.panel?.kind !== 'raise') return false;
    await this.api.raise(this.panel.observation.id, values.to);
    await this.done();
  };

  private submitEnd: DialogSubmit = async (values) => {
    if (this.panel?.kind !== 'end') return false;
    await this.api.endFact(this.panel.fact.id, startOf(values.validTo));
    await this.done();
  };

  private submitWithdraw: DialogSubmit = async () => {
    if (this.panel?.kind !== 'withdraw') return false;
    await this.api.withdrawFact(this.panel.fact.id);
    await this.done();
  };

  private submitDispute: DialogSubmit = async (values) => {
    if (this.panel?.kind !== 'dispute') return false;
    await this.api.dispute(this.panel.fact.id, values.note);
    await this.done();
  };

  private otherLine(other: OtherEnd | undefined) {
    if (!other) return nothing;
    if ('missing' in other) return html`<p class="atlas-note">The entity at the other end no longer exists.</p>`;
    if ('hidden' in other) return html`<p class="atlas-note">${other.message}</p>`;
    return html`<ui-button kind="secondary" size="sm" @click=${() => {
      this.panel = undefined;
      this.emit('atlas-open-entity', { id: other.id });
    }}>Open ${other.label}</ui-button>`;
  }

  private factRows(facts: FactView[]): ListItem[] {
    return facts.map((f) => ({
      id: f.id,
      title: this.says(f),
      detail: [span(f), `Kept on ${floorWords(f.floorName)}`, f.disputes.length ? `${f.disputes.length === 1 ? 'Disputed' : `${f.disputes.length} disputes`}` : '', f.unbacked ? 'Its sources were withdrawn' : ''].filter(Boolean).join(' · '),
      status: f.disputes.length || f.unbacked ? ('warning' as const) : undefined,
      icon: f.disputes.length ? undefined : f.target ? 'atlas' : 'check',
    }));
  }

  private panels() {
    const p = this.panel;
    if (!p) return nothing;
    const close = () => (this.panel = undefined);
    switch (p.kind) {
      case 'observe': {
        const props = this.properties();
        const chosen = props.find((x) => x.key === this.property);
        const here = this.knowledge?.here;
        return html`<ui-dialog open eyebrow=${here?.floorName ?? ''} heading="Record an observation" summary=${`What was seen or read about ${this.entity.label}, as it was said. It’s kept on this floor and never changed.`}
          action-label="Record it" busy-label="Recording…" .submit=${this.submitObserve} @ui-close=${close}>
          <ui-select slot="fields" label="About" .options=${props.map((x) => ({ value: x.key, label: x.link ? `${x.label}…` : x.label }))} .value=${this.property}
            @ui-change=${(e: CustomEvent<{ value: string }>) => void this.choose(e.detail.value)}></ui-select>
          ${chosen?.link
            ? this.targets.length
              ? html`<ui-select slot="fields" name="target" label=${chosen.label} .options=${this.targets} .value=${this.targets[0].value}></ui-select>`
              : html`<p slot="fields" class="atlas-note">Nothing it can link to shows from this floor yet. Add the entity first, or go to a floor where it shows.</p>`
            : html`<ui-text-field slot="fields" name="value" label=${chosen?.label ?? 'Value'} required maxlength="200" hint=${chosen?.detail?.hint ?? ''}></ui-text-field>`}
          <ui-date slot="fields" name="observedAt" label="When it was seen" optional empty="Today" .quick=${PAST_DAYS}></ui-date>
          <ui-select slot="fields" label="Where it came from" .value=${this.sourceKind}
            .options=${[
              { value: 'person', label: 'I saw or heard it' },
              { value: 'document', label: this.pickDocument ? 'A document in Artifacts' : 'A document (no app that keeps documents is here)' },
              { value: 'other', label: 'Somewhere else' },
            ]}
            @ui-change=${(e: CustomEvent<{ value: Source['kind'] }>) => {
              if (e.detail.value !== this.sourceKind) this.sourceKind = e.detail.value;
            }}></ui-select>
          ${this.sourceKind === 'document'
            ? html`<div slot="fields" class="atlas-row">
                <ui-button kind="secondary" size="sm" ?disabled=${!this.pickDocument} reason="No app here keeps documents, so none can be picked." @click=${() => void this.askForDocument()}>${this.document ? 'Pick another' : 'Pick the document'}</ui-button>
                <span class="atlas-note">${this.document ? this.document.title : this.pickDocument ? 'None picked yet.' : ''}</span>
              </div>`
            : this.sourceKind === 'other'
              ? html`<ui-text-field slot="fields" name="sourceNote" label="Where" required maxlength="500" placeholder="Such as a call with the harbour master"></ui-text-field>`
              : nothing}
          <ui-select slot="fields" name="reliability" label="How reliable the source is" .options=${RELIABILITY} value=""></ui-select>
          <ui-select slot="fields" name="credibility" label="How credible what it says is" .options=${CREDIBILITY} value=""></ui-select>
          <ui-text-field slot="fields" name="note" label="Note" optional multiline maxlength="2000"></ui-text-field>
          ${here?.accept
            ? html`<ui-select slot="fields" name="accept" label="On this floor" value="no"
                .options=${[
                  { value: 'no', label: 'Just record it' },
                  { value: 'yes', label: 'Record it, and accept it as so here' },
                ]}></ui-select>`
            : html`<p slot="fields" class="atlas-note">${here?.why ?? ''}</p>`}
        </ui-dialog>`;
      }
      case 'fact': {
        const f = p.fact;
        return html`<ui-dialog open size="read" eyebrow=${`Kept on ${floorWords(f.floorName)}`} heading=${this.says(f)} summary=${span(f)} cancel-label="Close" @ui-close=${close}>
          <ui-details .items=${[
            { label: 'Recorded', value: ago(f.recordedAt) },
            { label: 'Rests on', value: f.backedBy.length === 1 ? 'One observation' : `${f.backedBy.length} observations` },
            ...(f.note ? [{ label: 'Note', value: f.note }] : []),
          ]}></ui-details>
          ${f.unbacked ? html`<p class="atlas-note">${f.unbacked}</p>` : nothing}
          ${this.otherLine(f.other)}
          ${f.disputes.map(
            (d) => html`<div class="atlas-dispute">
              <p><strong>Disputed from ${floorWords(d.floorName)}</strong> ${ago(d.at)}: ${d.note}</p>
              ${d.mine || f.can.withdraw
                ? html`<ui-button kind="ghost" size="sm" @click=${async () => {
                    await this.api.clearDispute(d.id);
                    await this.done();
                  }}>Clear it</ui-button>`
                : nothing}
            </div>`,
          )}
          <div class="atlas-actions">
            <ui-button kind="secondary" size="sm" ?disabled=${!f.can.dispute} reason=${f.can.why ?? 'You can’t dispute it from here.'} @click=${() => (this.panel = { kind: 'dispute', fact: f })}>Dispute</ui-button>
            <ui-button kind="ghost" size="sm" ?disabled=${!f.can.end} reason=${f.can.why ?? 'Only the floor that holds it can end it.'} @click=${() => (this.panel = { kind: 'end', fact: f })}>It has ended</ui-button>
            <ui-button kind="ghost" size="sm" ?disabled=${!f.can.withdraw} reason=${f.can.why ?? 'Only the floor that holds it can withdraw it.'} @click=${() => (this.panel = { kind: 'withdraw', fact: f })}>Withdraw</ui-button>
          </div>
        </ui-dialog>`;
      }
      case 'observation': {
        const o = p.observation;
        return html`<ui-dialog open size="read" eyebrow=${`Recorded on ${floorWords(o.floorName)}`} heading=${this.says(o)} summary=${sourceLine(o.source)} cancel-label="Close" @ui-close=${close}>
          <ui-details .items=${[
            { label: 'Seen', value: o.observedAt ? day(o.observedAt) : `Not said; recorded ${ago(o.createdAt)}` },
            { label: 'Grade', value: o.grade ?? 'Not graded' },
            ...(o.note ? [{ label: 'Note', value: o.note }] : []),
            ...(o.raisedFrom ? [{ label: 'Raised', value: 'From a floor below' }] : []),
            ...(o.raisedTo.length ? [{ label: 'Raised to', value: o.raisedTo.join(', ') }] : []),
          ]}></ui-details>
          ${o.retracted ? html`<p class="atlas-note">${o.retracted.why} It’s kept as it was said, ${ago(o.retracted.at)} it stopped counting as evidence.</p>` : nothing}
          ${this.otherLine(o.other)}
          <div class="atlas-actions">
            <ui-button kind="secondary" size="sm" ?disabled=${!o.can.accept || !!o.retracted}
              reason=${o.retracted ? 'Its source was withdrawn, so it can’t back a fact.' : (o.can.why ?? 'You can’t accept it on this floor.')} @click=${() => (this.panel = { kind: 'accept', observation: o })}>Accept as so here</ui-button>
            <ui-button kind="ghost" size="sm" ?disabled=${!o.can.raise} reason=${o.can.why ?? 'There’s no floor above you can raise it to.'} @click=${() => (this.panel = { kind: 'raise', observation: o })}>Raise to a floor above</ui-button>
          </div>
        </ui-dialog>`;
      }
      case 'accept':
        return html`<ui-dialog open eyebrow=${this.knowledge?.here.floorName ?? ''} heading="Accept it as so here" summary=${`${this.says(p.observation)}. This floor will hold it as a fact, resting on this observation.`}
          action-label="Accept it" busy-label="Accepting…" .submit=${this.submitAccept} @ui-close=${close}>
          <ui-date slot="fields" name="validFrom" label="True from" optional empty=${p.observation.observedAt ? `When it was seen, ${day(p.observation.observedAt)}` : 'Not known'} .quick=${PAST_DAYS}></ui-date>
          <ui-date slot="fields" name="validTo" label="Until" optional empty="Still holds" .quick=${[]}></ui-date>
          <ui-text-field slot="fields" name="note" label="Note" optional multiline maxlength="2000"></ui-text-field>
        </ui-dialog>`;
      case 'raise':
        return html`<ui-dialog open eyebrow=${p.observation.floorName} heading="Raise to a floor above" summary="A copy goes up, pointing back to this one. The floor above decides whether to accept it: what higher floors hold is worth more."
          action-label="Raise it" busy-label="Raising…" .submit=${this.submitRaise} @ui-close=${close}>
          <ui-select slot="fields" name="to" label="To" .options=${p.observation.can.raiseTo.map((f) => ({ value: f.floor, label: f.name }))} .value=${p.observation.can.raiseTo[0]?.floor ?? ''}></ui-select>
        </ui-dialog>`;
      case 'end':
        return html`<ui-dialog open eyebrow=${p.fact.floorName} heading="When did it end?" summary=${`${this.says(p.fact)}. It stays true for the time before, and the record of it stays.`}
          action-label="End it" busy-label="Ending…" .submit=${this.submitEnd} @ui-close=${close}>
          <ui-date slot="fields" name="validTo" label="Ended on" optional empty="Today" .quick=${PAST_DAYS}></ui-date>
        </ui-dialog>`;
      case 'withdraw':
        return html`<ui-dialog open danger eyebrow=${p.fact.floorName} heading="Withdraw it?" action-label="Withdraw" busy-label="Withdrawing…" .submit=${this.submitWithdraw} @ui-close=${close}>
          <p>For a fact recorded in error. It stops showing from now on, but stays on record: looking “as known on” an earlier day still finds it.</p>
        </ui-dialog>`;
      case 'dispute':
        return html`<ui-dialog open eyebrow=${`Kept on ${floorWords(p.fact.floorName)}`} heading="Dispute it" summary=${`${this.says(p.fact)}. Say why it may be wrong. Its floor sees the dispute, and it shows here until cleared.`}
          action-label="Dispute it" busy-label="Sending…" .submit=${this.submitDispute} @ui-close=${close}>
          <ui-text-field slot="fields" name="note" label="Why" required multiline maxlength="2000"></ui-text-field>
        </ui-dialog>`;
    }
  }

  override render() {
    const k = this.knowledge;
    const details = k?.facts.filter((f) => !f.target) ?? [];
    const links = k?.facts.filter((f) => f.target) ?? [];
    const when = [this.at ? `true on ${day(`${this.at}T00:00:00Z`)}` : 'true now', this.known ? `as recorded by ${day(`${this.known}T00:00:00Z`)}` : 'as recorded now'].join(', ');
    const observations: ListItem[] = (k?.observations ?? []).map((o) => ({
      id: o.id,
      title: this.says(o),
      detail: [o.observedAt ? `Seen ${day(o.observedAt)}` : `Recorded ${ago(o.createdAt)}`, sourceLine(o.source), o.grade, `On ${floorWords(o.floorName)}`, o.raisedTo.length ? `Raised to ${o.raisedTo.join(', ')}` : '', o.retracted ? 'Source withdrawn' : ''].filter(Boolean).join(' · '),
      icon: o.source.kind === 'document' ? 'document' : 'view',
      ...(o.retracted ? { status: 'warning' as const } : {}),
    }));
    return html`<style>
        atlas-knowledge { display: flex; flex-direction: column; gap: var(--space-5); }
        atlas-knowledge .atlas-clocks { display: grid; grid-template-columns: repeat(2, minmax(0, 14rem)) 1fr; gap: var(--space-4); align-items: end; }
        atlas-knowledge .atlas-row { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
        atlas-knowledge .atlas-dispute { display: flex; gap: var(--space-3); align-items: baseline; justify-content: space-between; border-left: 2px solid var(--green); padding-left: var(--space-3); }
        atlas-knowledge .atlas-dispute p { margin: 0; }
        @media (max-width: 640px) { atlas-knowledge .atlas-clocks { grid-template-columns: minmax(0, 1fr); } }
      </style>
      <div class="atlas-head">
        <ui-heading size="s" level="2" heading="What’s known" summary=${`Facts each floor holds, ${when}. Each says which floor holds it: a team’s working view sits beside the org’s confirmed record.`}></ui-heading>
        <ui-button kind="secondary" size="sm" ?disabled=${this.entity.state !== 'active'} reason="It has been retired, so nothing more is recorded about it." @click=${() => this.open({ kind: 'observe' })}>Record an observation</ui-button>
      </div>
      ${this.entity.state !== 'active' ? html`<p class="atlas-note">It has been retired, so nothing more is recorded about it.</p>` : nothing}
      ${k?.noCurrentSource ? html`<p class="atlas-note" role="status">${k.noCurrentSource}</p>` : nothing}
      <div class="atlas-clocks">
        <ui-date label="True on" optional empty="Today" .quick=${PAST_DAYS} .value=${this.at} hint="The day in the world"
          @ui-change=${(e: CustomEvent<{ value: string }>) => {
            if (e.detail.value === this.at) return;
            this.at = e.detail.value;
            void this.load();
          }}></ui-date>
        <ui-date label="As recorded by" optional empty="Today" .quick=${PAST_DAYS} .value=${this.known} hint="What was on record that day"
          @ui-change=${(e: CustomEvent<{ value: string }>) => {
            if (e.detail.value === this.known) return;
            this.known = e.detail.value;
            void this.load();
          }}></ui-date>
      </div>
      <ui-list label="Facts" density="compact" .noun=${['fact', 'facts']} .items=${this.factRows(details)} ?loading=${!k && !this.failure} error=${this.failure}
        empty="No floor you can see holds a fact about it yet. Facts come from observations a floor’s leads accept."
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => {
          const fact = details.find((f) => f.id === e.detail.item.id);
          if (fact) this.panel = { kind: 'fact', fact };
        }}
        @ui-retry=${() => void this.load()}></ui-list>
      <ui-list label="Links" density="compact" .noun=${['link', 'links']} .items=${this.factRows(links)} ?loading=${!k && !this.failure}
        empty="No links to other entities show from here yet."
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => {
          const fact = links.find((f) => f.id === e.detail.item.id);
          if (fact) this.panel = { kind: 'fact', fact };
        }}></ui-list>
      <ui-list label="Observations" density="compact" .noun=${['observation', 'observations']} .items=${observations} ?loading=${!k && !this.failure}
        empty="Nothing has been recorded about it on a floor you can see."
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => {
          const observation = k?.observations.find((o) => o.id === e.detail.item.id);
          if (observation) this.panel = { kind: 'observation', observation };
        }}></ui-list>
      ${k && !k.here.accept ? html`<p class="atlas-note">${k.here.why}</p>` : nothing}
      ${this.panels()}`;
  }
}

if (!customElements.get('atlas-knowledge')) customElements.define('atlas-knowledge', AtlasKnowledge);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-knowledge': AtlasKnowledge;
  }
}
