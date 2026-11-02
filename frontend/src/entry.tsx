import { ENTITY_EXPLAIN, ENTITY_OPEN, ENTITY_PICK, ENTITY_PROPOSE, defineMicroFrontend, isEntityRef, openDocument, pickDocument, type EntityPick, type EntityProposal, type Intent, type MountContext } from '@augur/mfe-sdk';
import { createRoot, type Root } from 'react-dom/client';
import { AtlasApi, pathFor, placeFor, type Place } from './api.js';
import { AtlasApp } from './app.js';
import { Picker } from './picker.js';
import { Propose } from './propose.js';
import styles from './styles.css?inline';

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

const apiFor = (ctx: MountContext) => new AtlasApi((path, init) => ctx.fetch(path, init));

const roots = new WeakMap<HTMLElement, Root>();
const STYLE_ID = 'augur-atlas-styles';

/** A React root in `el`, with Data Atlas's stylesheet on the page once. */
const rootIn = (el: HTMLElement) => {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = styles;
    document.head.append(style);
  }
  const root = createRoot(el);
  roots.set(el, root);
  return root;
};

/** Data Atlas: the things the organisation knows about. What the shell mounts at /atlas. */
export default defineMicroFrontend({
  mount(el: HTMLElement, ctx: MountContext) {
    // Another app offered words that name a thing, and the offer can't be read: say no before drawing anything.
    if (ctx.intent?.type === ENTITY_PROPOSE && ctx.reply && !proposalOffer(ctx.intent)) {
      ctx.reply.cancel();
      return;
    }
    const root = rootIn(el);
    // Another app asked for entities: Data Atlas opens over it as a picker, and answers with what's chosen.
    if (ctx.intent?.type === ENTITY_PICK && ctx.reply) {
      const reply = ctx.reply;
      const pick = (ctx.intent.payload ?? {}) as EntityPick;
      const multiple = pick.multiple === true;
      root.render(
        <div className="atlas-over">
          <Picker
            api={apiFor(ctx)}
            purpose={typeof pick.purpose === 'string' ? pick.purpose : ''}
            types={Array.isArray(pick.types) ? pick.types.filter((t) => typeof t === 'string') : []}
            multiple={multiple}
            floorName={ctx.workspace.name}
            onPicked={(entities) => reply.respond(multiple ? entities : entities[0])}
            onCancel={() => reply.cancel()}
          />
        </div>,
      );
      return;
    }
    // Another app offered words that name a thing: Data Atlas asks what kind, and files it in Triage.
    const offer = proposalOffer(ctx.intent);
    if (offer && ctx.reply) {
      const reply = ctx.reply;
      root.render(
        <div className="atlas-over">
          <Propose api={apiFor(ctx)} offer={offer} floorName={ctx.workspace.name} onProposed={(receipt) => reply.respond(receipt)} onCancel={() => reply.cancel()} />
        </div>,
      );
      return;
    }
    let mountedAt = ctx.path;
    const moved = (place: Place) => {
      const to = addressFor(window.location.pathname, mountedAt, place);
      if (!to || to === window.location.pathname) return;
      window.history.pushState(window.history.state, '', to);
      mountedAt = pathFor(place);
    };
    root.render(
      <AtlasApp
        api={apiFor(ctx)}
        floorName={ctx.workspace.name}
        floorKind={ctx.workspace.kind}
        place={placeForIntent(ctx.intent) ?? placeFor(ctx.path)}
        userId={ctx.user.id}
        pickDocument={() => pickDocument(ctx, { purpose: 'Where it was read' })}
        openDocument={(ref) => void openDocument(ctx, ref)}
        openIntent={(id) => void ctx.raise({ type: AIM_OPEN, payload: { id } })}
        onPlace={moved}
      />,
    );
  },
  unmount(el: HTMLElement) {
    roots.get(el)?.unmount();
    roots.delete(el);
  },
});
