import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync, getInfoAsync } from 'expo-file-system/legacy';
import { FaceTemplate } from '../types';
import { logger } from '../utils/logger';
import { SQLiteStore } from './SQLiteStore';

const LEGACY_STORE_KEY = 'FACE_AUTH_TEMPLATES';
const INDEX_KEY = 'FACE_AUTH_TEMPLATES_INDEX_V2';
const TEMPLATE_KEY_PREFIX = 'FACE_AUTH_TEMPLATE_';

const templatesDir = new Directory(Paths.document, 'face_templates');
const backupDir = new Directory(Paths.document, 'offline_backup');
const backupImagesDir = new Directory(backupDir, 'images');

export class OfflineStore {
  /**
   * Helper to ensure the face_templates image directory exists on local SSD.
   */
  private static ensureImagesDir(): void {
    try {
      if (!templatesDir.exists) {
        templatesDir.create();
      }
    } catch (e) {
      logger.warn('Failed to ensure images directory on local SSD', e);
    }
  }

  /**
   * Saves/copies a face image to local SSD storage (handles file://, http(s)://, and base64 data URIs).
   */
  static async saveTemplateImage(id: string, sourceUri: string): Promise<string | null> {
    try {
      this.ensureImagesDir();
      const destFile = new File(templatesDir, `${id}.jpg`);
      const targetUri = destFile.uri.startsWith('file://') ? destFile.uri : `file://${destFile.uri}`;

      // 1. Handle HTTP / HTTPS Remote S3 URLs
      if (sourceUri.startsWith('http://') || sourceUri.startsWith('https://')) {
        await File.downloadFileAsync(sourceUri, destFile, { idempotent: true });
        return targetUri;
      }

      // 2. Handle Base64 Data URIs or raw base64 strings
      if (sourceUri.startsWith('data:') || !sourceUri.includes('://')) {
        const base64Data = sourceUri.includes(',') ? sourceUri.split(',')[1] : sourceUri;
        await destFile.write(base64Data);
        return targetUri;
      }

      // 3. Handle Local file:// URIs with native copyAsync
      const srcUri = sourceUri.startsWith('file://') ? sourceUri : `file://${sourceUri}`;
      await copyAsync({ from: srcUri, to: targetUri });
      return targetUri;
    } catch (e) {
      logger.warn('Failed to save face image to local SSD', e);
      return null;
    }
  }

