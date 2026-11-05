import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, Heading, List, Select, TextField, relativeTime, type DialogSubmit, type ListItem, type SelectOption } from '@augur/app-kit';
import { floorWords, type AtlasApi, type Entity, type EntityRaises, type RaiseList, type RaiseView } from './api.js';

/** Where a request stands, in words. */
const stateLine = (r: RaiseView) => {
  if (r.state === 'waiting') return `Waiting for ${r.toName}’s leads, asked ${relativeTime(r.askedAt)}`;
  if (r.state === 'kept') return `Kept on ${r.toName} ${relativeTime(r.decidedAt ?? r.askedAt)}`;
  if (r.state === 'merged') return `${r.toName} already had it: merged ${relativeTime(r.decidedAt ?? r.askedAt)}`;
  if (r.state === 'declined') return `${r.toName} declined ${relativeTime(r.decidedAt ?? r.askedAt)}${r.answer ? `: “${r.answer}”` : ''}`;
  return `Withdrawn ${relativeTime(r.decidedAt ?? r.askedAt)}`;
};

export interface RaiseCardProps {
  api: AtlasApi;
  entity: Entity;
}

/**
 * On the entity page (PER-326): ask a floor above to keep the card there, and
 * what came of asking. Only the card goes up; what's known of it stays on the
 * floors it was recorded on. Who can't ask sees the button, and why.
 */
export function RaiseCard({ api, entity }: RaiseCardProps) {
  const [raises, setRaises] = useState<EntityRaises>();
  const [failure, setFailure] = useState('');
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    setFailure('');
    try {
      const got = await api.entityRaises(entity.id);
      setRaises({ ...got, to: Array.isArray(got.to) ? got.to : [], raises: Array.isArray(got.raises) ? got.raises : [] });
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api, entity.id]);
  useEffect(() => void load(), [load]);

  if (failure) return <p className="atlas-note">{`Couldn’t say whether it can be raised: ${failure}`}</p>;
  if (!raises) return null;
  // Kept on the org floor, with nothing ever asked: there's nowhere to raise it and nothing to say.
  if (!raises.to.length && !raises.raises.length) return null;
  const items: ListItem[] = raises.raises.map((r) => ({
    id: r.id,
    title: `Asked to keep it on ${r.toName}`,
    detail: [stateLine(r), r.note ? `“${r.note}”` : ''].filter(Boolean).join(' · '),
    status: r.state === 'waiting' ? 'queued' : r.state === 'declined' ? 'warning' : 'done',
    ...(r.can.withdraw ? { actions: [{ id: 'withdraw', label: 'Withdraw' }] } : {}),
  }));
  const options: SelectOption[] = raises.to.map((t) => ({ value: t.floor, label: t.name }));
  const submit: DialogSubmit = async (values) => {
    if (!values.to) throw new Error('Choose the floor to ask.');
    await api.askRaise(entity.id, values.to, values.note ?? '');
    setAsking(false);
    await load();
  };

  return (
    <section className="atlas-section atlas-raise">
      <Heading
        size="s"
        level={2}
        heading="Floors above"
        summary={`It’s kept on ${floorWords(entity.floorName)}. A floor above can keep it instead, so its people see it too; what’s known of it stays where it was recorded.`}
      />
      <Button kind="secondary" disabled={!raises.ask} reason={raises.why} onClick={() => setAsking(true)}>
        Ask a floor above to keep it…
      </Button>
      {items.length ? (
        <List
          label="Asked"
          density="compact"
          noun={['request', 'requests']}
          items={items}
          onAction={(item, action) =>
            action.id === 'withdraw' &&
            void api
              .withdrawRaise(item.id)
              .then(load)
              .catch((err: Error) => setFailure(err.message))
          }
        />
      ) : null}
      {asking ? (
        <Dialog
          open
          onClose={() => setAsking(false)}
          eyebrow={`Kept on ${floorWords(entity.floorName)}`}
          heading={`Ask a floor above to keep ${entity.label}`}
          summary="Its leads decide: they keep it, say it’s one they already have, or decline with a note."
          actionLabel="Ask"
          busyLabel="Asking…"
          onSubmit={submit}
          fields={
            <>
              <Select name="to" label="Floor" options={options} defaultValue={options[0]?.value ?? null} />
              <TextField name="note" label="Why it belongs there" optional multiline maxLength={2000} />
            </>
          }
        />
      ) : null}
    </section>
  );
}

