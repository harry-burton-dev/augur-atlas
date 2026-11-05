import { useEffect, useState } from 'react';
import { Button, relativeTime } from '@augur/app-kit';
import type { AtlasApi, EntityMerges } from './api.js';

export interface MergedNoteProps {
  api: AtlasApi;
  entity: string;
  onOpen: (id: string) => void;
}

/**
 * On an entity that was found to be the same as another and placed under it:
 * which one, when, by whom and why, so the merge can be explained. Nothing of
 * it moved, so undoing the merge brings it back as it was.
 */
export function MergedNote({ api, entity, onOpen }: MergedNoteProps) {
  const [merges, setMerges] = useState<EntityMerges>();
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let live = true;
    api.merges(entity).then(
      (m) => live && setMerges(m),
      (err: Error) => live && setFailure(err.message),
    );
    return () => {
      live = false;
    };
  }, [api, entity]);
  const m = merges?.placedUnder;
  if (failure) return <p className="atlas-note atlas-retired">Merged into another entity. Which one couldn’t be loaded: {failure}</p>;
  if (!m) return <p className="atlas-note atlas-retired">Merged into another entity.</p>;
  const cited = m.cites.length ? ` It rests on ${m.cites.length === 1 ? 'one observation' : `${m.cites.length} observations`}.` : '';
  return (
    <div className="atlas-note atlas-retired atlas-merged">
      <p>
        Found to be the same as another entity {relativeTime(m.decidedAt)}, and placed under it: “{m.why}”.{cited} Nothing of it moved, so the merge can be undone.
      </p>
      <Button kind="ghost" size="sm" onPress={() => onOpen(m.senior)}>
        Open the one it’s under
      </Button>
    </div>
  );
}
