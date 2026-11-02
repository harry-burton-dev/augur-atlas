import { useCallback, useEffect, useState } from 'react';
import type { DocumentRef } from '@augur/mfe-sdk';
import { Button, List, PageHead, Ref, Select, State, TextField, relativeTime, type ListItem, type SelectOption } from '@augur/app-kit';
import { day, floorWords, isA, propertyLabel, typeTree, type AtlasApi, type MatchView, type Matching, type MentionView, type Ontology, type Place, type ProposalObservationView, type ProposalView, type Triage as Queue } from './api.js';
import { Picker } from './picker.js';

/** A mention's words picked out of the passage around them. */
const inContext = (context: string, text: string) => {
  const at = context.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return context;
  return (
    <>
      {context.slice(0, at)}
      <mark>{context.slice(at, at + text.length)}</mark>
      {context.slice(at + text.length)}
    </>
  );
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
  return `Matched by ${tried.slice(0, -1).join(', ')} and ${tried[tried.length - 1]}, ${relativeTime(m.at)}.${m.why ? ` ${m.why}` : ''}`;
};

export interface TriageProps {
  api: AtlasApi;
  ontology: Ontology | undefined;
  place: Place;
  /** Who is looking: Triage says which proposals are theirs. */
  userId: string;
  onMove: (place: Place) => void;
  onOpenDocument?: (ref: DocumentRef) => void;
}

/**
 * Triage: where proposals become knowledge. A floor's open proposals, and one
 * proposal at a time: the source, what it seems to name, and what it seems to
 * say. Each mention is an entity already known, a new one, or nothing; each
 * observation is accepted as so, kept as seen, or dropped. Nothing becomes
 * knowledge until a lead decides, and nothing skips this step in v1.
 */
