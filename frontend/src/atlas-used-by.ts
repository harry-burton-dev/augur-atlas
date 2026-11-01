import { LitElement, html, nothing } from 'lit';
import { ago, type ListItem } from '@augur/ui-kit';
import type { AtlasApi, IntentName, UsedBy } from './api.js';

const ROLE: Record<string, string> = { subject: 'its subject', resource: 'a resource', area: 'its area', related: 'related' };

/**
 * What uses an entity: intents bound to it in Mandate, named by Mandate as the
 * person (one they can't open still shows, saying where it's kept), and the
 * documents what's known of it came from. Nothing is hidden for being out of
 * reach: it says why.
 *
 * @fires atlas-open-intent - detail `{ id }`
 * @fires atlas-open-document - detail `{ ref }`
 */
export class AtlasUsedBy extends LitElement {
  static override properties = {
    api: { attribute: false },
    entity: { type: String },
    used: { state: true },
    names: { state: true },
    unnamed: { state: true },
    failure: { state: true },
  };

  declare api: AtlasApi;
  declare entity: string;
  declare used: UsedBy | undefined;
  declare names: Map<string, IntentName>;
  /** Why the intents couldn't be named, when Mandate couldn't be asked. */
  declare unnamed: string;
  declare failure: string;

  constructor() {
    super();
    this.entity = '';
    this.names = new Map();
    this.unnamed = '';
    this.failure = '';
  }

  override createRenderRoot() {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if ((changed.has('api') || changed.has('entity')) && this.api && this.entity) void this.load();
  }

  async load() {
    this.failure = '';
    this.unnamed = '';
    try {
      this.used = await this.api.usedBy(this.entity);
      const ids = [...new Set(this.used.intents.map((i) => i.id))];
      if (ids.length) {
        try {
          this.names = new Map((await this.api.nameIntents(ids)).map((n) => [n.id, n]));
        } catch (err) {
          this.unnamed = (err as Error).message;
        }
      }
    } catch (err) {
      this.failure = (err as Error).message;
    }
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  override render() {
    const u = this.used;
    const intents: ListItem[] = (u?.intents ?? []).map((i) => {
      const n = this.names.get(i.id);
      const open = !!n?.canOpen;
      return {
        id: i.id,
        title: open ? (n?.label ?? 'An intent') : 'An intent you can’t open',
        detail: [`Intent · ${ROLE[i.role] ?? i.role}`, open ? '' : i.floorName ? `kept on ${i.floorName}, ask its lead` : 'ask whoever leads its floor', `bound ${ago(i.since)}`].filter(Boolean).join(' · '),
        icon: 'compass',
        ...(open ? {} : { disabled: true }),
      };
    });
    const documents: ListItem[] = (u?.documents ?? []).map((d) => ({
      id: `${d.app}:${d.id}`,
      title: d.title,
      detail: [`${d.observations === 1 ? 'One observation' : `${d.observations} observations`} from it`, d.withdrawn ? 'since withdrawn' : '', `latest ${ago(d.lastAt)}`].filter(Boolean).join(' · '),
      icon: 'document',
      ...(d.withdrawn ? { status: 'warning' as const } : {}),
    }));
    return html`<ui-heading size="s" level="2" heading="Used by" summary="Intents bound to it, and documents what’s known of it came from. Each app decides what you can open."></ui-heading>
      ${this.unnamed ? html`<p class="atlas-note">${u?.intents.length === 1 ? 'One intent uses' : `${u?.intents.length} intents use`} it. ${this.unnamed}</p>` : nothing}
      <ui-list label="Intents" density="compact" .noun=${['intent', 'intents']} .items=${this.unnamed ? [] : intents} ?loading=${!u && !this.failure} error=${this.failure}
        empty=${this.unnamed ? 'Not named here.' : 'No intent is bound to it. In Mandate, an intent binds entities as its subject, resources or area.'}
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => this.names.get(e.detail.item.id)?.canOpen && this.emit('atlas-open-intent', { id: e.detail.item.id })}
        @ui-retry=${() => void this.load()}></ui-list>
      <ui-list label="Mentioned in" density="compact" .noun=${['document', 'documents']} .items=${documents} ?loading=${!u && !this.failure}
        empty="Nothing known of it here came from a document yet."
        @ui-open=${(e: CustomEvent<{ item: ListItem }>) => {
          const d = u?.documents.find((x) => `${x.app}:${x.id}` === e.detail.item.id);
          if (d) this.emit('atlas-open-document', { ref: { app: d.app, id: d.id, title: d.title } });
        }}></ui-list>`;
  }
}

if (!customElements.get('atlas-used-by')) customElements.define('atlas-used-by', AtlasUsedBy);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-used-by': AtlasUsedBy;
  }
}
