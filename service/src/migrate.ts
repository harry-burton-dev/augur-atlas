import { PgAtlasStore } from './store.ts';

// Brings Data Atlas's schema up to date and stops.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to the Postgres to migrate.');
const store = await PgAtlasStore.connect(url);
await store.close();