export function Triage({ api, ontology, place, userId, onMove, onOpenDocument }: TriageProps) {
  const [triage, setTriage] = useState<Queue>();
  const [closed, setClosed] = useState<Queue>();
  const [open, setOpen] = useState<ProposalView>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  /** The item being decided, so its buttons wait. */
  const [busy, setBusy] = useState('');
  /** Why the last decision was refused, beside the item it was for. */
  const [refusal, setRefusal] = useState<{ key: string; message: string }>();
  /** The mention whose "something else" picker is open. */
  const [choosing, setChoosing] = useState('');
  /** The mention whose "a new one" form is open. */
  const [making, setMaking] = useState('');
  const [newType, setNewType] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const proposalId = place.page === 'proposal' ? place.id : '';
  const load = useCallback(async () => {
    setLoading(true);
    setFailure('');
    try {
      if (proposalId) {
        setOpen(undefined);
        setOpen(await api.proposal(proposalId));
      } else {
        const [o, c] = await Promise.all([api.proposals('open'), api.proposals('closed')]);
        setTriage(o);
        setClosed(c);
      }
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, proposalId]);
  useEffect(() => void load(), [load]);

  /** Runs a decision, redrawing from what the service answers, or saying why not beside the item. */
  const decide = async (key: string, work: () => Promise<ProposalView>) => {
    setBusy(key);
    setRefusal(undefined);
    try {
      setOpen(await work());
      setChoosing('');
      setMaking('');
    } catch (err) {
      setRefusal({ key, message: (err as Error).message });
    } finally {
      setBusy('');
    }
  };

  const typeLabel = (type: string | undefined) => (type ? (ontology?.types.find((t) => t.key === type)?.label ?? type) : 'Not said');
  const who = (createdBy: string) => (createdBy === userId ? 'you' : 'someone on this floor');
  const sourceTitle = (p: { source: ProposalView['source'] }) => (p.source.kind === 'document' ? p.source.document.title : p.source.kind === 'other' ? p.source.note : 'Said by hand');
  const refused = (key: string) =>
    refusal?.key === key ? (
      <p className="atlas-note atlas-refused" role="alert">
        {refusal.message}
      </p>
    ) : null;

  const listPage = () => {
    const t = triage;
    const row = (p: Queue['proposals'][number]): ListItem => ({
      id: p.id,
      title: sourceTitle(p),
      icon: 'document',
      detail: [
        p.state === 'open' ? `${p.decided} of ${p.items} decided` : p.state === 'finished' ? 'Finished' : 'Withdrawn',
        `proposed by ${who(p.createdBy)}`,
        p.source.kind === 'document' && p.source.document.version ? `version ${p.source.document.version}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      meta: relativeTime(p.closedAt ?? p.createdAt),
    });
    const where = t ? floorWords(t.floorName) : 'this floor';
    return (
      <>
        <PageHead eyebrow={t ? `${t.floorName} · Triage` : 'Triage'} heading="What’s waiting to be decided" summary={`Proposals made on ${where}. Nothing is added until a lead decides.`} />
        {t?.why ? <p className="atlas-note">{t.why}</p> : null}
        <List
          label="Open proposals"
          noun={['proposal', 'proposals']}
          items={(t?.proposals ?? []).map(row)}
          loading={loading}
          error={failure}
          empty="Nothing is waiting. Proposals arrive when someone marks a name in a document in Artifacts and chooses Add to Data Atlas."
          onOpen={(item) => onMove({ page: 'proposal', id: item.id })}
          onRetry={() => void load()}
        />
        {closed?.proposals.length ? (
          <List label="Finished and withdrawn" density="compact" noun={['proposal', 'proposals']} items={closed.proposals.map(row)} onOpen={(item) => onMove({ page: 'proposal', id: item.id })} />
        ) : null}
      </>
    );
  };

  /** The kinds a new entity can be made of for this mention: those under the kind it was said to be, else all. */
  const kindsFor = (m: MentionView): SelectOption[] => {
    if (!ontology) return [];
    const asked = m.type && ontology.types.some((t) => t.key === m.type) ? m.type : undefined;
    return typeTree(ontology)
      .filter(({ type }) => !type.abstract && (!asked || isA(ontology, type.key, asked)))
      .map(({ type }) => ({ value: type.key, label: type.label }));
  };

  const mentionCard = (p: ProposalView, m: MentionView) => {
    const can = p.can.decide;
    const why = p.can.why ?? 'Only this floor’s leads decide what’s added.';
    const waiting = busy === m.key;
    const decided = m.decision;
    let outcome = null;
    if (decided?.as === 'drop') outcome = <p className="atlas-outcome">Dropped: it isn’t a thing worth keeping.</p>;
    else if (decided && 'kind' in decided.entity) {
      const e = decided.entity;
      outcome = (
        <p className="atlas-outcome">
          {decided.as === 'new' ? 'Made new: ' : 'It’s '}
          <Ref value={{ kind: 'entity', id: e.id, label: 'label' in e ? e.label : '', ...('type' in e ? { type: e.type } : {}) }} onOpen={() => onMove({ page: 'entity', id: e.id })} />
          <span className="atlas-note">{'floorName' in e ? ` · kept on ${floorWords(e.floorName)}` : ''}</span>
        </p>
      );
    } else if (decided) outcome = <p className="atlas-outcome">{'message' in decided.entity ? decided.entity.message : 'It’s no longer there.'}</p>;
    const kinds = kindsFor(m);
    return (
      <li key={m.key} className="atlas-card">
        <p className="atlas-said">
          <strong>“{m.text}”</strong> <span className="atlas-note">{typeLabel(m.type)}</span>
        </p>
        {m.context ? <blockquote className="atlas-context">{inContext(m.context, m.text)}</blockquote> : null}
        {outcome}
        {decided || p.state !== 'open' ? null : (
          <>
            {m.matches.length ? (
              <ul className="atlas-matches">
                {m.matches.map((x) => (
                  <li key={x.entity.id} className="atlas-actions">
                    <Button kind="secondary" size="sm" disabled={!can} reason={why} busy={waiting} onPress={() => void decide(m.key, () => api.decideMention(p.id, m.key, { as: 'link', entity: x.entity.id }))}>
                      It’s {x.entity.label}
                    </Button>
                    <span className="atlas-note">
                      {matchWhy(x)} · {floorWords(x.entity.floorName)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="atlas-note">Nothing that shows from here has this name, its keys, or one like it.</p>
            )}
            <div className="atlas-actions">
              <Button
                kind="ghost"
                size="sm"
                disabled={!can}
                reason={why}
                busy={waiting}
                onPress={() => {
                  setChoosing(choosing === m.key ? '' : m.key);
                  setMaking('');
                }}
              >
                Something else…
              </Button>
              <Button
                kind="ghost"
                size="sm"
                disabled={!can || !kinds.length}
                reason={!can ? why : 'No kind in the ontology fits it yet.'}
                busy={waiting}
                onPress={() => {
                  setMaking(making === m.key ? '' : m.key);
                  setChoosing('');
                  setNewType(kinds[0]?.value ?? '');
                  setNewLabel(m.text);
                }}
              >
                A new one
              </Button>
              <Button kind="ghost" size="sm" disabled={!can} reason={why} busy={waiting} onPress={() => void decide(m.key, () => api.decideMention(p.id, m.key, { as: 'drop' }))}>
                Drop it
              </Button>
            </div>
            {choosing === m.key ? (
              <Picker
                api={api}
                purpose={`What “${m.text}” is`}
                types={m.type ? [m.type] : []}
                onPicked={(entities) => void decide(m.key, () => api.decideMention(p.id, m.key, { as: 'link', entity: entities[0].id }))}
                onCancel={() => setChoosing('')}
              />
            ) : null}
            {making === m.key ? (
              <>
                <div className="atlas-make">
                  <Select label="Kind" options={kinds} value={newType} onChange={setNewType} />
                  <TextField label="Name" value={newLabel} maxLength={200} onChange={setNewLabel} />
                  <Button
                    kind="primary"
                    size="sm"
                    disabled={!newLabel.trim()}
                    reason="Give it a name first."
                    busy={waiting}
                    onPress={() => void decide(m.key, () => api.decideMention(p.id, m.key, { as: 'new', type: newType, label: newLabel.trim() }))}
                  >
                    Add it here
                  </Button>
                </div>
                <p className="atlas-note">
                  Made on {floorWords(p.floorName)}. If you change its name, “{m.text}” is kept as another name for it.
                </p>
              </>
            ) : null}
          </>
        )}
        {refused(m.key)}
      </li>
    );
  };

  /** What an observation says, in the mentions' words, or the entities they turned out to be. */
  const observationWords = (p: ProposalView, o: ProposalObservationView) => {
    const name = (key: string) => {
      const m = p.mentions.find((x) => x.key === key);
      if (!m) return key;
      const d = m.decision;
      return d && d.as !== 'drop' && 'label' in d.entity ? d.entity.label : `“${m.text}”`;
    };
    const about = p.mentions.find((x) => x.key === o.about);
    const type = about?.decision && about.decision.as !== 'drop' && 'type' in about.decision.entity ? about.decision.entity.type : (about?.type ?? '');
    const property = propertyLabel(ontology, type, o.property);
    return o.target ? `${name(o.about)} · ${property} ${name(o.target)}` : `${name(o.about)} · ${property}: ${o.value}`;
  };

  const observationCard = (p: ProposalView, o: ProposalObservationView) => {
    const can = p.can.decide && o.ready;
    const why = !p.can.decide ? (p.can.why ?? 'Only this floor’s leads decide what’s added.') : (o.why ?? 'Decide what it names first.');
    const waiting = busy === o.key;
    const decided = o.decision;
    return (
      <li key={o.key} className="atlas-card">
        <p className="atlas-said">
          <strong>{observationWords(p, o)}</strong>
        </p>
        <p className="atlas-note">{[o.observedAt ? `Seen ${day(o.observedAt)}` : '', o.grade ? `Graded ${o.grade}` : '', o.note ?? ''].filter(Boolean).join(' · ') || 'As the source says it'}</p>
        {decided ? (
          <p className="atlas-outcome">{decided.as === 'accepted' ? 'Accepted as so on this floor.' : decided.as === 'seen' ? 'Kept as seen: an observation, not yet accepted as so.' : 'Dropped.'}</p>
        ) : p.state === 'open' ? (
          <div className="atlas-actions">
            <Button kind="secondary" size="sm" disabled={!can} reason={why} busy={waiting} onPress={() => void decide(o.key, () => api.decideObservation(p.id, o.key, { as: 'accepted' }))}>
              Accept as so
            </Button>
            <Button kind="ghost" size="sm" disabled={!can} reason={why} busy={waiting} onPress={() => void decide(o.key, () => api.decideObservation(p.id, o.key, { as: 'seen' }))}>
              Keep as seen
            </Button>
            <Button kind="ghost" size="sm" disabled={!p.can.decide} reason={why} busy={waiting} onPress={() => void decide(o.key, () => api.decideObservation(p.id, o.key, { as: 'drop' }))}>
              Drop it
            </Button>
          </div>
        ) : null}
        {refused(o.key)}
      </li>
    );
  };

  const proposalPage = () => {
    const back = (
      <Button kind="ghost" size="sm" onPress={() => onMove({ page: 'triage' })}>
        Triage
      </Button>
    );
    if (failure)
      return (
        <>
          {back}
          <State kind="error" heading="Couldn’t open the proposal" body={failure} action="Try again" onAction={() => void load()} />
        </>
      );
    const p = open;
    if (!p)
      return (
        <>
          {back}
          <State kind="loading" heading="Opening…" />
        </>
      );
    const source = p.source;
    const version = source.kind === 'document' && source.document.version ? `, from version ${source.document.version}` : '';
    const state = p.state === 'finished' ? 'Finished.' : p.state === 'withdrawn' ? 'Withdrawn.' : '';
    const decideWhy = p.can.why ?? 'Only this floor’s leads decide what’s added.';
    return (
      <>
        {back}
        <div className="atlas-head">
          <PageHead eyebrow={`${p.floorName} · Triage`} heading={sourceTitle(p)} summary={`Proposed by ${who(p.createdBy)} ${relativeTime(p.createdAt)}${version}. ${state}`.trim()} />
          <div className="atlas-actions">
            {source.kind === 'document' ? (
              <Button kind="secondary" size="sm" onPress={() => onOpenDocument?.(source.document as DocumentRef)}>
                Open the source
              </Button>
            ) : null}
            <Button kind="primary" size="sm" disabled={!p.can.finish} reason={p.can.why ?? 'Decide everything it names and says first.'} busy={busy === 'finish'} onPress={() => void decide('finish', () => api.finishProposal(p.id))}>
              Finish
            </Button>
            <Button
              kind="ghost"
              size="sm"
              disabled={!p.can.withdraw}
              reason={p.can.why ?? 'Only the person who proposed it can withdraw it.'}
              busy={busy === 'withdraw'}
              onPress={() => void decide('withdraw', () => api.withdrawProposal(p.id))}
            >
              Withdraw
            </Button>
          </div>
        </div>
        {p.sourceGone && p.state === 'open' ? (
          <p className="atlas-note atlas-refused" role="status">
            {p.sourceGone} What it names can still be decided; what it says can only be dropped.
          </p>
        ) : null}
        {refused('finish')}
        {refused('withdraw')}
        <section aria-label="What it names" className="atlas-section">
          <div className="atlas-head">
            <h2 className="atlas-section-title">What it names</h2>
            {p.state === 'open' ? (
              <Button
                kind="ghost"
                size="sm"
                disabled={!p.can.decide || !p.mentions.some((m) => !m.decision)}
                reason={!p.can.decide ? decideWhy : 'Every mention is decided.'}
                busy={busy === 'match'}
                busyLabel="Looking…"
                onPress={() => void decide('match', () => api.matchProposal(p.id))}
              >
                Look again
              </Button>
            ) : null}
          </div>
          {p.matching ? <p className="atlas-note atlas-matching">{matchingWords(p.matching)}</p> : null}
          {refused('match')}
          <ul className="atlas-cards">{p.mentions.map((m) => mentionCard(p, m))}</ul>
        </section>
        {p.observations.length ? (
          <section aria-label="What it says" className="atlas-section">
            <h2 className="atlas-section-title">What it says</h2>
            <ul className="atlas-cards">{p.observations.map((o) => observationCard(p, o))}</ul>
          </section>
        ) : null}
        {p.terms.length ? (
          <section aria-label="Words it wanted" className="atlas-section">
            <h2 className="atlas-section-title">Words the ontology hasn’t got</h2>
            <ul className="atlas-terms">
              {p.terms.map((t) => (
                <li key={t.name}>
                  {t.name} <span className="atlas-note">{t.kind === 'type' ? `a kind${t.parent ? ` under ${typeLabel(t.parent)}` : ''}` : t.kind === 'relation' ? 'a kind of link' : 'a detail'}</span>
                </li>
              ))}
            </ul>
            <p className="atlas-note">Admins add new words to the ontology. They’re kept here for them; nothing waits on them.</p>
          </section>
        ) : null}
      </>
    );
  };

  return <div className="atlas-triage">{place.page === 'proposal' ? proposalPage() : listPage()}</div>;
}
