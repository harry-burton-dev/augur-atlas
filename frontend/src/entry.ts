import { ENTITY_EXPLAIN, ENTITY_OPEN, ENTITY_PICK, ENTITY_PROPOSE, defineMicroFrontend, isEntityRef, openDocument, pickDocument, type EntityPick, type EntityProposal, type EntityRef, type Intent, type MountContext, type ProposalReceipt } from '@augur/mfe-sdk';
import { html, render } from 'lit';
import '@augur/ui-kit';
import { AtlasApi, pathFor, placeFor, type Place } from './api.js';
import './atlas-app.js';
import './atlas-picker.js';
import './atlas-propose.js';

/** Mandate's intent for opening an intent (docs/mandate.md). */
const AIM_OPEN = 'aim.open';

/**
 * Where Data Atlas is in the address bar, so a place in it can be shared, and
 * Back goes to the last one: the shell mounts it again with that path.
 */
export const addressFor = (pathname: string, mountedAt: string, place: Place) => {
  const inner = mountedAt === '/' ? '' : mountedAt;
  if (!pathname.endsWith(inner)) return undefined;
  return `${pathname.slice(0, pathname.length - inner.length)}${pathFor(place)}`;
};

/** Where an intent asks Data Atlas to start: `entity.open` at the entity, `entity.explain` at it with why it shows marked. */
export const placeForIntent = (intent: Intent | undefined): Place | undefined => {
  if ((intent?.type !== ENTITY_OPEN && intent?.type !== ENTITY_EXPLAIN) || !isEntityRef(intent.payload)) return undefined;
  return { page: 'entity', id: intent.payload.id, ...(intent.type === ENTITY_EXPLAIN ? { explain: true } : {}) };
};

/** What another app offered with `entity.propose`, if it's well formed. */
export const proposalOffer = (intent: Intent | undefined): EntityProposal | undefined => {
  if (!intent || intent.type !== ENTITY_PROPOSE) return undefined;
  const p = intent.payload as Partial<EntityProposal> | undefined;
  const src = p?.source as Partial<EntityProposal['source']> | undefined;
  if (!p || typeof p.text !== 'string' || !p.text.trim() || !src || typeof src.app !== 'string' || typeof src.id !== 'string' || typeof src.title !== 'string') return undefined;
  return p as EntityProposal;
};

/** Data Atlas: the things the organisation knows about. What the shell mounts at /atlas. */
export default defineMicroFrontend({
  mount(el: HTMLElement, ctx: MountContext) {
    // Another app asked for entities: Data Atlas opens over it as a picker, and answers with what's chosen.
    if (ctx.intent?.type === ENTITY_PICK && ctx.reply) {
      const reply = ctx.reply;
      const pick = (ctx.intent.payload ?? {}) as EntityPick;
      const multiple = pick.multiple === true;
      render(
        html`<atlas-picker
          .api=${new AtlasApi((path, init) => ctx.fetch(path, init))}
          purpose=${typeof pick.purpose === 'string' ? pick.purpose : ''}
          .types=${Array.isArray(pick.types) ? pick.types.filter((t) => typeof t === 'string') : []}
          ?multiple=${multiple}
          floor-name=${ctx.workspace.name}
          @atlas-picked=${(e: CustomEvent<{ entities: EntityRef[] }>) => reply.respond(multiple ? e.detail.entities : e.detail.entities[0])}
          @atlas-cancel=${() => reply.cancel()}
        ></atlas-picker>`,
        el,
      );
      return;
    }
    // Another app offered words that name a thing: Data Atlas asks what kind, and files it in Triage.
    if (ctx.intent?.type === ENTITY_PROPOSE && ctx.reply) {
      const reply = ctx.reply;
      const offer = proposalOffer(ctx.intent);
      if (!offer) {
        reply.cancel();
        return;
      }
      render(
        html`<atlas-propose
          .api=${new AtlasApi((path, init) => ctx.fetch(path, init))}
          .offer=${offer}
          floor-name=${ctx.workspace.name}
          @atlas-proposed=${(e: CustomEvent<ProposalReceipt>) => reply.respond(e.detail)}
          @atlas-cancel=${() => reply.cancel()}
        ></atlas-propose>`,
        el,
      );
      return;
    }
    let mountedAt = ctx.path;
    const moved = (e: CustomEvent<Place>) => {
      const to = addressFor(window.location.pathname, mountedAt, e.detail);
      if (!to || to === window.location.pathname) return;
      window.history.pushState(window.history.state, '', to);
      mountedAt = pathFor(e.detail);
    };
    render(
      html`<atlas-app
        .api=${new AtlasApi((path, init) => ctx.fetch(path, init))}
        floor-name=${ctx.workspace.name}
        floor-kind=${ctx.workspace.kind}
        .place=${placeForIntent(ctx.intent) ?? placeFor(ctx.path)}
        user-id=${ctx.user.id}
        .pickDocument=${() => pickDocument(ctx, { purpose: 'Where it was read' })}
        .openDocument=${(ref: Parameters<typeof openDocument>[1]) => void openDocument(ctx, ref)}
        .openIntent=${(id: string) => void ctx.raise({ type: AIM_OPEN, payload: { id } })}
        @atlas-place=${moved}
      ></atlas-app>`,
      el,
    );
  },
  unmount(el: HTMLElement) {
    render(html``, el);
  },
});
