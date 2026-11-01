import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appCredentialsFromEnv, appStorageFromEnv, commonSettings, embedTexts, followEvents, loadConfigOrExit, outboxRelay, publishFrontend, registerApp } from '@augur/service-kit';
import { buildApp } from './app.ts';
import { FOLLOWED, follower } from './follow.ts';
import { PgAtlasStore } from './store.ts';

// Every setting Data Atlas reads, checked before it starts (in production, a missing one stops it).
loadConfigOrExit('atlas', [
  commonSettings.database,
  commonSettings.registry,
  commonSettings.events,
  commonSettings.issuer,
  commonSettings.issuerInside,
  commonSettings.clientSecret,
  commonSettings.gateway,
  // Optional: without it Triage matches by keys, names and spelling, and says matching by meaning is off.
  { ...commonSettings.models, required: false },
]);

const port = Number(process.env.PORT ?? 8090);
// The graph lives in Postgres, in Data Atlas's own schema (docs/app-storage.md). There is no stand-in:
// its queries are the point, so under pnpm dev:app point DATABASE_URL at any Postgres you have.
const { databaseUrl } = appStorageFromEnv();
if (!databaseUrl) throw new Error('Data Atlas keeps its graph in Postgres: set DATABASE_URL (any Postgres 16 or later will do under pnpm dev:app).');
const store = await PgAtlasStore.connect(databaseUrl);
const credentials = appCredentialsFromEnv('atlas');
// Matching by meaning in Triage: vectors from the model gateway, asked for as Data Atlas (models:use).
const { MODELS_URL } = process.env;
const embed =
  MODELS_URL && credentials
    ? async (input: string[], workspace?: string) => embedTexts({ modelsUrl: MODELS_URL, credentials, workspace, input })
    : undefined;
const app = await buildApp({ store, embed });
await app.listen({ port, host: '0.0.0.0' });

// Put Data Atlas in the platform's catalogue, so the shell can offer it.
// It signs in as itself with SERVICE_CLIENT_SECRET (issued for it by an admin in Admin, Apps, or
// by the app runner when it installs the app). The build puts the manifest beside the code; from source
// it's in apps/atlas. A released image carries the built frontend too (APP_FRONTEND, or /app/frontend),
// which it gives the registry first, so the shell loads this version's own copy of it.
const { REGISTRY_URL, APP_MANIFEST, APP_FRONTEND } = process.env;
if (REGISTRY_URL && credentials) {
  const built = new URL('./manifest.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(APP_MANIFEST ?? (existsSync(built) ? built : new URL('../../manifest.json', import.meta.url)), 'utf8'));
  const frontend = APP_FRONTEND ?? fileURLToPath(new URL('../frontend/', import.meta.url));
  const giveFrontend = existsSync(join(frontend, 'entry.js'))
    ? publishFrontend({ registryUrl: REGISTRY_URL, credentials, app: manifest.id, version: manifest.version, dir: frontend })
        .then((kept) => app.log.info({ version: manifest.version, kept }, kept ? 'frontend kept by version' : 'this deployment doesn’t keep frontends by version'))
        .catch((err: Error) => app.log.error(err.message))
    : Promise.resolve();
  void giveFrontend
    .then(() => registerApp({ registryUrl: REGISTRY_URL, credentials, manifest }))
    .then(() => app.log.info({ app: manifest.id, version: manifest.version }, 'registered with the platform'))
    .catch((err: Error) => app.log.error(err.message));
} else {
  app.log.info('REGISTRY_URL or the app’s sign-in (SERVICE_CLIENT_SECRET) is not set, so Data Atlas is not in the catalogue (fine under pnpm dev:app).');
}

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
