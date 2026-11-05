import { readManifest } from '@augur/service-kit';

/** Data Atlas's manifest (APP_MANIFEST, the copy the build put beside the code, or the repository's). Its id is what it signs in and records as. */
export const manifest = readManifest(import.meta.url);
