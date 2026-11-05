import { useEffect, useRef, useState } from 'react';
import { Button, State } from '@augur/app-kit';
import { detailsOf, isA, type AtlasApi, type MapInfo, type MapPoint, type MapPoints, type Ontology } from './api.js';
import { canDraw } from './explorer.js';

/**
 * The map (augur ADR 0071). MapLibre GL JS draws it and PMTiles reads the
 * deployment's own base map file through the gateway, a range at a time, so
 * nothing is fetched from outside the deployment. Both are large, so they load
 * only when a map first opens, and once. Without a base map file, the points go
 * on a plain background and the map says why.
 */
type MapLibre = typeof import('maplibre-gl');
type PMTilesModule = typeof import('pmtiles');
let loading: Promise<{ ml: MapLibre; pm: PMTilesModule; css: string }> | undefined;
const libraries = () =>
  (loading ??= Promise.all([import('maplibre-gl'), import('pmtiles'), import('maplibre-gl/dist/maplibre-gl.css?inline')]).then(
    // MapLibre's build may come as one default export: take whichever it gives.
    ([ml, pm, css]) => ({ ml: ((ml as unknown as { default?: MapLibre }).default ?? ml) as MapLibre, pm, css: css.default }),
    (err: unknown) => {
      loading = undefined;
      throw err;
    },
  ));

/** The one name the base map is known by inside MapLibre: pmtiles://atlas-base. */
const BASE_KEY = 'atlas-base';
let protocolAdded = false;

/** The colours the map draws with, read from the kit's tokens where it sits. */
interface MapLook {
  ground: string;
  land: string;
  water: string;
  line: string;
}

/** A token as a colour WebGL can take: the browser resolves the variable, whatever form the token file writes it in. */
const colourOf = (el: Element, token: string) => {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  probe.hidden = true;
  el.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
};

const lookOf = (el: Element): MapLook => ({
  ground: colourOf(el, 'surface-inset'),
  land: colourOf(el, 'surface-pane'),
  water: colourOf(el, 'slate-deep'),
  line: colourOf(el, 'hairline-strong'),
});

/**
 * The style, written here from the tokens. The base map's layers follow the
 * Protomaps basemap's names (earth, water, roads, boundaries), which is what
 * `pmtiles extract` of a Protomaps build gives. It draws no text, which would
 * need a second file of glyphs: names on the map are the entities' own markers.
 */
const styleOf = (look: MapLook, info: MapInfo) => ({
  version: 8 as const,
  sources: info.tiles ? { base: { type: 'vector' as const, url: `pmtiles://${BASE_KEY}`, attribution: info.attribution } } : {},
  layers: [
    { id: 'ground', type: 'background' as const, paint: { 'background-color': look.ground } },
    ...(info.tiles
      ? [
          { id: 'earth', type: 'fill' as const, source: 'base', 'source-layer': 'earth', paint: { 'fill-color': look.land } },
          { id: 'water', type: 'fill' as const, source: 'base', 'source-layer': 'water', paint: { 'fill-color': look.water } },
          { id: 'roads', type: 'line' as const, source: 'base', 'source-layer': 'roads', paint: { 'line-color': look.line, 'line-width': 0.6 } },
          { id: 'boundaries', type: 'line' as const, source: 'base', 'source-layer': 'boundaries', paint: { 'line-color': look.line, 'line-width': 1, 'line-dasharray': [2, 2] } },
        ]
      : []),
  ],
});

/** Whether an entity of this kind can be on the map: it has a place detail, or a link to kinds that do (a vessel located at a port). */
export const canBePlaced = (ontology: Ontology, type: string) => {
  const placed = (t: string) => detailsOf(ontology, t).some((d) => d.kind === 'place');
  return placed(type) || ontology.relations.some((r) => r.from.some((k) => isA(ontology, type, k)) && r.to.every(placed));
};

/** How many entities were asked for but aren't on the map, and why, in words. */
export const offMap = ({ unplaced, hidden }: Pick<MapPoints, 'unplaced' | 'hidden'>) =>
  [unplaced ? `${unplaced} with no point to show` : '', hidden ? `${hidden} that can’t be seen from this floor` : ''].filter(Boolean).join(' and ');

/** Where a point comes from, in words, for its marker and the list. */
export const pointLine = (p: MapPoint) => (p.via ? `At ${p.via.label}` : `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`);

export interface AtlasMapProps {
  api: AtlasApi;
  /** The entities to place, as the page has them. */
  entities: string[];
  /** Where they were at this time; now when absent. */
  at?: string;
  onOpenEntity(id: string): void;
  /** What the map is of, for screen readers: "the graph around Skarv". */
  about: string;
}

