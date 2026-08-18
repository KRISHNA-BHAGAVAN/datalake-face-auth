import { File } from 'expo-file-system';
import { OfflineStore } from '../storage/OfflineStore';
import { FaceTemplate, SyncResult } from '../types';
import { logger } from '../utils/logger';

const SYNC_API_URL = process.env.EXPO_PUBLIC_FACE_SYNC_API_URL;
const SYNC_API_KEY = process.env.EXPO_PUBLIC_FACE_SYNC_API_KEY;
const S3_BUCKET_NAME = process.env.EXPO_PUBLIC_S3_BUCKET_NAME;
const S3_REGION = process.env.EXPO_PUBLIC_S3_REGION || 'us-east-1';

export class SyncManager {
  /**
   * Helper to convert a local SSD image file to Base64 string for AWS S3 sync payload.
   */
  private static async getLocalImageBase64(templateId: string): Promise<string | null> {
    try {
      const uri = await OfflineStore.getImageUri(templateId);
      if (!uri) return null;

      const file = new File(uri);
      if (!file.exists) return null;

      const base64 = await file.base64();
      return base64 || null;
    } catch (e) {
      logger.warn(`Failed to read local image Base64 for template ${templateId}`, e);
      return null;
    }
  }

  /**
   * Uploads unsynced face templates and enrolled face images to AWS (Lambda + S3).
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
      // Build payload including template embedding vectors and face image Base64 data for S3
      const templatesPayload = await Promise.all(
        unsynced.map(async (t) => {
          const imageBase64 = await this.getLocalImageBase64(t.id);
          return {
            id: t.id,
            embedding: t.embedding,
            createdAt: t.createdAt,
            lastKnownLocation: t.lastKnownLocation || undefined,
            imageBase64: imageBase64 || undefined,
            s3Bucket: S3_BUCKET_NAME || undefined,
            s3Region: S3_REGION,
          };
        })
      );

      const response = await fetch(SYNC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(SYNC_API_KEY ? { 'x-api-key': SYNC_API_KEY } : {}),
        },
        body: JSON.stringify({ templates: templatesPayload }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Sync failed (${response.status}): ${body}`);
      }

      const result = await response.json().catch(() => ({}));
      const duplicates = Array.isArray(result?.duplicates) ? result.duplicates : [];
      const duplicateIds = new Set(duplicates.map((d: { newId: string }) => d.newId));

      // Mark only successfully synced templates (not duplicates) as synced
      for (const template of unsynced) {
        if (!duplicateIds.has(template.id)) {
          await OfflineStore.markSynced(template.id);
        }
      }

      return {
        synced: typeof result?.synced === 'number' ? result.synced : unsynced.length,
        duplicates: duplicates.length,
      };
    } catch (error) {
      logger.error('SyncManager: Sync failed', error);
      return {
        synced: 0,
        error: error instanceof Error ? error.message : 'Sync failed',
      };
    }
  }

  /**
   * Downloads enrolled face templates and face images from AWS cloud datalake and merges them locally.
   */
  static async downloadCloudTemplates(): Promise<{ downloaded: number; added: number; error?: string }> {
    if (!SYNC_API_URL) {
      return {
        downloaded: 0,
        added: 0,
        error: 'Set EXPO_PUBLIC_FACE_SYNC_API_URL in .env to enable AWS sync.',
      };
    }

    try {
      const response = await fetch(SYNC_API_URL, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(SYNC_API_KEY ? { 'x-api-key': SYNC_API_KEY } : {}),
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Cloud download failed (${response.status}): ${body}`);
      }

      const result = await response.json().catch(() => ({}));
      const rawTemplates = Array.isArray(result?.templates) ? result.templates : [];

      const templates: FaceTemplate[] = [];

      for (const item of rawTemplates) {
        const id = String(item.id || `cloud-${Date.now()}`);
        const embedding = Array.isArray(item.embedding) ? item.embedding : [];

        // Save downloaded face image to local SSD if available in payload
        if (item.imageBase64) {
          const tempUri = `data:image/jpeg;base64,${item.imageBase64}`;
          await OfflineStore.saveTemplateImage(id, tempUri).catch((e) =>
            logger.warn(`Failed to save cloud image for ${id}`, e)
          );
        } else if (item.imageUrl) {
          await OfflineStore.saveTemplateImage(id, item.imageUrl).catch((e) =>
            logger.warn(`Failed to download cloud image for ${id}`, e)
          );
        }

        templates.push({
          id,
          embedding,
          createdAt: Number(item.createdAt || Date.now()),
          isSynced: true,
          lastKnownLocation: item.lastKnownLocation || undefined,
        });
      }

      const added = await OfflineStore.mergeCloudTemplates(templates);

      return {
        downloaded: templates.length,
        added,
      };
    } catch (error) {
      logger.error('SyncManager: Cloud download failed', error);
      return {
        downloaded: 0,
        added: 0,
        error: error instanceof Error ? error.message : 'Cloud download failed',
      };
    }
  }

  /**
   * Deletes on-device copies of templates already synced to AWS.
   */
  static async purgeLocal(): Promise<number> {
    return OfflineStore.purgeSynced();
  }
}
