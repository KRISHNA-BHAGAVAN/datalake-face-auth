import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync, getInfoAsync } from 'expo-file-system/legacy';
import { FaceTemplate } from '../types';
import { logger } from '../utils/logger';
import { SQLiteStore } from './SQLiteStore';

const templatesDir = new Directory(Paths.document, 'face_templates');

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
   * Retrieves all saved templates using fast binary SQLite BLOB reads.
   */
  static async getTemplates(): Promise<FaceTemplate[]> {
    try {
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
    } catch (e) {
      logger.error('Error clearing all templates', e);
    }
  }

}
