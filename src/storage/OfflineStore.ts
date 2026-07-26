import * as SecureStore from 'expo-secure-store';
import { FaceTemplate } from '../types';
import { logger } from '../utils/logger';

const LEGACY_STORE_KEY = 'FACE_AUTH_TEMPLATES';
const INDEX_KEY = 'FACE_AUTH_TEMPLATES_INDEX_V2';
const TEMPLATE_KEY_PREFIX = 'FACE_AUTH_TEMPLATE_';

export class OfflineStore {
  /**
   * Helper to fetch index array of saved template IDs.
   */
  private static async getIndex(): Promise<string[]> {
    try {
      const data = await SecureStore.getItemAsync(INDEX_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      logger.error('Error reading template index', e);
      return [];
    }
  }

  /**
   * Helper to write index array of template IDs.
   */
  private static async saveIndex(index: string[]): Promise<void> {
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(index));
  }

  /**
   * Auto-migrates legacy single-key JSON array format into chunked key-per-template format.
   * Prevents SecureStore payload limit crashes (Android ~2KB limit per entry).
   */
  private static async migrateLegacyIfNeeded(): Promise<void> {
    try {
      const legacyData = await SecureStore.getItemAsync(LEGACY_STORE_KEY);
      if (!legacyData) return;

      const templates: FaceTemplate[] = JSON.parse(legacyData);
      const index: string[] = [];

      for (const template of templates) {
        if (template?.id) {
          const itemKey = `${TEMPLATE_KEY_PREFIX}${template.id}`;
          await SecureStore.setItemAsync(itemKey, JSON.stringify(template));
          index.push(template.id);
        }
      }

      await this.saveIndex(index);
      await SecureStore.deleteItemAsync(LEGACY_STORE_KEY);
      logger.info(`Migrated ${templates.length} templates from legacy single-key store to chunked store.`);
    } catch (e) {
      logger.error('Error migrating legacy templates store', e);
    }
  }

  /**
   * Retrieves all saved templates using fast concurrent chunked reads.
   */
  static async getTemplates(): Promise<FaceTemplate[]> {
    try {
      await this.migrateLegacyIfNeeded();
      const index = await this.getIndex();
      if (index.length === 0) return [];

      const rawItems = await Promise.all(
        index.map(async (id) => {
          try {
            const raw = await SecureStore.getItemAsync(`${TEMPLATE_KEY_PREFIX}${id}`);
            return raw ? (JSON.parse(raw) as FaceTemplate) : null;
          } catch (e) {
            logger.error(`Error reading template chunk ${id}`, e);
            return null;
          }
        })
      );

      return rawItems.filter((t): t is FaceTemplate => t !== null);
    } catch (e) {
      logger.error('Error reading templates', e);
      return [];
    }
  }

  /**
   * Saves or updates a template in the chunked secure store.
   */
  static async saveTemplate(template: FaceTemplate): Promise<void> {
    try {
      await this.migrateLegacyIfNeeded();
      const index = await this.getIndex();

      const itemKey = `${TEMPLATE_KEY_PREFIX}${template.id}`;
      await SecureStore.setItemAsync(itemKey, JSON.stringify(template));

      if (!index.includes(template.id)) {
        index.push(template.id);
        await this.saveIndex(index);
      }
    } catch (e) {
      logger.error('Error saving template chunk', e);
      throw e;
    }
  }

  /**
   * Marks a template as synced locally.
   */
  static async markSynced(id: string): Promise<void> {
    try {
      await this.migrateLegacyIfNeeded();
      const itemKey = `${TEMPLATE_KEY_PREFIX}${id}`;
      const raw = await SecureStore.getItemAsync(itemKey);
      if (raw) {
        const template: FaceTemplate = JSON.parse(raw);
        template.isSynced = true;
        await SecureStore.setItemAsync(itemKey, JSON.stringify(template));
      }
    } catch (e) {
      logger.error('Error marking template synced', e);
      throw e;
    }
  }

  /**
   * Merges imported cloud templates into local storage.
   * Useful for pre-warming offline cache after local purge or on a new device.
   * Returns the count of newly added templates.
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
   * Deletes only templates already synced to AWS. Unsynced templates are kept.
   */
  static async purgeSynced(): Promise<number> {
    try {
      const existing = await this.getTemplates();
      const synced = existing.filter((t) => t.isSynced);

      for (const template of synced) {
        await this.deleteTemplate(template.id);
      }

      return synced.length;
    } catch (e) {
      logger.error('Error purging synced templates', e);
      return 0;
    }
  }

  /**
   * Deletes a template by ID chunk.
   */
  static async deleteTemplate(id: string): Promise<void> {
    try {
      await this.migrateLegacyIfNeeded();
      const index = await this.getIndex();
      const newIndex = index.filter((item) => item !== id);
      await this.saveIndex(newIndex);
      await SecureStore.deleteItemAsync(`${TEMPLATE_KEY_PREFIX}${id}`);
    } catch (e) {
      logger.error(`Error deleting template ${id}`, e);
    }
  }

  /**
   * Clears all saved templates and indexes.
   */
  static async clearAll(): Promise<void> {
    try {
      const index = await this.getIndex();
      for (const id of index) {
        await SecureStore.deleteItemAsync(`${TEMPLATE_KEY_PREFIX}${id}`);
      }
      await SecureStore.deleteItemAsync(INDEX_KEY);
      await SecureStore.deleteItemAsync(LEGACY_STORE_KEY);
    } catch (e) {
      logger.error('Error clearing all templates', e);
    }
  }
}
