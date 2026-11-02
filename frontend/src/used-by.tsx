import { useCallback, useEffect, useState } from 'react';
import type { DocumentRef } from '@augur/mfe-sdk';
import { Heading, List, relativeTime, type ListItem } from '@augur/app-kit';
import type { AtlasApi, IntentName, UsedBy as Used } from './api.js';

const ROLE: Record<string, string> = { subject: 'its subject', resource: 'a resource', area: 'its area', related: 'related' };

export interface UsedByProps {
  api: AtlasApi;
  entity: string;
  onOpenIntent?: (id: string) => void;
  onOpenDocument?: (ref: DocumentRef) => void;
}

/**
 * What uses an entity: intents bound to it in Mandate, named by Mandate as the
 * person (one they can't open still shows, saying where it's kept), and the
 * documents what's known of it came from. Nothing is hidden for being out of
 * reach: it says why.
 */
export function UsedBy({ api, entity, onOpenIntent, onOpenDocument }: UsedByProps) {
  const [used, setUsed] = useState<Used>();
  const [names, setNames] = useState<Map<string, IntentName>>(new Map());
  /** Why the intents couldn't be named, when Mandate couldn't be asked. */
  const [unnamed, setUnnamed] = useState('');
  const [failure, setFailure] = useState('');

  const load = useCallback(async () => {
    setFailure('');
    setUnnamed('');
    try {
      const u = await api.usedBy(entity);
      setUsed(u);
      const ids = [...new Set(u.intents.map((i) => i.id))];
      if (ids.length) {
        try {
          setNames(new Map((await api.nameIntents(ids)).map((n) => [n.id, n])));
        } catch (err) {
          setUnnamed((err as Error).message);
        }
      }
    } catch (err) {
      setFailure((err as Error).message);
    }
  }, [api, entity]);
  useEffect(() => void load(), [load]);

  const intents: ListItem[] = (used?.intents ?? []).map((i) => {
    const n = names.get(i.id);
    const open = !!n?.canOpen;
    return {
      id: i.id,
      title: open ? (n?.label ?? 'An intent') : 'An intent you can’t open',
      detail: [`Intent · ${ROLE[i.role] ?? i.role}`, open ? '' : i.floorName ? `kept on ${i.floorName}, ask its lead` : 'ask whoever leads its floor', `bound ${relativeTime(i.since)}`].filter(Boolean).join(' · '),
      icon: 'compass',
      // Its detail already says where it's kept and who to ask.
      ...(open ? {} : { disabled: true }),
    };
  });
  const documents: ListItem[] = (used?.documents ?? []).map((d) => ({
    id: `${d.app}:${d.id}`,
    title: d.title,
    detail: [`${d.observations === 1 ? 'One observation' : `${d.observations} observations`} from it`, d.withdrawn ? 'since withdrawn' : '', `latest ${relativeTime(d.lastAt)}`].filter(Boolean).join(' · '),
    icon: 'document',
    ...(d.withdrawn ? { status: 'warning' as const } : {}),
  }));
  return (
    <section className="atlas-section">
      <Heading size="s" level={2} heading="Used by" summary="Intents bound to it, and documents what’s known of it came from. Each app decides what you can open." />
      {unnamed ? (
        <p className="atlas-note">
          {used?.intents.length === 1 ? 'One intent uses' : `${used?.intents.length} intents use`} it. {unnamed}
        </p>
      ) : null}
      <List
        label="Intents"
        density="compact"
        noun={['intent', 'intents']}
        items={unnamed ? [] : intents}
        loading={!used && !failure}
        error={failure}
        empty={unnamed ? 'Not named here.' : 'No intent is bound to it. In Mandate, an intent binds entities as its subject, resources or area.'}
        onOpen={(item) => names.get(item.id)?.canOpen && onOpenIntent?.(item.id)}
        onRetry={() => void load()}
        className="atlas-used-intents"
      />
      <List
        label="Mentioned in"
        density="compact"
        noun={['document', 'documents']}
        items={documents}
        loading={!used && !failure}
        empty="Nothing known of it here came from a document yet."
        onOpen={(item) => {
          const d = used?.documents.find((x) => `${x.app}:${x.id}` === item.id);
          if (d) onOpenDocument?.({ app: d.app, id: d.id, title: d.title });
        }}
        className="atlas-used-documents"
      />
    </section>
  );
}
