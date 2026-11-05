import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { MapInfo, MapPoint, MapPoints, MapPointsQuery } from './api-types.ts';
import type { Atlas } from './knowledge.ts';
import { detailsOf, relationsFrom, type Ontology } from './ontology.ts';
import { parsePoint, type Point } from './points.ts';
import type { Entity } from './store.ts';

/** The base map's credit when the deployment names none: the data most PMTiles builds are made from asks for it (ODbL). */
export const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';

export interface MapOptions {
  /** Where the deployment's PMTiles file is, inside the container (ATLAS_MAP_TILES). */
  tiles?: string;
  /** The base map data's credit (ATLAS_MAP_ATTRIBUTION). */
  attribution?: string;
}

/** Most entities placed in one ask: an explorer's view, or a place and what's at it. */
const MOST = 500;

const NO_TILES = 'This deployment has no base map, so points are drawn on a plain background. An admin can add one by giving Data Atlas a PMTiles file (ATLAS_MAP_TILES; see the Data Atlas guide).';

/** The keys of an entity kind's details that hold places. */
const placeDetails = (ontology: Ontology, type: string) => detailsOf(ontology, type).filter((d) => d.kind === 'place');

/** An entity's own point: the first of its place details, typed on it, that's a point. */
const ownPoint = (ontology: Ontology, e: Entity): { point: Point; detail: string } | undefined => {
  for (const d of placeDetails(ontology, e.type)) {
    const point = d.onEntity !== false && e.details[d.key] ? parsePoint(e.details[d.key]) : undefined;
    if (point) return { point, detail: d.key };
  }
  return undefined;
};

/** One byte range of a file, from a Range header; undefined for the whole file, null for one that can't be served. */
export const byteRange = (header: string | undefined, size: number): { start: number; end: number } | undefined | null => {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
};

export const mapRoutes = (app: FastifyInstance, atlas: Atlas, { tiles, attribution = DEFAULT_ATTRIBUTION }: MapOptions) => {
  const { store } = atlas;
  /** The tile file's size, or why it can't be served. */
  const tileFile = async (): Promise<{ size: number } | { why: string }> => {
    if (!tiles) return { why: NO_TILES };
    try {
      const s = await stat(tiles);
      return s.isFile() ? { size: s.size } : { why: `The base map ATLAS_MAP_TILES names (${tiles}) isn’t a file. An admin can check the setting.` };
    } catch {
      return { why: `The base map ATLAS_MAP_TILES names (${tiles}) can’t be read, so points are drawn on a plain background. An admin can check the file is there.` };
    }
  };

  app.get('/map', async (req, reply): Promise<MapInfo | typeof reply> => {
    if (!atlas.onFloor(req, reply)) return reply;
    const file = await tileFile();
    return 'size' in file ? { tiles: true, attribution } : { tiles: false, attribution, why: file.why };
  });

  // The base map, read a range at a time by the map in the browser (PMTiles). Anyone who can open Data Atlas may read it.
  app.get('/map/tiles', async (req, reply) => {
    if (!atlas.onFloor(req, reply)) return reply;
    const file = await tileFile();
    if (!('size' in file)) return reply.code(404).send({ error: 'no-map', message: file.why });
    const range = byteRange(req.headers.range, file.size);
    reply.header('accept-ranges', 'bytes');
    if (range === null) return reply.code(416).header('content-range', `bytes */${file.size}`).send({ error: 'range', message: 'That part of the base map isn’t in the file.' });
    reply.header('cache-control', 'private, max-age=3600').type('application/octet-stream');
    if (!range) return reply.header('content-length', file.size).send(createReadStream(tiles!));
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${file.size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(tiles!, range));
  });

  app.post<{ Body: MapPointsQuery }>(
    '/map/points',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            entities: { type: 'array', minItems: 1, maxItems: MOST, items: { type: 'string', minLength: 1, maxLength: 64 } },
            at: { type: 'string', format: 'date-time' },
          },
          required: ['entities'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply): Promise<MapPoints | typeof reply> => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const { floors } = await atlas.sight(caller);
      const asked = [...new Set(req.body.entities)];
      const [ontology, found] = await Promise.all([store.ontology(), store.entitiesById(asked)]);
      const seen = found.filter((e) => e.state === 'active' && floors.includes(e.floor));
      const byId = new Map(seen.map((e) => [e.id, e]));
      const facts = await store.facts(
        seen.map((e) => e.id),
        { floors, ...(req.body.at ? { at: req.body.at } : {}) },
      );
      const points = new Map<string, MapPoint>();
      const place = (e: Entity, point: Point, detail: string, via?: MapPoint['via']) =>
        points.set(e.id, { entity: e.id, label: e.label, type: e.type, lat: point.lat, lon: point.lon, detail, ...(via ? { via } : {}) });

      for (const e of seen) {
        const own = ownPoint(ontology, e);
        if (own) place(e, own.point, own.detail);
      }
      // Next, a place known through facts (a position over time), the newest record first.
      for (const f of facts) {
        const e = byId.get(f.entity);
        if (!e || points.has(e.id) || f.value === undefined) continue;
        const def = placeDetails(ontology, e.type).find((d) => d.key === f.property);
        const point = def && parsePoint(f.value);
        if (point) place(e, point, f.property);
      }
      // Last, where it's linked to something that has a point of its own, through a link that ends at kinds with places.
      const unplaced = seen.filter((e) => !points.has(e.id));
      const links = facts.filter((f) => f.target && byId.has(f.entity) && !points.has(f.entity));
      const targets = new Map((await store.entitiesById([...new Set(links.map((f) => f.target!))])).filter((t) => t.state === 'active' && floors.includes(t.floor)).map((t) => [t.id, t]));
      for (const e of unplaced) {
        const placing = new Set(relationsFrom(ontology, e.type).filter((r) => r.to.every((t) => placeDetails(ontology, t).length)).map((r) => r.key));
        for (const f of links.filter((l) => l.entity === e.id && placing.has(l.property))) {
          const target = targets.get(f.target!);
          const own = target && ownPoint(ontology, target);
          if (!target || !own) continue;
          place(e, own.point, own.detail, { entity: target.id, label: target.label, relation: f.property });
          break;
        }
      }
      return { points: [...points.values()], unplaced: seen.length - points.size, hidden: asked.length - seen.length };
    },
  );
};
