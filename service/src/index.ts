import { appCredentialsFromEnv, appStorageFromEnv, commonSettings, embedTexts, followEvents, loadConfigOrExit, outboxRelay, startAppService } from '@augur/service-kit';
import { buildApp } from './app.ts';
import { FOLLOWED, follower } from './follow.ts';
import { manifest } from './manifest.ts';
import { PgAtlasStore } from './store.ts';

// Every setting Data Atlas reads, checked before it starts (in production, a missing one stops it).
loadConfigOrExit(manifest.id, [
  commonSettings.database,
  commonSettings.registry,
  commonSettings.events,
  commonSettings.issuer,
  commonSettings.issuerInside,
  commonSettings.clientSecret,
  commonSettings.gateway,
  // Optional: without it Triage matches by keys, names and spelling, and says matching by meaning is off.
  { ...commonSettings.models, required: false },
  // Optional: the base map, a PMTiles file inside the container (augur ADR 0071). Without it, points go on a plain background.
  { name: 'ATLAS_MAP_TILES', about: 'the path of the PMTiles file the map draws its base map from', required: false },
  { name: 'ATLAS_MAP_ATTRIBUTION', about: 'the credit the base map’s data needs (default © OpenStreetMap contributors)', required: false },
]);

// The graph lives in Postgres, in Data Atlas's own schema (docs/app-storage.md). There is no stand-in:
// its queries are the point, so under pnpm dev:app point DATABASE_URL at any Postgres you have.
const { databaseUrl } = appStorageFromEnv();
if (!databaseUrl) throw new Error('Data Atlas keeps its graph in Postgres: set DATABASE_URL (any Postgres 16 or later will do under pnpm dev:app).');
const store = await PgAtlasStore.connect(databaseUrl);
const credentials = appCredentialsFromEnv(manifest.id);
// Matching by meaning in Triage: vectors from the model gateway, asked for as Data Atlas (models:use).
const { MODELS_URL } = process.env;
const embed =
  MODELS_URL && credentials
    ? async (input: string[], workspace?: string) => embedTexts({ modelsUrl: MODELS_URL, credentials, workspace, input })
    : undefined;
// The starter listens, gives the registry this version's frontend, puts Data Atlas in the catalogue and
// stops cleanly on SIGTERM. It signs in as itself with SERVICE_CLIENT_SECRET (issued for it by an admin in
// Admin, Apps, or by the app runner when it installs the app).
const { ATLAS_MAP_TILES, ATLAS_MAP_ATTRIBUTION } = process.env;
const map = { ...(ATLAS_MAP_TILES ? { tiles: ATLAS_MAP_TILES } : {}), ...(ATLAS_MAP_ATTRIBUTION ? { attribution: ATLAS_MAP_ATTRIBUTION } : {}) };
const app = await startAppService({ manifest, buildApp: () => buildApp({ store, embed, map }) });

// Tell other apps what happened (atlas.entity.*), from the outbox, once each change has committed.
const { EVENTS_URL } = process.env;
if (EVENTS_URL && credentials) {
  outboxRelay({ pool: PgAtlasStore.outboxPool(databaseUrl), eventsUrl: EVENTS_URL, credentials, onError: (err) => app.log.error({ err: (err as Error).message }, 'could not send events') }).start();
  // Follow Mandate's bindings (used by) and Artifacts' withdrawals (retraction), from where it left off.
  followEvents({
    eventsUrl: EVENTS_URL,
    credentials,
    topics: FOLLOWED,
    cursor: { load: () => store.eventCursor(), save: (seq) => store.saveEventCursor(seq) },
    handle: follower(store),
    onError: (err) => app.log.error({ err: (err as Error).message }, 'could not follow events'),
  }).start();
} else {
  app.log.info('EVENTS_URL or the app’s sign-in is not set, so Data Atlas’s events wait in its outbox, and it follows no other app’s.');
}
