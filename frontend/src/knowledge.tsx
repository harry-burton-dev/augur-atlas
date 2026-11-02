import { useCallback, useEffect, useState } from 'react';
import { isIntentCancelled, type DocumentRef } from '@augur/mfe-sdk';
import { Button, DateField, Details, Dialog, Heading, List, Select, TextField, relativeTime, type DialogSubmit, type ListItem, type SelectOption } from '@augur/app-kit';
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
  type Knowledge as Known,
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
const startOf = (date: string | undefined) => (date ? `${date}T00:00:00.000Z` : undefined);
/** A date from an "as of" field, as the end of that day, so the whole day counts. */
const endOf = (date: string) => (date ? `${date}T23:59:59.999Z` : undefined);

export interface KnowledgeProps {
  api: AtlasApi;
  entity: Entity;
  ontology: Ontology;
  /** Asks the person for a document (the SDK's pickDocument), when an app that keeps them is there. */
  pickDocument?: () => Promise<DocumentRef>;
  /** Opens the entity at a link's other end. */
  onOpenEntity: (id: string) => void;
}

/**
 * What is known about one entity, as seen from the floor the person stands on:
 * the facts floors hold (each saying which floor holds it, so a team's working
 * view sits beside the org's confirmed record), links to other entities both
 * ways, and the observations behind them. "As of" and "as known on" move the
 * two clocks. Whatever can't be done says why, rather than vanishing.
 */