  /**
   * Fetches local SSD image URI for a given template ID.
   */
  static async getImageUri(id: string): Promise<string | null> {
    try {
      this.ensureImagesDir();
      const destFile = new File(templatesDir, `${id}.jpg`);
      const targetUri = destFile.uri.startsWith('file://') ? destFile.uri : `file://${destFile.uri}`;
      const info = await getInfoAsync(targetUri);
      if (info.exists) {
        return targetUri;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Deletes template image file from local SSD storage.
   */
  static async deleteTemplateImage(id: string): Promise<void> {
    try {
      const file = new File(templatesDir, `${id}.jpg`);
      if (file.exists) {
        file.delete();
      }
    } catch (e) {
      logger.warn(`Failed to delete template image ${id}`, e);
    }
  }

  /**
   * Auto-migrates legacy SecureStore JSON string records into high-performance SQLite binary Float32Array BLOBs.
   */
  private static async migrateLegacyIfNeeded(): Promise<void> {
    try {
      const rawIndex = await SecureStore.getItemAsync(INDEX_KEY);
      if (rawIndex) {
        const index: string[] = JSON.parse(rawIndex);
        let count = 0;
        for (const id of index) {
          const raw = await SecureStore.getItemAsync(`${TEMPLATE_KEY_PREFIX}${id}`);
          if (raw) {
            const template: FaceTemplate = JSON.parse(raw);
            await SQLiteStore.saveTemplate(template);
            await SecureStore.deleteItemAsync(`${TEMPLATE_KEY_PREFIX}${id}`);
            count++;
          }
        }
        await SecureStore.deleteItemAsync(INDEX_KEY);
        logger.info(`Migrated ${count} templates from SecureStore to SQLite Float32Array BLOB store.`);
      }

      const legacyData = await SecureStore.getItemAsync(LEGACY_STORE_KEY);
      if (legacyData) {
        const templates: FaceTemplate[] = JSON.parse(legacyData);
        for (const template of templates) {
          if (template?.id) {
            await SQLiteStore.saveTemplate(template);
          }
        }
        await SecureStore.deleteItemAsync(LEGACY_STORE_KEY);
        logger.info(`Migrated single-key legacy store to SQLite Float32Array BLOB store.`);
      }
    } catch (e) {
      logger.error('Error migrating legacy templates store to SQLite', e);
    }
  }

  /**
   * Retrieves all saved templates using fast binary SQLite BLOB reads.
   */
  static async getTemplates(): Promise<FaceTemplate[]> {
    try {
      await this.migrateLegacyIfNeeded();
      return await SQLiteStore.getTemplates();
    } catch (e) {
      logger.error('Error reading templates from SQLite store', e);
      return [];
    }
  }

  /**
   * Saves or updates a template in the high-performance binary SQLite BLOB store.
   */
  static async saveTemplate(template: FaceTemplate): Promise<void> {
    try {
      await this.migrateLegacyIfNeeded();
      await SQLiteStore.saveTemplate(template);
    } catch (e) {
      logger.error('Error saving template to SQLite store', e);
      throw e;
    }
  }

  /**
   * Marks a template as synced locally in SQLite.
   */
  static async markSynced(id: string): Promise<void> {
    try {
      await this.migrateLegacyIfNeeded();
      await SQLiteStore.markSynced(id);
    } catch (e) {
      logger.error('Error marking template synced in SQLite store', e);
      throw e;
    }
  }

  /**
   * Merges imported cloud templates into local SQLite storage.
   */
  static async mergeCloudTemplates(cloudTemplates: FaceTemplate[]): Promise<number> {
    try {
      const existing = await this.getTemplates();
      const existingIds = new Set(existing.map((t) => t.id));
      let added = 0;

      for (const template of cloudTemplates) {
        if (!existingIds.has(template.id)) {
          await this.saveTemplate({ ...template, isSynced: true });
          added++;
        }
      }

      return added;
    } catch (e) {
      logger.error('Error merging cloud templates', e);
      return 0;
    }
  }

  /**
   * Deletes only templates already synced to AWS from SQLite.
   */
  static async purgeSynced(): Promise<number> {
    try {
      await this.migrateLegacyIfNeeded();
      return await SQLiteStore.purgeSynced();
    } catch (e) {
      logger.error('Error purging synced templates from SQLite store', e);
      return 0;
    }
  }

  /**
   * Deletes a template by ID from SQLite store and deletes local SSD crop image.
   */
  static async deleteTemplate(id: string): Promise<void> {
    try {
      await this.migrateLegacyIfNeeded();
      await SQLiteStore.deleteTemplate(id);
      await this.deleteTemplateImage(id);
    } catch (e) {
      logger.error(`Error deleting template ${id}`, e);
    }
  }

  /**
   * Clears all saved templates, images, and SQLite databases.
   */
  static async clearAll(): Promise<void> {
    try {
      const templates = await this.getTemplates();
      for (const t of templates) {
        await this.deleteTemplateImage(t.id);
      }
      await SQLiteStore.clearAll();
      await SecureStore.deleteItemAsync(INDEX_KEY);
      await SecureStore.deleteItemAsync(LEGACY_STORE_KEY);
      if (backupDir.exists) {
        backupDir.delete();
      }
    } catch (e) {
      logger.error('Error clearing all templates', e);
    }
  }

  /**
   * Manually exports all current templates & face images to local SSD backup storage.
   */
  static async saveOfflineBackupToSSD(): Promise<{ templatesCount: number; imagesCount: number }> {
    try {
      if (!backupDir.exists) backupDir.create();
      if (!backupImagesDir.exists) backupImagesDir.create();

      const templates = await this.getTemplates();
      let imagesSaved = 0;

      for (const t of templates) {
        const srcFile = new File(templatesDir, `${t.id}.jpg`);
        if (srcFile.exists) {
          const destFile = new File(backupImagesDir, `${t.id}.jpg`);
          srcFile.copy(destFile);
          imagesSaved++;
        }
      }

      const backupFile = new File(backupDir, 'templates_backup.json');
      backupFile.write(JSON.stringify(templates));

      logger.info(`SSD Offline Backup complete: ${templates.length} templates, ${imagesSaved} images.`);
      return { templatesCount: templates.length, imagesCount: imagesSaved };
    } catch (e) {
      logger.error('Error saving offline SSD backup', e);
      throw e;
    }
  }

  /**
   * Restores offline SSD backup into active SQLite store if needed.
   */
  static async restoreOfflineBackupFromSSD(): Promise<{ restoredTemplates: number }> {
    try {
      const backupFile = new File(backupDir, 'templates_backup.json');
      if (!backupFile.exists) return { restoredTemplates: 0 };

      const content = await backupFile.text();
      const templates: FaceTemplate[] = JSON.parse(content);
      let restored = 0;

      for (const t of templates) {
        await this.saveTemplate(t);
        const backupImg = new File(backupImagesDir, `${t.id}.jpg`);
        if (backupImg.exists) {
          const activeImg = new File(templatesDir, `${t.id}.jpg`);
          backupImg.copy(activeImg);
        }
        restored++;
      }

      logger.info(`Restored ${restored} templates from SSD backup.`);
      return { restoredTemplates: restored };
    } catch (e) {
      logger.error('Error restoring SSD backup', e);
      return { restoredTemplates: 0 };
    }
  }
}