export interface RaisesWaitingProps {
  api: AtlasApi;
  /** Opens an entity kept on this floor. */
  onOpenEntity: (id: string) => void;
}

/**
 * In Triage (PER-326): entity cards a floor below asks this floor to keep.
 * Its leads keep one, say it's one this floor already has (merging the two),
 * or decline with a note for whoever asked.
 */
export function RaisesWaiting({ api, onOpenEntity }: RaisesWaitingProps) {
  const [list, setList] = useState<RaiseList>();
  const [failure, setFailure] = useState('');
  const [answering, setAnswering] = useState<RaiseView>();
  const [same, setSame] = useState<SelectOption[]>([]);

  const load = useCallback(async () => {
    setFailure('');
    try {
      const got = await api.raises('waiting');
      setList({ ...got, raises: Array.isArray(got.raises) ? got.raises : [] });
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  const answer = async (r: RaiseView) => {
    setAnswering(r);
    // What this floor already keeps by that name, to say it's the same as one of them.
    const found = await api.entities({ q: r.card.label, type: r.card.type, limit: 20 }).catch(() => undefined);
    setSame((found?.entities ?? []).filter((e) => e.id !== r.entity && e.state === 'active').map((e) => ({ value: e.id, label: e.label, detail: floorWords(e.floorName) })));
  };

  if (!failure && !list?.raises.length) return null;
  const items: ListItem[] = (list?.raises ?? []).map((r) => {
    const shut = r.can.decide ? {} : { disabled: true, reason: r.can.why ?? 'Only this floor’s leads decide what is kept here.' };
    return {
      id: r.id,
      title: r.card.label,
      detail: [`From ${r.fromName}`, `asked ${relativeTime(r.askedAt)}`, r.note ? `“${r.note}”` : ''].filter(Boolean).join(' · '),
      icon: 'publish',
      actions: [
        { id: 'keep', label: 'Keep it here', ...shut },
        { id: 'answer', label: 'Other answer…', ...shut },
      ],
    };
  });
  const submit: DialogSubmit = async (values) => {
    if (!answering) return false;
    const note = (values.note ?? '').trim();
    if (values.entity) await api.decideRaise(answering.id, { as: 'same', entity: values.entity, why: note || 'The same thing, already kept here' });
    else if (!note) throw new Error('Say why it isn’t kept here, so whoever asked knows; or choose the one it’s the same as.');
    else await api.decideRaise(answering.id, { as: 'decline', note });
    setAnswering(undefined);
    await load();
  };

  return (
    <section className="atlas-section atlas-raises-waiting">
      <List
        label="Asked to keep here"
        noun={['card', 'cards']}
        items={items}
        error={failure}
        onRetry={() => void load()}
        onAction={(item, action) => {
          const r = list?.raises.find((x) => x.id === item.id);
          if (!r) return;
          if (action.id === 'answer') void answer(r);
          else
            void api
              .decideRaise(r.id, { as: 'keep' })
              .then(async () => {
                await load();
                onOpenEntity(r.entity);
              })
              .catch((err: Error) => setFailure(err.message));
        }}
      />
      {answering ? (
        <Dialog
          open
          onClose={() => setAnswering(undefined)}
          eyebrow={`From ${answering.fromName}`}
          heading={`Not as it is: ${answering.card.label}`}
          summary="Say it’s one this floor already keeps, and the two are merged here; or decline, saying why."
          actionLabel="Send"
          busyLabel="Sending…"
          onSubmit={submit}
          fields={
            <>
              <Select name="entity" label="It’s the same as" options={same} placeholder="None: decline it" empty="Nothing kept here by that name." />
              <TextField name="note" label="Why" optional multiline maxLength={2000} />
            </>
          }
        />
      ) : null}
    </section>
  );
}
