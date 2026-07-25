import * as SecureStore from 'expo-secure-store';
import { FaceTemplate } from '../types';
import { logger } from '../utils/logger';

const STORE_KEY = 'FACE_AUTH_TEMPLATES';

export class OfflineStore {
  /**
   * Retrieves all saved templates.
   */
  static async getTemplates(): Promise<FaceTemplate[]> {
    try {
      const data = await SecureStore.getItemAsync(STORE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      logger.error('Error reading templates', e);
      return [];
    }
  }

  /**
   * Saves a new template to the local secure store.
   */
  static async saveTemplate(template: FaceTemplate): Promise<void> {
    try {
      const existing = await this.getTemplates();
      // Overwrite if same ID, or add new
      const updated = existing.filter(t => t.id !== template.id);
      updated.push(template);
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(updated));
    } catch (e) {
      logger.error('Error saving template', e);
      throw e;
    }
  }

  /**
   * Marks a template as synced without removing it. Keeping the embedding
   * locally lets enrollment dedup against already-synced people and keeps
   * offline verify working. Purging is now a separate, explicit action.
   */
  static async markSynced(id: string): Promise<void> {
    try {
      const existing = await this.getTemplates();
      const updated = existing.map((t) =>
        t.id === id ? { ...t, isSynced: true } : t
      );
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(updated));
    } catch (e) {
      logger.error('Error marking template synced', e);
      throw e;
    }
  }

  /**
   * Deletes only templates already synced to AWS. Unsynced templates are kept
   * so a purge never loses data that hasn't reached the datalake yet.
   */
  static async purgeSynced(): Promise<number> {
    try {
      const existing = await this.getTemplates();
      const remaining = existing.filter((t) => !t.isSynced);
      const removed = existing.length - remaining.length;
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(remaining));
      return removed;
    } catch (e) {
      logger.error('Error purging synced templates', e);
      return 0;
    }
  }

  /**
   * Deletes a template by ID
   */
  static async deleteTemplate(id: string): Promise<void> {
    try {
      const existing = await this.getTemplates();
      const updated = existing.filter(t => t.id !== id);
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(updated));
    } catch (e) {
      logger.error('Error deleting template', e);
    }
  }

  /**
   * Clears all templates
   */
  static async clearAll(): Promise<void> {
    await SecureStore.deleteItemAsync(STORE_KEY);
  }
}
