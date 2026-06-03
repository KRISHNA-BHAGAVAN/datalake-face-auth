import * as SecureStore from 'expo-secure-store';
import { FaceTemplate } from '../types';

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
      console.error('Error reading templates', e);
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
      console.error('Error saving template', e);
      throw e;
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
      console.error('Error deleting template', e);
    }
  }

  /**
   * Clears all templates
   */
  static async clearAll(): Promise<void> {
    await SecureStore.deleteItemAsync(STORE_KEY);
  }
}
