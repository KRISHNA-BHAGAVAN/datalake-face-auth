import * as SQLite from 'expo-sqlite';
import { FaceTemplate, LocationData } from '../types';
import { logger } from '../utils/logger';

const DB_NAME = 'face_auth_v2.db';

export class SQLiteStore {
  private static dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

  private static getDB(): Promise<SQLite.SQLiteDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          CREATE TABLE IF NOT EXISTS face_templates (
            id TEXT PRIMARY KEY NOT NULL,
            embedding BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            is_synced INTEGER NOT NULL DEFAULT 0,
            embeddings_json TEXT,
            last_known_location TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_is_synced ON face_templates(is_synced);
        `);

        // Migration helper: add last_known_location column if table exists without it
        try {
          await db.execAsync('ALTER TABLE face_templates ADD COLUMN last_known_location TEXT;');
        } catch (e) {
          // Column already exists, ignore error
        }

        return db;
      })();
    }
    return this.dbPromise;
  }

  /**
   * Converts a number[] or Float32Array embedding into a compact 768-byte (192-dim) binary Uint8Array BLOB.
   */
  private static arrayToBlobBuffer(embedding: number[] | Float32Array): Uint8Array {
    const f32 = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
    return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  }

  /**
   * Converts a SQLite binary BLOB Uint8Array back to a number[] array without string/JSON parsing overhead.
   */
  private static blobBufferToArray(blob: Uint8Array | ArrayBuffer): number[] {
    const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    const f32 = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / Float32Array.BYTES_PER_ELEMENT);
    return Array.from(f32);
  }

  /**
   * Saves or updates a face template using raw 32-bit float BLOB storage.
   */
  static async saveTemplate(template: FaceTemplate): Promise<void> {
    try {
      const db = await this.getDB();
      const blob = this.arrayToBlobBuffer(template.embedding);
      const isSyncedInt = template.isSynced ? 1 : 0;
      const embeddingsJson = template.embeddings ? JSON.stringify(template.embeddings) : null;
      const locationJson = template.lastKnownLocation ? JSON.stringify(template.lastKnownLocation) : null;

      await db.runAsync(
        `INSERT INTO face_templates (id, embedding, created_at, is_synced, embeddings_json, last_known_location)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           embedding = excluded.embedding,
           created_at = excluded.created_at,
           is_synced = excluded.is_synced,
           embeddings_json = excluded.embeddings_json,
           last_known_location = COALESCE(excluded.last_known_location, face_templates.last_known_location)`,
        [template.id, blob, template.createdAt, isSyncedInt, embeddingsJson, locationJson]
      );
    } catch (e) {
      logger.error('Error saving template to SQLite BLOB store', e);
      throw e;
    }
  }

  /**
   * Updates last known location for a specific face template asynchronously without blocking authentication.
   */
  static async saveLastKnownLocation(id: string, location: LocationData): Promise<void> {
    try {
      const db = await this.getDB();
      const locationJson = JSON.stringify(location);
      await db.runAsync(
        'UPDATE face_templates SET last_known_location = ? WHERE id = ?',
        [locationJson, id]
      );
      logger.info(`Updated last_known_location for ${id} in SQLite.`);
    } catch (e) {
      logger.error(`Failed to update last_known_location for ${id}`, e);
    }
  }

  /**
   * Fast retrieval of all saved face templates directly from binary SQLite BLOBs.
   */
  static async getTemplates(): Promise<FaceTemplate[]> {
    try {
      const db = await this.getDB();
      const rows = await db.getAllAsync<{
        id: string;
        embedding: Uint8Array;
        created_at: number;
        is_synced: number;
        embeddings_json: string | null;
        last_known_location: string | null;
      }>('SELECT id, embedding, created_at, is_synced, embeddings_json, last_known_location FROM face_templates ORDER BY created_at DESC');

      return rows.map((row) => ({
        id: row.id,
        embedding: this.blobBufferToArray(row.embedding),
        createdAt: row.created_at,
        isSynced: row.is_synced === 1,
        embeddings: row.embeddings_json ? JSON.parse(row.embeddings_json) : undefined,
        lastKnownLocation: row.last_known_location ? JSON.parse(row.last_known_location) : undefined,
      }));
    } catch (e) {
      logger.error('Error loading face templates from SQLite store', e);
      return [];
    }
  }

  /**
   * Marks a specific face template as synced locally in SQLite.
   */
  static async markSynced(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.runAsync('UPDATE face_templates SET is_synced = 1 WHERE id = ?', [id]);
    } catch (e) {
      logger.error(`Error marking template ${id} synced in SQLite`, e);
      throw e;
    }
  }

  /**
   * Deletes a template from SQLite store.
   */
  static async deleteTemplate(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.runAsync('DELETE FROM face_templates WHERE id = ?', [id]);
    } catch (e) {
      logger.error(`Error deleting template ${id} from SQLite`, e);
      throw e;
    }
  }

  /**
   * Deletes all templates that have already been synced to AWS.
   */
  static async purgeSynced(): Promise<number> {
    try {
      const db = await this.getDB();
      const result = await db.runAsync('DELETE FROM face_templates WHERE is_synced = 1');
      return result.changes;
    } catch (e) {
      logger.error('Error purging synced templates from SQLite', e);
      return 0;
    }
  }

  /**
   * Deletes all face templates from SQLite store.
   */
  static async clearAll(): Promise<void> {
    try {
      const db = await this.getDB();
      await db.runAsync('DELETE FROM face_templates');
    } catch (e) {
      logger.error('Error clearing SQLite template store', e);
    }
  }
}
