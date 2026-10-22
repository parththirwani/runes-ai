import crypto from 'crypto';
import { SNAPSHOT_JOB_PREFIX } from './redis';

/** Keep a user's identical workspace snapshots tied to their own job. */
export function snapshotJobKey(userId: string, digest: string): string {
  return SNAPSHOT_JOB_PREFIX + crypto.createHash('sha256').update(userId + ':' + digest).digest('hex');
}
