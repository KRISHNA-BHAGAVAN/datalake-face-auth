import { OfflineStore } from '../storage/OfflineStore';
import { SyncResult } from '../types';

const SYNC_API_URL = process.env.EXPO_PUBLIC_FACE_SYNC_API_URL;
const SYNC_API_KEY = process.env.EXPO_PUBLIC_FACE_SYNC_API_KEY;

export class SyncManager {
  /**
   * Uploads unsynced face templates to AWS. The Lambda de-duplicates against
   * the datalake (cosine match) so re-enrolled people don't create duplicate
   * rows. Locally we MARK templates synced rather than deleting them — that
   * keeps enrollment dedup and offline verify working. Use purgeLocal() to
   * remove the on-device copies as a separate, explicit step.
   */
  static async sync(): Promise<SyncResult> {
    const templates = await OfflineStore.getTemplates();
    const unsynced = templates.filter((t) => !t.isSynced);

    if (unsynced.length === 0) {
      return { synced: 0 };
    }

    if (!SYNC_API_URL) {
      return {
        synced: 0,
        error: 'Set EXPO_PUBLIC_FACE_SYNC_API_URL in .env to enable AWS sync.',
      };
    }

    try {
      const response = await fetch(SYNC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(SYNC_API_KEY ? { 'x-api-key': SYNC_API_KEY } : {}),
        },
        body: JSON.stringify({
          templates: unsynced.map((t) => ({
            id: t.id,
            embedding: t.embedding,
            createdAt: t.createdAt,
          })),
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Sync failed (${response.status}): ${body}`);
      }

      const result = await response.json().catch(() => ({}));
      const duplicates = Array.isArray(result?.duplicates)
        ? result.duplicates.length
        : 0;

      // Everything we sent now lives in the datalake (inserted or matched an
      // existing person), so mark all of it synced locally.
      for (const template of unsynced) {
        await OfflineStore.markSynced(template.id);
      }

      return {
        synced: typeof result?.synced === 'number' ? result.synced : unsynced.length,
        duplicates,
      };
    } catch (error) {
      console.error('SyncManager: Sync failed', error);
      return {
        synced: 0,
        error: error instanceof Error ? error.message : 'Sync failed',
      };
    }
  }

  /**
   * Deletes on-device copies of templates already synced to AWS. Unsynced
   * templates are left untouched. Returns the number purged.
   */
  static async purgeLocal(): Promise<number> {
    return OfflineStore.purgeSynced();
  }
}
