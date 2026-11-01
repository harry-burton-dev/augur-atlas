import { LitElement, html, nothing } from 'lit';
import { ago, type ListItem, type SelectOption } from '@augur/ui-kit';
import type { DocumentRef, EntityRef } from '@augur/mfe-sdk';
import './atlas-picker.js';
import { day, floorWords, isA, propertyLabel, typeTree, type AtlasApi, type MatchView, type Matching, type MentionView, type Ontology, type Place, type ProposalObservationView, type ProposalView, type Triage } from './api.js';

/** A mention's words picked out of the passage around them. */
const inContext = (context: string, text: string) => {
  const at = context.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return html`${context}`;
  return html`${context.slice(0, at)}<mark>${context.slice(at, at + text.length)}</mark>${context.slice(at + text.length)}`;
};

/** Why a match was offered, in words: by key, name, spelling or meaning. */
const matchWhy = (x: MatchView) => {
  switch (x.why) {
    case 'key':
      return `same ${x.detail ?? 'key'}`;
    case 'name':
      return 'same name';
    case 'alias':
      return 'goes by that name';
    case 'similar':
      return x.detail && x.detail !== x.entity.label ? `goes by “${x.detail}”, spelt alike` : 'spelt alike';
    case 'meaning':
      return 'close in meaning';
  }
};

/** What was tried to find matches, said plainly, with why anything wasn't. */
const matchingWords = (m: Matching | undefined) => {
  if (!m) return '';
  const tried = ['identity keys', 'names', ...(m.spelling ? ['names spelt nearly alike'] : []), ...(m.meaning ? ['meaning'] : [])];
  return `Matched by ${tried.slice(0, -1).join(', ')} and ${tried[tried.length - 1]}, ${ago(m.at)}.${m.why ? ` ${m.why}` : ''}`;
};

/**
 * Triage: where proposals become knowledge. A floor's open proposals, and one
 * proposal at a time: the source, what it seems to name, and what it seems to
 * say. Each mention is an entity already known, a new one, or nothing; each
 * observation is accepted as so, kept as seen, or dropped. Nothing becomes
 * knowledge until a lead decides, and nothing skips this step in v1.
 *
 * @fires atlas-move - detail is the Place to go to
 * @fires atlas-open-document - detail `{ ref }`: open the source in the app that keeps it
 */
export class AtlasTriage extends LitElement {
  static override properties = {
    api: { attribute: false },
    ontology: { attribute: false },
    place: { attribute: false },
    userId: { type: String, attribute: 'user-id' },
    triage: { state: true },
    closed: { state: true },
    open: { state: true },
    loading: { state: true },
    failure: { state: true },
    busy: { state: true },
    refusal: { state: true },
    choosing: { state: true },
    making: { state: true },
    newType: { state: true },
    newLabel: { state: true },
  };

  declare api: AtlasApi;
  declare ontology: Ontology | undefined;
  declare place: Place;
  declare userId: string;
  declare triage: Triage | undefined;
  declare closed: Triage | undefined;
  declare open: ProposalView | undefined;
  declare loading: boolean;
  declare failure: string;
  /** The item being decided, so its buttons wait. */
  declare busy: string;
  /** Why the last decision was refused, beside the item it was for. */
  declare refusal: { key: string; message: string } | undefined;
  /** The mention whose "something else" picker is open. */
  declare choosing: string;
  /** The mention whose "a new one" form is open. */
  declare making: string;
  declare newType: string;
  declare newLabel: string;

  constructor() {
    super();
    this.userId = '';
    this.loading = true;
    this.failure = '';
    this.busy = '';
    this.choosing = '';
    this.making = '';
    this.newType = '';
    this.newLabel = '';
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if ((changed.has('api') || changed.has('place')) && this.api) void this.load();
  }

  async load() {
    this.loading = true;
    this.failure = '';
    try {
      if (this.place.page === 'proposal') {
        this.open = undefined;
        this.open = await this.api.proposal(this.place.id);
      } else {
        [this.triage, this.closed] = await Promise.all([this.api.proposals('open'), this.api.proposals('closed')]);
      }
    } catch (err) {
      this.failure = (err as Error).message;
    } finally {
      this.loading = false;
    }
  }

  private move(place: Place) {
    this.dispatchEvent(new CustomEvent('atlas-move', { detail: place, bubbles: true }));
  }

