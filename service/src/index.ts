import { readFileSync } from 'node:fs';
import { appDatabaseFromEnv, readManifest, startAppService } from '@augur/service-kit';
import { buildApp } from './app.ts';
import { memoryEvents, postgresEvents } from './events.ts';
import { memoryFollows, postgresFollows } from './follows.ts';

// The inbound part (score/web.score.yaml): builds the service, listens on PORT and stops cleanly on
// SIGTERM. It reaches AUGUR only through the gateway (GATEWAY_URL), and checks callers with the
// gateway's keys (CALLER_KEYS_URL). On contract 3 the runner registers the app, not the part.

// The app's own sign-in arrives as a file (score/web.score.yaml); the service kit reads SERVICE_CLIENT_SECRET.
const secretFile = process.env.SERVICE_CLIENT_SECRET_FILE;
if (secretFile && !process.env.SERVICE_CLIENT_SECRET) process.env.SERVICE_CLIENT_SECRET = readFileSync(secretFile, 'utf8').trim();

// Identity through the gateway (the `people:read` scope), for the names of people who wrote reports.
if (!process.env.IDENTITY_URL && process.env.GATEWAY_URL) process.env.IDENTITY_URL = `${process.env.GATEWAY_URL.replace(/\/+$/, '')}/api/identity`;

const manifest = readManifest(import.meta.url);
const db = appDatabaseFromEnv(manifest.id);
if (!db) console.log(`No DATABASE_HOST, so ${manifest.name} keeps the events it is sent and what people follow in memory (fine under pnpm dev:app).`);
const events = db ? postgresEvents(db.pool) : memoryEvents();
const follows = db ? postgresFollows(db.pool) : memoryFollows();
await startAppService({ manifest, buildApp: ({ jobs }) => buildApp({ manifest, jobs, events, follows }) });