export function Knowledge({ api, entity, ontology, pickDocument, onOpenEntity }: KnowledgeProps) {
  const [knowledge, setKnowledge] = useState<Known>();
  /** The valid clock: what was true on this day. Blank for now. */
  const [at, setAt] = useState('');
  /** The recorded clock: what was on record on this day. Blank for now. */
  const [known, setKnown] = useState('');
  const [failure, setFailure] = useState('');
  const [panel, setPanel] = useState<Panel>();
  /** The detail or link being observed. */
  const [property, setProperty] = useState('');
  /** Entities a link being observed may point at. */
  const [targets, setTargets] = useState<SelectOption[]>([]);
  const [sourceKind, setSourceKind] = useState<Source['kind']>('person');
  const [document, setDocument] = useState<DocumentRef>();

  const load = useCallback(async () => {
    setFailure('');
    try {
      setKnowledge(await api.knowledge(entity.id, { at: endOf(at), known: endOf(known) }));
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api, entity.id, at, known]);
  useEffect(() => void load(), [load]);

  const says = (x: FactView | ObservationView) => saying(ontology, entity.type, x);
  const properties = propertiesOf(ontology, entity.type);

  /** Picks what to observe; a link loads the entities it may point at that show from here. */
  const choose = async (key: string) => {
    setProperty(key);
    setTargets([]);
    const link = properties.find((p) => p.key === key)?.link;
    if (!link) return;
    try {
      const { entities } = await api.entities({ type: link.to, limit: 200 });
      setTargets(entities.filter((e) => e.id !== entity.id).map((e) => ({ value: e.id, label: `${e.label} (${e.floorName})` })));
    } catch (err) {
      setFailure((err as Error).message);
    }
  };

  const askForDocument = async () => {
    if (!pickDocument) return;
    try {
      setDocument(await pickDocument());
    } catch (err) {
      // Closed without picking is nothing to say; anything else is.
      if (!isIntentCancelled(err)) setFailure((err as Error).message);
    }
  };

  const observe = () => {
    setPanel({ kind: 'observe' });
    setDocument(undefined);
    setSourceKind('person');
    void choose(properties[0]?.key ?? '');
  };

  const done = async () => {
    setPanel(undefined);
    await load();
  };

  const submitObserve: DialogSubmit = async (values) => {
    const link = properties.find((p) => p.key === property)?.link;
    const source: Source | undefined =
      sourceKind === 'person'
        ? { kind: 'person' }
        : sourceKind === 'document'
          ? document && { kind: 'document', document: { app: document.app, id: document.id, title: document.title, ...(document.version ? { version: document.version } : {}) } }
          : { kind: 'other', note: values.sourceNote ?? '' };
    if (!source) throw new Error('Pick the document it came from, or say it came from somewhere else.');
    const grade = values.reliability && values.credibility ? `${values.reliability}${values.credibility}` : undefined;
    if ((values.reliability || values.credibility) && !grade) throw new Error('A grade has both parts: how reliable the source is, and how credible what it says is.');
    await api.observe(entity.id, {
      property,
      ...(link ? { target: values.target } : { value: values.value }),
      ...(values.observedAt ? { observedAt: startOf(values.observedAt) } : {}),
      source,
      ...(grade ? { grade } : {}),
      ...(values.note?.trim() ? { note: values.note } : {}),
      ...(values.accept === 'yes' ? { accept: true } : {}),
    });
    await done();
  };
  const submitAccept: DialogSubmit = async (values) => {
    if (panel?.kind !== 'accept') return false as const;
    await api.acceptFact(entity.id, {
      backedBy: [panel.observation.id],
      ...(values.validFrom ? { validFrom: startOf(values.validFrom) } : {}),
      ...(values.validTo ? { validTo: startOf(values.validTo) } : {}),
      ...(values.note?.trim() ? { note: values.note } : {}),
    });
    await done();
  };
  const submitRaise: DialogSubmit = async (values) => {
    if (panel?.kind !== 'raise') return false as const;
    await api.raise(panel.observation.id, values.to);
    await done();
  };
  const submitEnd: DialogSubmit = async (values) => {
    if (panel?.kind !== 'end') return false as const;
    await api.endFact(panel.fact.id, startOf(values.validTo));
    await done();
  };
  const submitWithdraw: DialogSubmit = async () => {
    if (panel?.kind !== 'withdraw') return false as const;
    await api.withdrawFact(panel.fact.id);
    await done();
  };
  const submitDispute: DialogSubmit = async (values) => {
    if (panel?.kind !== 'dispute') return false as const;
    await api.dispute(panel.fact.id, values.note);
    await done();
  };

  const otherLine = (other: OtherEnd | undefined) => {
    if (!other) return null;
    if ('missing' in other) return <p className="atlas-note">The entity at the other end no longer exists.</p>;
    if ('hidden' in other) return <p className="atlas-note">{other.message}</p>;
    return (
      <Button
        kind="secondary"
        size="sm"
        onPress={() => {
          setPanel(undefined);
          onOpenEntity(other.id);
        }}
      >
        Open {other.label}
      </Button>
    );
  };

  const factRows = (facts: FactView[]): ListItem[] =>
    facts.map((f) => ({
      id: f.id,
      title: says(f),
      detail: [span(f), `Kept on ${floorWords(f.floorName)}`, f.disputes.length ? `${f.disputes.length === 1 ? 'Disputed' : `${f.disputes.length} disputes`}` : '', f.unbacked ? 'Its sources were withdrawn' : '']
        .filter(Boolean)
        .join(' · '),
      status: f.disputes.length || f.unbacked ? ('warning' as const) : undefined,
      icon: f.disputes.length ? undefined : f.target ? 'atlas' : 'check',
    }));

  const panels = () => {
    const p = panel;
    if (!p) return null;
    const close = () => setPanel(undefined);
    switch (p.kind) {
      case 'observe': {
        const chosen = properties.find((x) => x.key === property);
        const here = knowledge?.here;
        return (
          <Dialog
            open
            onClose={close}
            eyebrow={here?.floorName ?? ''}
            heading="Record an observation"
            summary={`What was seen or read about ${entity.label}, as it was said. It’s kept on this floor and never changed.`}
            actionLabel="Record it"
            busyLabel="Recording…"
            onSubmit={submitObserve}
            fields={
              <>
                <Select label="About" options={properties.map((x) => ({ value: x.key, label: x.link ? `${x.label}…` : x.label }))} value={property} onChange={(v) => v !== property && void choose(v)} />
                {chosen?.link ? (
                  targets.length ? (
                    <Select key={`target:${property}`} name="target" label={chosen.label} options={targets} defaultValue={targets[0].value} />
                  ) : (
                    <p className="atlas-note">Nothing it can link to shows from this floor yet. Add the entity first, or go to a floor where it shows.</p>
                  )
                ) : (
                  <TextField key={`value:${property}`} name="value" label={chosen?.label ?? 'Value'} required maxLength={200} hint={chosen?.detail?.hint} />
                )}
                <DateField name="observedAt" label="When it was seen" optional empty="Today" quick={PAST_DAYS} />
                <Select
                  label="Where it came from"
                  value={sourceKind}
                  options={[
                    { value: 'person', label: 'I saw or heard it' },
                    { value: 'document', label: pickDocument ? 'A document in Artifacts' : 'A document (no app that keeps documents is here)' },
                    { value: 'other', label: 'Somewhere else' },
                  ]}
                  onChange={(v) => setSourceKind(v as Source['kind'])}
                />
                {sourceKind === 'document' ? (
                  <div className="atlas-actions">
                    <Button kind="secondary" size="sm" disabled={!pickDocument} reason="No app here keeps documents, so none can be picked." onPress={() => void askForDocument()}>
                      {document ? 'Pick another' : 'Pick the document'}
                    </Button>
                    <span className="atlas-note">{document ? document.title : pickDocument ? 'None picked yet.' : ''}</span>
                  </div>
                ) : sourceKind === 'other' ? (
                  <TextField name="sourceNote" label="Where" required maxLength={500} placeholder="Such as a call with the harbour master" />
                ) : null}
                <Select name="reliability" label="How reliable the source is" options={RELIABILITY} defaultValue="" />
                <Select name="credibility" label="How credible what it says is" options={CREDIBILITY} defaultValue="" />
                <TextField name="note" label="Note" optional multiline maxLength={2000} />
                {here?.accept ? (
                  <Select
                    name="accept"
                    label="On this floor"
                    defaultValue="no"
                    options={[
                      { value: 'no', label: 'Just record it' },
                      { value: 'yes', label: 'Record it, and accept it as so here' },
                    ]}
                  />
                ) : (
                  <p className="atlas-note">{here?.why ?? ''}</p>
                )}
              </>
            }
          />
        );
      }
      case 'fact': {
        const f = p.fact;
        return (
          <Dialog open onClose={close} size="read" eyebrow={`Kept on ${floorWords(f.floorName)}`} heading={says(f)} summary={span(f)} cancelLabel="Close">
            <div className="atlas-panel-body">
              <Details
                items={[
                  { label: 'Recorded', value: relativeTime(f.recordedAt) },
                  { label: 'Rests on', value: f.backedBy.length === 1 ? 'One observation' : `${f.backedBy.length} observations` },
                  ...(f.note ? [{ label: 'Note', value: f.note }] : []),
                ]}
              />
              {f.unbacked ? <p className="atlas-note">{f.unbacked}</p> : null}
              {otherLine(f.other)}
              {f.disputes.map((d) => (
                <div key={d.id} className="atlas-dispute">
                  <p>
                    <strong>Disputed from {floorWords(d.floorName)}</strong> {relativeTime(d.at)}: {d.note}
                  </p>
                  {d.mine || f.can.withdraw ? (
                    <Button
                      kind="ghost"
                      size="sm"
                      onPress={async () => {
                        await api.clearDispute(d.id);
                        await done();
                      }}
                    >
                      Clear it
                    </Button>
                  ) : null}
                </div>
              ))}
              <div className="atlas-actions">
                <Button kind="secondary" size="sm" disabled={!f.can.dispute} reason={f.can.why ?? 'You can’t dispute it from here.'} onPress={() => setPanel({ kind: 'dispute', fact: f })}>
                  Dispute
                </Button>
                <Button kind="ghost" size="sm" disabled={!f.can.end} reason={f.can.why ?? 'Only the floor that holds it can end it.'} onPress={() => setPanel({ kind: 'end', fact: f })}>
                  It has ended
                </Button>
                <Button kind="ghost" size="sm" disabled={!f.can.withdraw} reason={f.can.why ?? 'Only the floor that holds it can withdraw it.'} onPress={() => setPanel({ kind: 'withdraw', fact: f })}>
                  Withdraw
                </Button>
              </div>
            </div>
          </Dialog>
        );
      }
      case 'observation': {
        const o = p.observation;
        return (
          <Dialog open onClose={close} size="read" eyebrow={`Recorded on ${floorWords(o.floorName)}`} heading={says(o)} summary={sourceLine(o.source)} cancelLabel="Close">
            <div className="atlas-panel-body">
              <Details
                items={[
                  { label: 'Seen', value: o.observedAt ? day(o.observedAt) : `Not said; recorded ${relativeTime(o.createdAt)}` },
                  { label: 'Grade', value: o.grade ?? 'Not graded' },
                  ...(o.note ? [{ label: 'Note', value: o.note }] : []),
                  ...(o.raisedFrom ? [{ label: 'Raised', value: 'From a floor below' }] : []),
                  ...(o.raisedTo.length ? [{ label: 'Raised to', value: o.raisedTo.join(', ') }] : []),
                ]}
              />
              {o.retracted ? (
                <p className="atlas-note">
                  {o.retracted.why} It’s kept as it was said, {relativeTime(o.retracted.at)} it stopped counting as evidence.
                </p>
              ) : null}
              {otherLine(o.other)}
              <div className="atlas-actions">
                <Button
                  kind="secondary"
                  size="sm"
                  disabled={!o.can.accept || !!o.retracted}
                  reason={o.retracted ? 'Its source was withdrawn, so it can’t back a fact.' : (o.can.why ?? 'You can’t accept it on this floor.')}
                  onPress={() => setPanel({ kind: 'accept', observation: o })}
                >
                  Accept as so here
                </Button>
                <Button kind="ghost" size="sm" disabled={!o.can.raise} reason={o.can.why ?? 'There’s no floor above you can raise it to.'} onPress={() => setPanel({ kind: 'raise', observation: o })}>
                  Raise to a floor above
                </Button>
              </div>
            </div>
          </Dialog>
        );
      }
      case 'accept':
        return (
          <Dialog
            open
            onClose={close}
            eyebrow={knowledge?.here.floorName ?? ''}
            heading="Accept it as so here"
            summary={`${says(p.observation)}. This floor will hold it as a fact, resting on this observation.`}
            actionLabel="Accept it"
            busyLabel="Accepting…"
            onSubmit={submitAccept}
            fields={
              <>
                <DateField name="validFrom" label="True from" optional empty={p.observation.observedAt ? `When it was seen, ${day(p.observation.observedAt)}` : 'Not known'} quick={PAST_DAYS} />
                <DateField name="validTo" label="Until" optional empty="Still holds" quick={[]} />
                <TextField name="note" label="Note" optional multiline maxLength={2000} />
              </>
            }
          />
        );
      case 'raise':
        return (
          <Dialog
            open
            onClose={close}
            eyebrow={p.observation.floorName}
            heading="Raise to a floor above"
            summary="A copy goes up, pointing back to this one. The floor above decides whether to accept it: what higher floors hold is worth more."
            actionLabel="Raise it"
            busyLabel="Raising…"
            onSubmit={submitRaise}
            fields={<Select name="to" label="To" options={p.observation.can.raiseTo.map((f) => ({ value: f.floor, label: f.name }))} defaultValue={p.observation.can.raiseTo[0]?.floor ?? ''} />}
          />
        );
      case 'end':
        return (
          <Dialog
            open
            onClose={close}
            eyebrow={p.fact.floorName}
            heading="When did it end?"
            summary={`${says(p.fact)}. It stays true for the time before, and the record of it stays.`}
            actionLabel="End it"
            busyLabel="Ending…"
            onSubmit={submitEnd}
            fields={<DateField name="validTo" label="Ended on" optional empty="Today" quick={PAST_DAYS} />}
          />
        );
      case 'withdraw':
        return (
          <Dialog open onClose={close} danger eyebrow={p.fact.floorName} heading="Withdraw it?" actionLabel="Withdraw" busyLabel="Withdrawing…" onSubmit={submitWithdraw}>
            <p>For a fact recorded in error. It stops showing from now on, but stays on record: looking “as known on” an earlier day still finds it.</p>
          </Dialog>
        );
      case 'dispute':
        return (
          <Dialog
            open
            onClose={close}
            eyebrow={`Kept on ${floorWords(p.fact.floorName)}`}
            heading="Dispute it"
            summary={`${says(p.fact)}. Say why it may be wrong. Its floor sees the dispute, and it shows here until cleared.`}
            actionLabel="Dispute it"
            busyLabel="Sending…"
            onSubmit={submitDispute}
            fields={<TextField name="note" label="Why" required multiline maxLength={2000} />}
          />
        );
    }
  };

  const k = knowledge;
  const details = k?.facts.filter((f) => !f.target) ?? [];
  const links = k?.facts.filter((f) => f.target) ?? [];
  const when = [at ? `true on ${day(`${at}T00:00:00Z`)}` : 'true now', known ? `as recorded by ${day(`${known}T00:00:00Z`)}` : 'as recorded now'].join(', ');
  const observations: ListItem[] = (k?.observations ?? []).map((o) => ({
    id: o.id,
    title: says(o),
    detail: [
      o.observedAt ? `Seen ${day(o.observedAt)}` : `Recorded ${relativeTime(o.createdAt)}`,
      sourceLine(o.source),
      o.grade,
      `On ${floorWords(o.floorName)}`,
      o.raisedTo.length ? `Raised to ${o.raisedTo.join(', ')}` : '',
      o.retracted ? 'Source withdrawn' : '',
    ]
      .filter(Boolean)
      .join(' · '),
    icon: o.source.kind === 'document' ? 'document' : 'view',
    ...(o.retracted ? { status: 'warning' as const } : {}),
  }));
  const openFact = (from: FactView[]) => (item: ListItem) => {
    const fact = from.find((f) => f.id === item.id);
    if (fact) setPanel({ kind: 'fact', fact });
  };
  const retired = entity.state !== 'active';
  return (
    <section className="atlas-knowledge">
      <div className="atlas-head">
        <Heading size="s" level={2} heading="What’s known" summary={`Facts each floor holds, ${when}. Each says which floor holds it: a team’s working view sits beside the org’s confirmed record.`} />
        <Button kind="secondary" size="sm" disabled={retired} reason="It has been retired, so nothing more is recorded about it." onPress={observe}>
          Record an observation
        </Button>
      </div>
      {retired ? <p className="atlas-note">It has been retired, so nothing more is recorded about it.</p> : null}
      {k?.noCurrentSource ? (
        <p className="atlas-note" role="status">
          {k.noCurrentSource}
        </p>
      ) : null}
      <div className="atlas-clocks">
        <DateField label="True on" optional empty="Today" quick={PAST_DAYS} value={at} hint="The day in the world" onChange={(v) => v !== at && setAt(v)} />
        <DateField label="As recorded by" optional empty="Today" quick={PAST_DAYS} value={known} hint="What was on record that day" onChange={(v) => v !== known && setKnown(v)} />
      </div>
      <List
        label="Facts"
        density="compact"
        noun={['fact', 'facts']}
        items={factRows(details)}
        loading={!k && !failure}
        error={failure}
        empty="No floor you can see holds a fact about it yet. Facts come from observations a floor’s leads accept."
        onOpen={openFact(details)}
        onRetry={() => void load()}
        className="atlas-facts"
      />
      <List label="Links" density="compact" noun={['link', 'links']} items={factRows(links)} loading={!k && !failure} empty="No links to other entities show from here yet." onOpen={openFact(links)} className="atlas-links-list" />
      <List
        label="Observations"
        density="compact"
        noun={['observation', 'observations']}
        items={observations}
        loading={!k && !failure}
        empty="Nothing has been recorded about it on a floor you can see."
        onOpen={(item) => {
          const observation = k?.observations.find((o) => o.id === item.id);
          if (observation) setPanel({ kind: 'observation', observation });
        }}
        className="atlas-observations"
      />
      {k && !k.here.accept ? <p className="atlas-note">{k.here.why}</p> : null}
      {panels()}
    </section>
  );
}