  /** Runs a decision, redrawing from what the service answers, or saying why not beside the item. */
  private async decide(key: string, work: () => Promise<ProposalView>) {
    this.busy = key;
    this.refusal = undefined;
    try {
      this.open = await work();
      this.choosing = '';
      this.making = '';
    } catch (err) {
      this.refusal = { key, message: (err as Error).message };
    } finally {
      this.busy = '';
    }
  }

  private typeLabel(type: string | undefined) {
    return type ? (this.ontology?.types.find((t) => t.key === type)?.label ?? type) : 'Not said';
  }

  private who(createdBy: string) {
    return createdBy === this.userId ? 'you' : 'someone on this floor';
  }

  private sourceTitle(p: { source: ProposalView['source'] }) {
    return p.source.kind === 'document' ? p.source.document.title : p.source.kind === 'other' ? p.source.note : 'Said by hand';
  }

  private listPage() {
    const t = this.triage;
    const row = (p: Triage['proposals'][number]): ListItem => ({
      id: p.id,
      title: this.sourceTitle(p),
      icon: 'document',
      detail: [
        p.state === 'open' ? `${p.decided} of ${p.items} decided` : p.state === 'finished' ? 'Finished' : 'Withdrawn',
        `proposed by ${this.who(p.createdBy)}`,
        p.source.kind === 'document' && p.source.document.version ? `version ${p.source.document.version}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      meta: ago(p.closedAt ?? p.createdAt),
    });
    const where = t ? floorWords(t.floorName) : 'this floor';
    return html`<ui-page-head eyebrow=${t ? `${t.floorName} · Triage` : 'Triage'} heading="What’s waiting to be decided"
        summary=${`Proposals made on ${where}. Nothing is added until a lead decides.`}></ui-page-head>
      ${t?.why ? html`<p class="atlas-note">${t.why}</p>` : nothing}
      <ui-list label="Open proposals" .noun=${['proposal', 'proposals']} .items=${(t?.proposals ?? []).map(row)} ?loading=${this.loading} error=${this.failure}
        empty="Nothing is waiting. Proposals arrive when someone marks a name in a document in Artifacts and chooses Add to Data Atlas."
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => this.move({ page: 'proposal', id: e.detail.item.id })}
        @ui-retry=${() => void this.load()}></ui-list>
      ${this.closed?.proposals.length
        ? html`<ui-list label="Finished and withdrawn" density="compact" .noun=${['proposal', 'proposals']} .items=${this.closed.proposals.map(row)}
            @ui-open=${(e: CustomEvent<{ item: ListItem }>) => this.move({ page: 'proposal', id: e.detail.item.id })}></ui-list>`
        : nothing}`;
  }

  /** The kinds a new entity can be made of for this mention: those under the kind it was said to be, else all. */
  private kindsFor(m: MentionView): SelectOption[] {
    if (!this.ontology) return [];
    const ontology = this.ontology;
    const asked = m.type && ontology.types.some((t) => t.key === m.type) ? m.type : undefined;
    return typeTree(ontology)
      .filter(({ type }) => !type.abstract && (!asked || isA(ontology, type.key, asked)))
      .map(({ type }) => ({ value: type.key, label: type.label }));
  }

  private mentionCard(p: ProposalView, m: MentionView) {
    const can = p.can.decide;
    const why = p.can.why ?? 'Only this floor’s leads decide what’s added.';
    const waiting = this.busy === m.key;
    const refusal = this.refusal?.key === m.key ? this.refusal.message : '';
    const decided = m.decision;
    const outcome = !decided
      ? nothing
      : decided.as === 'drop'
        ? html`<p class="atlas-outcome">Dropped: it isn’t a thing worth keeping.</p>`
        : 'kind' in decided.entity
          ? html`<p class="atlas-outcome">${decided.as === 'new' ? 'Made new: ' : 'It’s '}<ui-ref .ref=${{ kind: 'entity', id: decided.entity.id, label: 'label' in decided.entity ? decided.entity.label : '', ...('type' in decided.entity ? { type: decided.entity.type } : {}) }} @ui-open=${() => this.move({ page: 'entity', id: decided.entity.id })}></ui-ref>
              <span class="atlas-note">${'floorName' in decided.entity ? `· kept on ${floorWords(decided.entity.floorName)}` : ''}</span></p>`
          : html`<p class="atlas-outcome">${'message' in decided.entity ? decided.entity.message : 'It’s no longer there.'}</p>`;
    const kinds = this.kindsFor(m);
    return html`<li class="atlas-card">
      <p class="atlas-said"><strong>“${m.text}”</strong> <span class="atlas-note">${this.typeLabel(m.type)}</span></p>
      ${m.context ? html`<blockquote class="atlas-context">${inContext(m.context, m.text)}</blockquote>` : nothing}
      ${outcome}
      ${decided || p.state !== 'open'
        ? nothing
        : html`${m.matches.length
              ? html`<ul class="atlas-matches">
                  ${m.matches.map(
                    (x) => html`<li class="atlas-choices"><ui-button kind="secondary" size="sm" ?disabled=${!can} reason=${why} ?busy=${waiting} @click=${() => void this.decide(m.key, () => this.api.decideMention(p.id, m.key, { as: 'link', entity: x.entity.id }))}
                      >It’s ${x.entity.label}</ui-button><span class="atlas-note">${matchWhy(x)} · ${floorWords(x.entity.floorName)}</span></li>`,
                  )}
                </ul>`
              : html`<p class="atlas-note">Nothing that shows from here has this name, its keys, or one like it.</p>`}
            <div class="atlas-choices">
              <ui-button kind="ghost" size="sm" ?disabled=${!can} reason=${why} ?busy=${waiting} @click=${() => { this.choosing = this.choosing === m.key ? '' : m.key; this.making = ''; }}>Something else…</ui-button>
              <ui-button kind="ghost" size="sm" ?disabled=${!can || !kinds.length} reason=${!can ? why : 'No kind in the ontology fits it yet.'} ?busy=${waiting} @click=${() => { this.making = this.making === m.key ? '' : m.key; this.choosing = ''; this.newType = kinds[0]?.value ?? ''; this.newLabel = m.text; }}>A new one</ui-button>
              <ui-button kind="ghost" size="sm" ?disabled=${!can} reason=${why} ?busy=${waiting} @click=${() => void this.decide(m.key, () => this.api.decideMention(p.id, m.key, { as: 'drop' }))}>Drop it</ui-button>
            </div>
            ${this.choosing === m.key
              ? html`<atlas-picker .api=${this.api} purpose=${`What “${m.text}” is`} .types=${m.type ? [m.type] : []}
                  @atlas-picked=${(e: CustomEvent<{ entities: EntityRef[] }>) => void this.decide(m.key, () => this.api.decideMention(p.id, m.key, { as: 'link', entity: e.detail.entities[0].id }))}
                  @atlas-cancel=${() => (this.choosing = '')}></atlas-picker>`
              : nothing}
            ${this.making === m.key
              ? html`<div class="atlas-make">
                  <ui-select label="Kind" .options=${kinds} .value=${this.newType} @ui-change=${(e: CustomEvent<{ value: string }>) => (this.newType = e.detail.value)}></ui-select>
                  <ui-text-field label="Name" .value=${this.newLabel} maxlength="200"
                    @ui-input=${(e: CustomEvent<{ value: string }>) => (this.newLabel = e.detail.value)}></ui-text-field>
                  <ui-button kind="primary" size="sm" ?disabled=${!this.newLabel.trim()} reason="Give it a name first." ?busy=${waiting}
                    @click=${() => void this.decide(m.key, () => this.api.decideMention(p.id, m.key, { as: 'new', type: this.newType, label: this.newLabel.trim() }))}>Add it here</ui-button>
                </div>
                <p class="atlas-note">Made on ${floorWords(p.floorName)}. If you change its name, “${m.text}” is kept as another name for it.</p>`
              : nothing}`}
      ${refusal ? html`<p class="atlas-note atlas-refused" role="alert">${refusal}</p>` : nothing}
    </li>`;
  }

  /** What an observation says, in the mentions' words, or the entities they turned out to be. */
  private observationWords(p: ProposalView, o: ProposalObservationView) {
    const name = (key: string) => {
      const m = p.mentions.find((x) => x.key === key);
      if (!m) return key;
      const d = m.decision;
      return d && d.as !== 'drop' && 'label' in d.entity ? d.entity.label : `“${m.text}”`;
    };
    const about = p.mentions.find((x) => x.key === o.about);
    const type = about?.decision && about.decision.as !== 'drop' && 'type' in about.decision.entity ? about.decision.entity.type : (about?.type ?? '');
    const property = propertyLabel(this.ontology, type, o.property);
    return o.target ? `${name(o.about)} · ${property} ${name(o.target)}` : `${name(o.about)} · ${property}: ${o.value}`;
  }

  private observationCard(p: ProposalView, o: ProposalObservationView) {
    const can = p.can.decide && o.ready;
    const why = !p.can.decide ? (p.can.why ?? 'Only this floor’s leads decide what’s added.') : (o.why ?? 'Decide what it names first.');
    const waiting = this.busy === o.key;
    const refusal = this.refusal?.key === o.key ? this.refusal.message : '';
    const decided = o.decision;
    return html`<li class="atlas-card">
      <p class="atlas-said"><strong>${this.observationWords(p, o)}</strong></p>
      <p class="atlas-note">${[o.observedAt ? `Seen ${day(o.observedAt)}` : '', o.grade ? `Graded ${o.grade}` : '', o.note ?? ''].filter(Boolean).join(' · ') || 'As the source says it'}</p>
      ${decided
        ? html`<p class="atlas-outcome">${decided.as === 'accepted' ? 'Accepted as so on this floor.' : decided.as === 'seen' ? 'Kept as seen: an observation, not yet accepted as so.' : 'Dropped.'}</p>`
        : p.state === 'open'
          ? html`<div class="atlas-choices">
              <ui-button kind="secondary" size="sm" ?disabled=${!can} reason=${why} ?busy=${waiting} @click=${() => void this.decide(o.key, () => this.api.decideObservation(p.id, o.key, { as: 'accepted' }))}>Accept as so</ui-button>
              <ui-button kind="ghost" size="sm" ?disabled=${!can} reason=${why} ?busy=${waiting} @click=${() => void this.decide(o.key, () => this.api.decideObservation(p.id, o.key, { as: 'seen' }))}>Keep as seen</ui-button>
              <ui-button kind="ghost" size="sm" ?disabled=${!p.can.decide} reason=${why} ?busy=${waiting} @click=${() => void this.decide(o.key, () => this.api.decideObservation(p.id, o.key, { as: 'drop' }))}>Drop it</ui-button>
            </div>`
          : nothing}
      ${refusal ? html`<p class="atlas-note atlas-refused" role="alert">${refusal}</p>` : nothing}
    </li>`;
  }

  private proposalPage() {
    const back = html`<ui-button kind="ghost" size="sm" @click=${() => this.move({ page: 'triage' })}>Triage</ui-button>`;
    if (this.failure) return html`${back}<ui-state kind="error" heading="Couldn’t open the proposal" body=${this.failure} action="Try again" @ui-action=${() => void this.load()}></ui-state>`;
    const p = this.open;
    if (!p) return html`${back}<ui-state kind="loading" heading="Opening…"></ui-state>`;
    const source = p.source;
    const version = source.kind === 'document' && source.document.version ? `, from version ${source.document.version}` : '';
    const state = p.state === 'finished' ? 'Finished.' : p.state === 'withdrawn' ? 'Withdrawn.' : '';
    return html`${back}
      <div class="atlas-head">
        <ui-page-head eyebrow=${`${p.floorName} · Triage`} heading=${this.sourceTitle(p)}
          summary=${`Proposed by ${this.who(p.createdBy)} ${ago(p.createdAt)}${version}. ${state}`.trim()}></ui-page-head>
        <div class="atlas-actions">
          ${source.kind === 'document'
            ? html`<ui-button kind="secondary" size="sm" @click=${() => this.dispatchEvent(new CustomEvent('atlas-open-document', { detail: { ref: source.document as DocumentRef }, bubbles: true }))}>Open the source</ui-button>`
            : nothing}
          <ui-button kind="primary" size="sm" ?disabled=${!p.can.finish} reason=${p.can.why ?? 'Decide everything it names and says first.'} ?busy=${this.busy === 'finish'} @click=${() => void this.decide('finish', () => this.api.finishProposal(p.id))}>Finish</ui-button>
          <ui-button kind="ghost" size="sm" ?disabled=${!p.can.withdraw} reason=${p.can.why ?? 'Only the person who proposed it can withdraw it.'} ?busy=${this.busy === 'withdraw'} @click=${() => void this.decide('withdraw', () => this.api.withdrawProposal(p.id))}>Withdraw</ui-button>
        </div>
      </div>
      ${p.sourceGone && p.state === 'open' ? html`<p class="atlas-note atlas-refused" role="status">${p.sourceGone} What it names can still be decided; what it says can only be dropped.</p>` : nothing}
      ${this.refusal && ['finish', 'withdraw'].includes(this.refusal.key) ? html`<p class="atlas-note atlas-refused" role="alert">${this.refusal.message}</p>` : nothing}
      <section aria-label="What it names">
        <div class="atlas-head">
          <h2 class="atlas-section">What it names</h2>
          ${p.state === 'open'
            ? html`<ui-button kind="ghost" size="sm" ?disabled=${!p.can.decide || !p.mentions.some((m) => !m.decision)}
                reason=${!p.can.decide ? (p.can.why ?? 'Only this floor’s leads decide what’s added.') : 'Every mention is decided.'}
                ?busy=${this.busy === 'match'} busy-label="Looking…"
                @click=${() => void this.decide('match', () => this.api.matchProposal(p.id))}>Look again</ui-button>`
            : nothing}
        </div>
        ${p.matching ? html`<p class="atlas-note atlas-matching">${matchingWords(p.matching)}</p>` : nothing}
        ${this.refusal?.key === 'match' ? html`<p class="atlas-note atlas-refused" role="alert">${this.refusal.message}</p>` : nothing}
        <ul class="atlas-cards">${p.mentions.map((m) => this.mentionCard(p, m))}</ul>
      </section>
      ${p.observations.length
        ? html`<section aria-label="What it says">
            <h2 class="atlas-section">What it says</h2>
            <ul class="atlas-cards">${p.observations.map((o) => this.observationCard(p, o))}</ul>
          </section>`
        : nothing}
      ${p.terms.length
        ? html`<section aria-label="Words it wanted">
            <h2 class="atlas-section">Words the ontology hasn’t got</h2>
            <ul class="atlas-terms">
              ${p.terms.map((t) => html`<li>${t.name} <span class="atlas-note">${t.kind === 'type' ? `a kind${t.parent ? ` under ${this.typeLabel(t.parent)}` : ''}` : t.kind === 'relation' ? 'a kind of link' : 'a detail'}</span></li>`)}
            </ul>
            <p class="atlas-note">Admins add new words to the ontology. They’re kept here for them; nothing waits on them.</p>
          </section>`
        : nothing}`;
  }

  override render() {
    return html`<style>
        atlas-triage { display: flex; flex-direction: column; gap: var(--space-5); }
        atlas-triage .atlas-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
        atlas-triage .atlas-actions, atlas-triage .atlas-choices { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        atlas-triage .atlas-note { margin: 0; font-size: var(--type-small); color: var(--ink-muted); }
        atlas-triage .atlas-refused { color: var(--danger); }
        atlas-triage .atlas-matching { margin-bottom: var(--space-3); }
        atlas-triage .atlas-matches { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
        atlas-triage .atlas-section { margin: 0 0 var(--space-3); font-size: var(--type-label); font-weight: 400; letter-spacing: var(--tracking-label, 0.2em); text-transform: uppercase; color: var(--ink-muted); }
        atlas-triage .atlas-cards, atlas-triage .atlas-terms { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-3); }
        atlas-triage .atlas-card { background: var(--surface-pane); border-radius: var(--radius-md, 12px); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
        atlas-triage .atlas-said { margin: 0; }
        atlas-triage .atlas-said strong { font-weight: 400; font-size: var(--type-lead, 20px); }
        atlas-triage .atlas-context { margin: 0; padding-left: var(--space-3); border-left: 2px solid var(--hairline-strong); color: var(--ink-muted); }
        atlas-triage .atlas-context mark { background: none; color: var(--ink); text-decoration: underline; text-decoration-color: var(--green); text-underline-offset: 3px; }
        atlas-triage .atlas-outcome { margin: 0; color: var(--ink); }
        atlas-triage .atlas-make { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto; gap: var(--space-3); align-items: end; }
        @media (max-width: 640px) { atlas-triage .atlas-make { grid-template-columns: minmax(0, 1fr); } }
      </style>
      ${this.place.page === 'proposal' ? this.proposalPage() : this.listPage()}`;
  }
}

if (!customElements.get('atlas-triage')) customElements.define('atlas-triage', AtlasTriage);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-triage': AtlasTriage;
  }
}
