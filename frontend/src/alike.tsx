import { useCallback, useEffect, useState } from 'react';
import { Dialog, Heading, List, TextField, type DialogSubmit, type ListItem } from '@augur/app-kit';
import { floorWords, type Alike, type AlikeList, type AtlasApi, type Entity } from './api.js';

export interface MightBeTheSameProps {
  api: AtlasApi;
  entity: Entity;
  onOpenEntity: (id: string) => void;
  /** After a merge: the entity is now placed under another. */
  onMerged: () => void;
}

/** Why an entity is suggested, in words. */
const because = (a: Alike) => {
  if (a.why === 'key') return `Same ${a.detail ?? 'identity key'}`;
  if (a.why === 'name') return 'Same name';
  if (a.why === 'alias') return 'Same as one of its other names';
  if (a.why === 'similar') return `Spelt nearly alike${a.detail ? ` (“${a.detail}”)` : ''}${a.score !== undefined ? `, ${a.score.toFixed(2)}` : ''}`;
  return `Close in meaning${a.score !== undefined ? `, ${a.score.toFixed(2)}` : ''}`;
};

/**
 * "Might be the same" (PER-326): entities found as Triage finds them that may
 * be the same real thing. Anyone who sees the entity sees them and why; whoever
 * may decide what it is can place it under one, saying why, and undo that
 * later. When it can't be merged from here, the button stays and says why.
 * Nothing found, nothing shown: there's nothing to explain.
 */
export function MightBeTheSame({ api, entity, onOpenEntity, onMerged }: MightBeTheSameProps) {
  const [found, setFound] = useState<AlikeList>();
  const [failure, setFailure] = useState('');
  const [merging, setMerging] = useState<Alike>();

  const load = useCallback(async () => {
    setFailure('');
    try {
      const got = await api.alike(entity.id);
      setFound({ alike: Array.isArray(got.alike) ? got.alike : [], matching: got.matching });
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api, entity.id]);
  useEffect(() => void load(), [load]);

  const alike = found?.alike ?? [];
  if (!failure && !alike.length) return null;
  const items: ListItem[] = alike.map((a) => ({
    id: a.entity.id,
    title: a.entity.label,
    detail: [because(a), `kept on ${floorWords(a.entity.floorName)}`].join(' · '),
    icon: 'link',
    actions: [{ id: 'merge', label: 'Merge into it…', ...(a.merge.into ? {} : { disabled: true, reason: a.merge.why ?? 'It can’t be merged from here.' }) }],
  }));
  const submit: DialogSubmit = async (values) => {
    if (!merging) return false as const;
    await api.merge(entity.id, merging.entity.id, values.why);
    setMerging(undefined);
    onMerged();
  };

  return (
    <section className="atlas-section atlas-alike">
      <Heading size="s" level={2} heading="Might be the same" summary="Found as Triage finds them: by identity key, name and spelling, and by meaning when it’s on." />
      {found?.matching?.why ? <p className="atlas-note">{found.matching.why}</p> : null}
      <List
        label="Might be the same"
        density="compact"
        noun={['entity', 'entities']}
        items={items}
        error={failure}
        onOpen={(item) => onOpenEntity(item.id)}
        onAction={(item, action) => action.id === 'merge' && setMerging(alike.find((a) => a.entity.id === item.id))}
        onRetry={() => void load()}
      />
      {merging ? (
        <Dialog
          open
          onClose={() => setMerging(undefined)}
          eyebrow={`Kept on ${floorWords(entity.floorName)}`}
          heading={`Merge ${entity.label} into ${merging.entity.label}?`}
          summary={`${entity.label} is placed under ${merging.entity.label}. Nothing moves: what’s known of each stays, and the merge can be undone. Say why they’re the same thing.`}
          actionLabel="Merge"
          busyLabel="Merging…"
          onSubmit={submit}
          fields={<TextField name="why" label="Why they’re the same" required multiline maxLength={2000} />}
        />
      ) : null}
    </section>
  );
}
