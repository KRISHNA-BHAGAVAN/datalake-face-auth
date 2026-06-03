import { OfflineStore } from '../storage/OfflineStore';
import { SyncResult } from '../types';

const SYNC_API_URL = process.env.EXPO_PUBLIC_FACE_SYNC_API_URL;
const SYNC_API_KEY = process.env.EXPO_PUBLIC_FACE_SYNC_API_KEY;

export class SyncManager {
  /**
   * Uploads unsynced face templates to AWS (via API Gateway/Lambda) and purges local copies.
   */
  static async syncAndPurge(): Promise<SyncResult> {
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

      for (const template of unsynced) {
        await OfflineStore.deleteTemplate(template.id);
      }

      return { synced: unsynced.length };
    } catch (error) {
      console.error('SyncManager: Sync failed', error);
      return {
        synced: 0,
        error: error instanceof Error ? error.message : 'Sync failed',
      };
    }
  }
}
