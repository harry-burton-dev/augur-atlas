import type { DomainEvent } from '@augur/service-kit';
import type { PgAtlasStore } from './store.ts';

/**
 * What Data Atlas follows of other apps (spec, "Shared entity reference", AT8):
 * Mandate's and Artifacts' entity bindings (ADR 0025), for each entity's
 * "used by", and Artifacts' withdrawals, which retract what was read from a
 * document. Theirs stays the truth: this
 * only keeps an index and marks evidence, and never deletes an entity.
 */
export const FOLLOWED = ['mandate.intent.entity-bound', 'mandate.intent.entity-unbound', 'folio.record.entity-bound', 'folio.record.entity-unbound', 'folio.document.withdrawn', 'folio.document.deleted'];

const text = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

/** Handles one event. Safe to run twice: the same event may come again after a failure. */
export const follower = (store: PgAtlasStore) => async (event: Pick<DomainEvent, 'topic' | 'payload' | 'workspace'>) => {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.topic) {
    case 'mandate.intent.entity-bound':
    case 'mandate.intent.entity-unbound': {
      const intent = text(p.intent);
      const entity = text(p.entity);
      if (!intent || !entity) return;
      const role = text(p.role);
      if (event.topic === 'mandate.intent.entity-bound') await store.bind({ app: 'mandate', kind: 'intent', id: intent, entity, role: role ?? 'related', workspace: event.workspace?.id ?? '' });
      else await store.unbind({ app: 'mandate', kind: 'intent', id: intent, entity, ...(role ? { role } : {}) });
      return;
    }
    case 'folio.record.entity-bound':
    case 'folio.record.entity-unbound': {
      // A library, folder or document, as Artifacts names it in a link (`<library>/<record>`), kept by its level.
      const record = text(p.record);
      const entity = text(p.entity);
      const level = text(p.level);
      if (!record || !entity || !level) return;
      const role = text(p.role);
      if (event.topic === 'folio.record.entity-bound') await store.bind({ app: 'folio', kind: level, id: record, entity, role: role ?? 'about', workspace: event.workspace?.id ?? '' });
      else await store.unbind({ app: 'folio', kind: level, id: record, entity, ...(role ? { role } : {}) });
      return;
    }
    case 'folio.document.withdrawn':
    case 'folio.document.deleted': {
      const document = text(p.document);
      if (!document) return;
      const why = event.topic.endsWith('withdrawn') ? 'Its source was withdrawn in Artifacts.' : 'Its source was deleted from Artifacts.';
      await store.retractDocument('folio', document, why);
      return;
    }
  }
};
