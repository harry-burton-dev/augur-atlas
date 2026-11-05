import { useEffect, useMemo } from 'react';
import { defineReactApp, type PickerProps } from '@augur/app-kit';
import { ENTITY_EXPLAIN, ENTITY_OPEN, ENTITY_PICK, ENTITY_PROPOSE, isEntityRef, type EntityPick, type EntityProposal, type Intent, type MountContext } from '@augur/mfe-sdk';
import manifest from '../../manifest.json';
import { pathFor, type Place } from './api.js';
import { App, apiFor, places } from './app.js';
import { Picker } from './picker.js';
import { Propose } from './propose.js';
import styles from './styles.css?inline';

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

/** Says no to a request Data Atlas can't read, before drawing anything. */
function Refuse({ cancel }: { cancel: () => void }) {
  useEffect(() => cancel(), [cancel]);
  return null;
}

/**
 * What another app asks of Data Atlas: entities picked (`entity.pick`), opening over it as a picker,
 * or words that name a thing filed in Triage (`entity.propose`).
 */
function Requests({ ctx, intent, respond, cancel }: PickerProps<MountContext>) {
  const api = useMemo(() => apiFor(ctx), [ctx]);
  if (intent.type === ENTITY_PICK) {
    const pick = (intent.payload ?? {}) as EntityPick;
    const multiple = pick.multiple === true;
    return (
      <div className="atlas-over">
        <Picker
          api={api}
          purpose={typeof pick.purpose === 'string' ? pick.purpose : ''}
          types={Array.isArray(pick.types) ? pick.types.filter((t) => typeof t === 'string') : []}
          multiple={multiple}
          floorName={ctx.workspace.name}
          onPicked={(entities) => respond(multiple ? entities : entities[0])}
          onCancel={cancel}
        />
      </div>
    );
  }
  const offer = proposalOffer(intent as Intent);
  if (!offer) return <Refuse cancel={cancel} />;
  return (
    <div className="atlas-over">
      <Propose api={api} offer={offer} floorName={ctx.workspace.name} onProposed={respond} onCancel={cancel} />
    </div>
  );
}

const startAt = (payload: unknown, type: string) => {
  const at = placeForIntent({ type, payload });
  return at ? pathFor(at) : undefined;
};

/** Data Atlas: the things the organisation knows about. What the shell mounts at its route. */
export default defineReactApp<MountContext>({
  name: manifest.name,
  App,
  routes: places,
  intents: {
    [ENTITY_OPEN]: (payload) => startAt(payload, ENTITY_OPEN),
    [ENTITY_EXPLAIN]: (payload) => startAt(payload, ENTITY_EXPLAIN),
  },
  Picker: Requests,
  styles,
});
