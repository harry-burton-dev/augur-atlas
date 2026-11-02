import { useEffect, useState } from 'react';
import type { EntityProposal, ProposalReceipt } from '@augur/mfe-sdk';
import { Button, Heading, Select, type SelectOption } from '@augur/app-kit';
import { floorWords, typeTree, type AtlasApi, type Ontology } from './api.js';

export interface ProposeProps {
  api: AtlasApi;
  offer: EntityProposal;
  floorName?: string;
  onProposed: (receipt: ProposalReceipt) => void;
  onCancel: () => void;
}

/**
 * Data Atlas answering `entity.propose` for another app: someone marked words
 * in a document that name a thing. It asks what kind of thing, and files a
 * one-mention proposal in this floor's Triage, where its leads decide whether
 * it's something already known, a new one, or nothing. Nothing is added to
 * what's known until they do, and the form says so.
 */
export function Propose({ api, offer, floorName = '', onProposed, onCancel }: ProposeProps) {
  const [ontology, setOntology] = useState<Ontology>();
  /** The kind chosen; empty for "not sure". */
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let live = true;
    void api
      .ontology()
      .then((o) => {
        if (!live) return;
        setOntology(o);
        if (offer.type && o.types.some((t) => t.key === offer.type)) setType(offer.type);
      })
      .catch((err: Error) => live && setFailure(err.message));
    return () => {
      live = false;
    };
  }, [api, offer.type]);

  const send = async () => {
    setBusy(true);
    setFailure('');
    try {
      const { source, anchor, text, context } = offer;
      const made = await api.propose({
        source: { kind: 'document', document: source, ...(anchor ? { anchor } : {}) },
        mentions: [{ key: 'm1', text, ...(type ? { type } : {}), ...(anchor ? { anchor } : {}), ...(context ? { context } : {}) }],
      });
      onProposed({ proposal: made.id, queue: `${floorWords(made.queue)}’s Triage` });
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kinds: SelectOption[] = [
    { value: '', label: 'Not sure: the leads decide' },
    ...(ontology ? typeTree(ontology).map(({ type: t, depth }) => ({ value: t.key, label: `${'  '.repeat(depth)}${t.abstract ? `Some kind of ${t.label.toLowerCase()}` : t.label}` })) : []),
  ];
  const where = floorName ? floorWords(floorName) : 'this floor';
  const { text, context, source } = offer;
  return (
    <div className="atlas-propose">
      <Heading
        eyebrow="Add to Data Atlas"
        heading="What does it name?"
        summary={`From ${source.title}. It goes to ${where}’s Triage, where its leads decide whether it’s something already known, a new one, or nothing. Nothing is added until they do.`}
      />
      <p className="atlas-words">“{text}”</p>
      {context && context !== text ? <blockquote className="atlas-context">{context}</blockquote> : null}
      <Select label="What kind of thing it is" options={kinds} value={type} onChange={setType} />
      {failure ? (
        <p className="atlas-note atlas-refused" role="alert">
          {failure}
        </p>
      ) : null}
      <div className="atlas-actions atlas-end">
        <Button kind="ghost" size="sm" onPress={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" size="sm" busy={busy} busyLabel="Sending…" onPress={() => void send()}>
          Send to Triage
        </Button>
      </div>
    </div>
  );
}
