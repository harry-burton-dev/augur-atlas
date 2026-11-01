import { LitElement, html, nothing } from 'lit';
import type { SelectOption } from '@augur/ui-kit';
import type { EntityProposal, ProposalReceipt } from '@augur/mfe-sdk';
import { floorWords, typeTree, type AtlasApi, type Ontology } from './api.js';

/**
 * Data Atlas answering `entity.propose` for another app: someone marked words
 * in a document that name a thing. It asks what kind of thing, and files a
 * one-mention proposal in this floor's Triage, where its leads decide whether
 * it's something already known, a new one, or nothing. Nothing is added to
 * what's known until they do, and the form says so.
 *
 * @fires atlas-proposed - detail is the ProposalReceipt
 * @fires atlas-cancel - the person closed it
 */
export class AtlasPropose extends LitElement {
  static override properties = {
    api: { attribute: false },
    offer: { attribute: false },
    floorName: { type: String, attribute: 'floor-name' },
    ontology: { state: true },
    type: { state: true },
    busy: { state: true },
    failure: { state: true },
  };

  declare api: AtlasApi;
  declare offer: EntityProposal;
  declare floorName: string;
  declare ontology: Ontology | undefined;
  /** The kind chosen; empty for "not sure". */
  declare type: string;
  declare busy: boolean;
  declare failure: string;

  constructor() {
    super();
    this.floorName = '';
    this.type = '';
    this.busy = false;
    this.failure = '';
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('api') && this.api) {
      void this.api
        .ontology()
        .then((o) => {
          this.ontology = o;
          if (this.offer.type && o.types.some((t) => t.key === this.offer.type)) this.type = this.offer.type;
        })
        .catch((err: Error) => (this.failure = err.message));
    }
  }

  private async send() {
    this.busy = true;
    this.failure = '';
    try {
      const { source, anchor, text, context } = this.offer;
      const made = await this.api.propose({
        source: { kind: 'document', document: source, ...(anchor ? { anchor } : {}) },
        mentions: [{ key: 'm1', text, ...(this.type ? { type: this.type } : {}), ...(anchor ? { anchor } : {}), ...(context ? { context } : {}) }],
      });
      const receipt: ProposalReceipt = { proposal: made.id, queue: `${floorWords(made.queue)}’s Triage` };
      this.dispatchEvent(new CustomEvent('atlas-proposed', { detail: receipt, bubbles: true }));
    } catch (err) {
      this.failure = (err as Error).message;
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const kinds: SelectOption[] = [
      { value: '', label: 'Not sure: the leads decide' },
      ...(this.ontology ? typeTree(this.ontology).map(({ type, depth }) => ({ value: type.key, label: `${'  '.repeat(depth)}${type.abstract ? `Some kind of ${type.label.toLowerCase()}` : type.label}` })) : []),
    ];
    const where = this.floorName ? floorWords(this.floorName) : 'this floor';
    const { text, context, source } = this.offer;
    return html`<style>
        atlas-propose { display: flex; flex-direction: column; gap: var(--space-5); min-width: min(36rem, 100%); }
        atlas-propose .atlas-note { margin: 0; font-size: var(--type-small); color: var(--ink-muted); }
        atlas-propose .atlas-refused { color: var(--danger); }
        atlas-propose blockquote { margin: 0; padding-left: var(--space-3); border-left: 2px solid var(--hairline-strong); color: var(--ink-muted); }
        atlas-propose .atlas-words { margin: 0; font-size: var(--type-lead, 20px); }
        atlas-propose .atlas-actions { display: flex; gap: var(--space-2); justify-content: flex-end; }
      </style>
      <ui-heading eyebrow="Add to Data Atlas" heading="What does it name?" summary=${`From ${source.title}. It goes to ${where}’s Triage, where its leads decide whether it’s something already known, a new one, or nothing. Nothing is added until they do.`}></ui-heading>
      <p class="atlas-words">“${text}”</p>
      ${context && context !== text ? html`<blockquote>${context}</blockquote>` : nothing}
      <ui-select label="What kind of thing it is" .options=${kinds} .value=${this.type} @ui-change=${(e: CustomEvent<{ value: string }>) => (this.type = e.detail.value)}></ui-select>
      ${this.failure ? html`<p class="atlas-note atlas-refused" role="alert">${this.failure}</p>` : nothing}
      <div class="atlas-actions">
        <ui-button kind="ghost" size="sm" @click=${() => this.dispatchEvent(new CustomEvent('atlas-cancel', { bubbles: true }))}>Cancel</ui-button>
        <ui-button kind="primary" size="sm" ?busy=${this.busy} busy-label="Sending…" @click=${() => void this.send()}>Send to Triage</ui-button>
      </div>`;
  }
}

if (!customElements.get('atlas-propose')) customElements.define('atlas-propose', AtlasPropose);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-propose': AtlasPropose;
  }
}
