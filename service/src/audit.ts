import { appCredentialsFromEnv, recordAudit } from '@augur/service-kit';

/** Something Data Atlas puts in the platform's audit log: who did what to which entity, on which floor. */
export interface AtlasAuditEntry {
  actor: string;
  action: string;
  target: string;
  workspace: string;
  detail?: Record<string, unknown>;
}

export type Audit = (entry: AtlasAuditEntry) => Promise<void>;

/**
 * Writes to the platform's audit log as Data Atlas (the `audit:write` scope), or,
 * with no EVENTS_URL or sign-in as under `pnpm dev:app`, only to its own log.
 */
export const auditFromEnv = (log: (entry: AtlasAuditEntry) => void, env = process.env): Audit => {
  const credentials = appCredentialsFromEnv('atlas', env);
  const eventsUrl = env.EVENTS_URL;
  if (!eventsUrl || !credentials) return async (entry) => log(entry);
  return ({ actor, action, target, workspace, detail }) =>
    recordAudit({ eventsUrl, credentials, workspace, entry: { actor: { id: actor, kind: 'user' }, app: 'atlas', action, target, ...(detail ? { detail } : {}) } });
};