/** Entities on the map, with the same points as a list beside it for keyboards and screen readers. */
export function AtlasMap({ api, entities, at, onOpenEntity, about }: AtlasMapProps) {
  const drawable = useState(canDraw)[0];
  const [info, setInfo] = useState<MapInfo>();
  const [found, setFound] = useState<MapPoints>();
  const [error, setError] = useState('');
  const [drawError, setDrawError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  // The page's handler may be new each render; the map is drawn once per answer, so it reads the latest.
  const opening = useRef(onOpenEntity);
  opening.current = onOpenEntity;
  const key = JSON.stringify([entities, at]);

  useEffect(() => {
    let live = true;
    setError('');
    Promise.all([api.mapInfo(), entities.length ? api.mapPoints(entities, at) : Promise.resolve<MapPoints>({ points: [], unplaced: 0, hidden: 0 })]).then(
      ([i, p]) => {
        if (!live) return;
        setInfo(i);
        setFound(p);
      },
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
    // The ask is its words: the same entities and time aren't asked for twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, attempt]);

  useEffect(() => {
    const el = holder.current;
    if (!el || !drawable || !info || !found?.points.length) return;
    let map: import('maplibre-gl').Map | undefined;
    let live = true;
    setDrawError('');
    libraries().then(
      ({ ml, pm, css }) => {
        if (!live) return;
        // Once per document (or shadow root) the app is drawn in, not once per map opened.
        const root = el.getRootNode() as Document | ShadowRoot;
        if (!root.querySelector('style[data-maplibre]')) {
          const style = document.createElement('style');
          style.dataset.maplibre = '';
          style.textContent = css;
          el.before(style);
        }
        if (info.tiles && !protocolAdded) {
          const protocol = new pm.Protocol();
          protocol.add(new pm.PMTiles({ getKey: () => BASE_KEY, getBytes: async (offset, length, signal) => ({ data: await api.mapBytes(offset, length, signal) }) }));
          ml.addProtocol('pmtiles', protocol.tile);
          protocolAdded = true;
        }
        const look = lookOf(el);
        const bounds = new ml.LngLatBounds();
        for (const p of found.points) bounds.extend([p.lon, p.lat]);
        map = new ml.Map({ container: el, style: styleOf(look, info) as import('maplibre-gl').StyleSpecification, bounds, fitBoundsOptions: { padding: 48, maxZoom: 12 }, attributionControl: { compact: true } });
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        for (const p of found.points) {
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.className = 'atlas-map-mark';
          mark.textContent = p.label;
          mark.title = `${p.label}: ${pointLine(p)}`;
          mark.addEventListener('click', () => opening.current(p.entity));
          new ml.Marker({ element: mark, anchor: 'left' }).setLngLat([p.lon, p.lat]).addTo(map);
        }
      },
      () => live && setDrawError('The map couldn’t be loaded, so its points are listed instead. Try again in a moment.'),
    );
    return () => {
      live = false;
      map?.remove();
    };
  }, [drawable, info, found, api]);

  if (error) return <State kind="error" heading="Couldn’t open the map" body={error} action="Try again" onAction={() => setAttempt((n) => n + 1)} />;
  if (!info || !found) return <State kind="loading" heading="Opening the map…" />;
  const away = offMap(found);
  if (!found.points.length)
    return <State heading="Nothing here has a place on the map" body={`${away ? `Of what’s here, ${away}.` : 'Nothing was asked for.'} A place shows once its Location is a point, such as 57.70, 11.97.`} />;
  return (
    <div className="atlas-map">
      {!info.tiles && info.why ? <p className="atlas-note">{info.why}</p> : null}
      {!drawable ? <p className="atlas-note">This browser can’t draw the map (it needs WebGL), so its points are listed.</p> : null}
      {drawError ? (
        <p className="atlas-note atlas-refused" role="alert">
          {drawError}{' '}
          <Button kind="ghost" size="sm" onPress={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </p>
      ) : null}
      {drawable && !drawError ? <div ref={holder} className="atlas-map-canvas" role="img" aria-label={`A map of ${about}. The same points are listed below it.`} /> : null}
      {away ? <p className="atlas-note">Not on the map: {away}.</p> : null}
      <ul className="atlas-map-list" aria-label="On the map">
        {found.points.map((p) => (
          <li key={p.entity}>
            <Button kind="ghost" size="sm" onPress={() => onOpenEntity(p.entity)}>
              {p.label}
            </Button>
            <span className="atlas-note">{pointLine(p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
