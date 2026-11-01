import { detailsOf, normaliseDetail, withSubtypes, type Ontology } from './ontology.ts';
import type { Entity, Match, Matching, Mention, PgAtlasStore } from './store.ts';

/**
 * Resolve (spec, "Ingest seam"): which existing entities a mention may be. In
 * order: identity keys, the name or another name exactly, names spelt nearly
 * alike (pg_trgm), then meaning (embeddings through the model gateway). It only
 * suggests: a floor's leads decide in Triage. Whatever couldn't be tried is
 * said, with why, on the proposal (explain, never hide).
 */

/** Turns texts into vectors, as Data Atlas, for the floor named: the service kit's embedTexts, or a stand-in in tests. */
export type Embed = (texts: string[], workspace?: string) => Promise<{ vectors: number[][]; model: string }>;

/** At most this many suggestions for a mention. */
const MOST = 10;
/** The gateway takes up to 64 texts a call. */
const BATCH = 64;

const typeLabel = (ontology: Ontology, type: string | undefined) => (type ? ontology.types.find((t) => t.key === type)?.label : undefined);

/** What an entity is, in words, for its vector: its name, kind, other names and what it is. */
export const entityText = (ontology: Ontology, e: Entity) =>
  [`${e.label} (${typeLabel(ontology, e.type) ?? e.type})`, e.aliases.length ? `also ${e.aliases.join(', ')}` : '', e.description.slice(0, 500)].filter(Boolean).join('. ');

/** What a mention seems to name, in words, for its vector: the words and the kind it was said to be. */
export const mentionText = (ontology: Ontology, m: Mention) => (typeLabel(ontology, m.type) ? `${m.text} (${typeLabel(ontology, m.type)})` : m.text);

/** The gateway's refusal in its own words, without the call's wrapping ("Could not …: it answered 403: …"). */
const refusal = (err: unknown) => {
  const said = (err as Error).message ?? '';
  return said.match(/answered \d{3}: (.+)$/)?.[1]?.replace(/\.?$/, '.') ?? 'the model gateway can’t be reached right now.';
};

export interface Resolver {
  /** Each mention's suggestions, by its key, and how they were found. */
  match(ontology: Ontology, floors: readonly string[], mentions: Mention[], workspace: string): Promise<{ matches: Map<string, Match[]>; matching: Matching }>;
  /** Embeds entities that have no vector yet, or an old one: up to `limit`. The number embedded. */
  catchUp(ontology: Ontology, limit?: number): Promise<number>;
}

export const resolver = (store: PgAtlasStore, embed: Embed | undefined, now: () => Date = () => new Date()): Resolver => {
  /** The model the vectors kept are from: learnt from the gateway's first answer. */
  let model: string | undefined;

  const catchUp = async (ontology: Ontology, limit = 256) => {
    if (!embed || !model || !store.can.meaning) return 0;
    let done = 0;
    // Floors where Data Atlas may not use models are left for now, so the rest aren't held up behind them.
    const refused: string[] = [];
    while (done < limit) {
      const due = await store.unembedded(model, Math.min(BATCH, limit - done), refused);
      if (!due.length) break;
      // One call per floor's workspace: the grant to use models is checked there.
      const byWorkspace = new Map<string, Entity[]>();
      for (const e of due) byWorkspace.set(e.workspace, [...(byWorkspace.get(e.workspace) ?? []), e]);
      for (const [workspace, entities] of byWorkspace) {
        const texts = entities.map((e) => entityText(ontology, e));
        const got = await embed(texts, workspace).catch(() => undefined);
        if (!got) {
          refused.push(workspace);
          continue;
        }
        if (got.model !== model) {
          // The server's embedding model changed: everything is embedded again with the new one.
          model = got.model;
        }
        await store.saveVectors(got.model, entities.map((e, i) => ({ entity: e.id, source: texts[i], embedding: got.vectors[i] })));
      }
      done += due.length;
    }
    return done;
  };

  return {
    catchUp: (ontology, limit) => catchUp(ontology, limit).catch(() => 0),

    async match(ontology, floors, mentions, workspace) {
      const matches = new Map<string, Match[]>();
      for (const m of mentions) {
        const found = new Map<string, Match>();
        const kinds = m.type && ontology.types.some((t) => t.key === m.type) ? withSubtypes(ontology, m.type) : undefined;
        for (const [key, raw] of Object.entries(m.keys ?? {})) {
          if (!raw.trim()) continue;
          // Tidied as the kind's detail would be ("9 400 117" is 9400117), when the kind is known.
          const def = kinds?.flatMap((k) => detailsOf(ontology, k)).find((d) => d.key === key && d.identity);
          const value = def ? normaliseDetail(def, raw) : raw.trim();
          for (const e of await store.byKey(key, value, floors)) found.set(e.id, { entity: e.id, why: 'key', detail: def?.label ?? key });
        }
        for (const e of await store.byName(m.text, floors, kinds)) {
          if (!found.has(e.id)) found.set(e.id, { entity: e.id, why: e.label.toLowerCase() === m.text.toLowerCase() ? 'name' : 'alias' });
        }
        for (const s of await store.bySpelling(m.text, floors, { types: kinds, without: [...found.keys()] })) {
          found.set(s.entity.id, { entity: s.entity.id, why: 'similar', detail: s.close, score: Math.round(s.score * 100) / 100 });
        }
        matches.set(m.key, [...found.values()].slice(0, MOST));
      }

      let why: string | undefined;
      let meaning = false;
      if (!store.can.meaning) why = 'Matching by meaning needs pgvector in the database, which this server hasn’t got.';
      else if (!embed) why = 'Matching by meaning is off: Data Atlas hasn’t been told where the model gateway is (MODELS_URL).';
      else {
        try {
          const vectors: number[][] = [];
          for (let i = 0; i < mentions.length; i += BATCH) {
            const got = await embed(mentions.slice(i, i + BATCH).map((m) => mentionText(ontology, m)), workspace);
            model = got.model;
            vectors.push(...got.vectors);
          }
          await catchUp(ontology).catch(() => 0);
          for (const [i, m] of mentions.entries()) {
            const found = matches.get(m.key)!;
            if (found.length >= MOST) continue;
            const kinds = m.type && ontology.types.some((t) => t.key === m.type) ? withSubtypes(ontology, m.type) : undefined;
            const near = await store.byMeaning(vectors[i], model!, floors, { types: kinds, without: found.map((f) => f.entity), limit: MOST - found.length });
            found.push(...near.map((n) => ({ entity: n.entity.id, why: 'meaning' as const, score: Math.round(n.score * 100) / 100 })));
          }
          meaning = true;
        } catch (err) {
          why = `Matching by meaning is off: ${refusal(err)}`;
        }
      }
      const spellingWhy = store.can.spelling ? undefined : 'Matching names spelt nearly alike needs pg_trgm in the database, which this server hasn’t got.';
      return {
        matches,
        matching: { spelling: store.can.spelling, meaning, ...(spellingWhy || why ? { why: [spellingWhy, why].filter(Boolean).join(' ') } : {}), at: now().toISOString() },
      };
    },
  };
};
