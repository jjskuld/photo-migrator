import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

export interface MediaItem {
  id: string;
  original_path: string;
  local_copy_path?: string;
  original_name: string;
  size_bytes?: number;
  creation_date?: string;
  sha256_hash?: string;
  visual_hash?: string;
  pixel_size?: string;
  status: 'pending' | 'exported' | 'uploaded' | 'failed' | 'skipped';
  retry_count: number;
  last_attempt_at?: string;
  google_photos_id?: string;
  error_message?: string;
}

export interface Batch {
  id: string;
  created_at: string;
  status: 'planned' | 'uploading' | 'complete' | 'failed';
  total_size: number;
  files_count: number;
}

export interface Setting {
  key: string;
  value: string;
}

export class DatabaseManager {
  private db: Database.Database;
  private isInitialized: boolean = false;

  constructor(dbPath?: string) {
    // Create data directory if it doesn't exist
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 }); // Set appropriate permissions
      } catch (error) {
        const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
        logger.error('Failed to create data directory', { error: safeError });
        throw error;
      }
    }

    const dbFilePath = dbPath || path.join(dataDir, 'photo-migrator.db');
    
    try {
      this.db = new Database(dbFilePath);
      logger.info(`Database connected: ${dbFilePath}`);
      
      // Enable foreign key support
      this.db.pragma('foreign_keys = ON');
      
      // Set journal mode to WAL for better concurrency
      this.db.pragma('journal_mode = WAL');
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to connect to database', { error: safeError });
      throw error;
    }
  }

  /**
   * Initialize the database schema
   */
  public initialize(): boolean {
    if (this.isInitialized) {
      logger.warn('Database already initialized');
      return true;
    }

    try {
      // Create media_items table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS media_items (
          id TEXT PRIMARY KEY,
          original_path TEXT NOT NULL,
          local_copy_path TEXT,
          original_name TEXT NOT NULL,
          size_bytes INTEGER,
          creation_date TEXT,
          sha256_hash TEXT,
          visual_hash TEXT,
          pixel_size TEXT,
          status TEXT CHECK(status IN ('pending', 'exported', 'uploaded', 'failed', 'skipped')),
          retry_count INTEGER DEFAULT 0,
          last_attempt_at TEXT,
          google_photos_id TEXT,
          error_message TEXT
        );
      `);

      // Create batches table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS batches (
          id TEXT PRIMARY KEY,
          created_at TEXT,
          status TEXT CHECK(status IN ('planned', 'uploading', 'complete', 'failed')),
          total_size INTEGER,
          files_count INTEGER
        );
      `);

      // Create settings table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // Create indexes for frequently queried columns
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_media_status ON media_items(status);
        CREATE INDEX IF NOT EXISTS idx_media_sha256_hash ON media_items(sha256_hash);
        CREATE INDEX IF NOT EXISTS idx_media_retry_count ON media_items(retry_count);
        CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
      `);

      this.isInitialized = true;
      logger.info('Database schema initialized successfully');
      return true;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to initialize database schema', { error: safeError });
      throw error;
    }
  }

  /**
   * Add a new photo to the database
   */
  public addPhoto(photo: Omit<MediaItem, 'retry_count'>): string {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO media_items 
        (id, original_path, local_copy_path, original_name, size_bytes, creation_date, sha256_hash, visual_hash, pixel_size, status, retry_count, last_attempt_at, google_photos_id, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `);

      stmt.run(
        photo.id,
        photo.original_path,
        photo.local_copy_path || null,
        photo.original_name,
        photo.size_bytes || null,
        photo.creation_date || null,
        photo.sha256_hash || null,
        photo.visual_hash || null,
        photo.pixel_size || null,
        photo.status || 'pending',
        photo.last_attempt_at || null,
        photo.google_photos_id || null,
        photo.error_message || null
      );
      
      logger.debug('Added photo to database', { id: photo.id });
      return photo.id;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to add photo to database', { error: safeError, photoId: photo.id });
      throw error;
    }
  }

  /**
   * Add multiple photos to the database in a single transaction
   */
  public addPhotoBatch(photos: Omit<MediaItem, 'retry_count'>[]): string[] {
    if (photos.length === 0) {
      return [];
    }

    try {
      const ids: string[] = [];
      
      // Use a transaction for better performance and atomicity
      const transaction = this.db.transaction((photoList: Omit<MediaItem, 'retry_count'>[]) => {
        const stmt = this.db.prepare(`
          INSERT INTO media_items 
          (id, original_path, local_copy_path, original_name, size_bytes, creation_date, sha256_hash, visual_hash, pixel_size, status, retry_count, last_attempt_at, google_photos_id, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        `);
        
        for (const photo of photoList) {
          stmt.run(
            photo.id,
            photo.original_path,
            photo.local_copy_path || null,
            photo.original_name,
            photo.size_bytes || null,
            photo.creation_date || null,
            photo.sha256_hash || null,
            photo.visual_hash || null,
            photo.pixel_size || null,
            photo.status || 'pending',
            photo.last_attempt_at || null,
            photo.google_photos_id || null,
            photo.error_message || null
          );
          ids.push(photo.id);
        }
        
        return ids;
      });
      
      transaction(photos);
      
      logger.debug(`Added ${photos.length} photos to database in batch`);
      return ids;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to add photos in batch', { error: safeError, count: photos.length });
      throw error;
    }
  }

  /**
   * Update the status of a photo in the database
   */
  public updatePhotoStatus(id: string, status: MediaItem['status'], errorMessage?: string): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE media_items 
        SET status = ?, last_attempt_at = ?, error_message = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        status,
        new Date().toISOString(),
        errorMessage || null,
        id
      );
      
      if (result.changes === 0) {
        logger.warn('No photo found with the given ID', { id });
        return false;
      }
      
      logger.debug('Updated photo status', { id, status });
      return true;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to update photo status', { error: safeError, id, status });
      throw error;
    }
  }

  /**
   * Update the Google Photos ID for a photo
   */
  public updateGooglePhotosId(id: string, googlePhotosId: string): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE media_items 
        SET google_photos_id = ?
        WHERE id = ?
      `);

      const result = stmt.run(googlePhotosId, id);
      
      if (result.changes === 0) {
        logger.warn('No photo found with the given ID', { id });
        return false;
      }
      
      logger.debug('Updated Google Photos ID', { id, googlePhotosId });
      return true;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to update Google Photos ID', { error: safeError, id });
      throw error;
    }
  }

  /**
   * Update the local_copy_path for a photo
   */
  public updateLocalCopyPath(id: string, localCopyPath: string): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE media_items 
        SET local_copy_path = ?
        WHERE id = ?
      `);

      const result = stmt.run(localCopyPath, id);
      
      if (result.changes === 0) {
        logger.warn('No photo found with the given ID', { id });
        return false;
      }
      
      logger.debug('Updated local copy path', { id, localCopyPath });
      return true;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to update local copy path', { error: safeError, id });
      throw error;
    }
  }

  /**
   * Get photos with a specific status
   */
  public getPhotosByStatus(status: MediaItem['status'], limit: number = 100): MediaItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE status = ?
        LIMIT ?
      `);

      return stmt.all(status, limit) as MediaItem[];
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get photos by status', { error: safeError, status });
      throw error;
    }
  }

  /**
   * Get pending photos (maintained for API compatibility with requirements)
   * Simply calls getPhotosByStatus with 'pending'
   */
  public getPendingPhotos(limit: number = 100): MediaItem[] {
    return this.getPhotosByStatus('pending', limit);
  }

  /**
   * Get a photo by its SHA256 hash
   */
  public getPhotoByHash(hash: string): MediaItem | undefined {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE sha256_hash = ?
        LIMIT 1
      `);

      return stmt.get(hash) as MediaItem | undefined;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get photo by hash', { error: safeError, hash });
      throw error;
    }
  }

  /**
   * Get a photo by its ID
   */
  public getPhotoById(id: string): MediaItem | undefined {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE id = ?
        LIMIT 1
      `);

      return stmt.get(id) as MediaItem | undefined;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get photo by ID', { error: safeError, id });
      throw error;
    }
  }

  /**
   * Get the total count of photos
   */
  public getTotalCount(): number {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM media_items
      `);

      const result = stmt.get() as { count: number };
      return result.count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get total count of photos', { error: safeError });
      throw error;
    }
  }

  /**
   * Get the count of photos by status
   */
  public getCountByStatus(status: MediaItem['status']): number {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM media_items
        WHERE status = ?
      `);

      const result = stmt.get(status) as { count: number };
      return result.count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get count of photos by status', { error: safeError, status });
      throw error;
    }
  }

  /**
   * Get the count of completed photos (status = 'uploaded')
   * Maintained for API compatibility with requirements
   */
  public getCompletedCount(): number {
    return this.getCountByStatus('uploaded');
  }

  /**
   * Increment the retry count for a photo
   */
  public incrementRetryCount(id: string): number {
    try {
      const stmt = this.db.prepare(`
        UPDATE media_items
        SET retry_count = retry_count + 1, last_attempt_at = ?
        WHERE id = ?
        RETURNING retry_count
      `);

      const result = stmt.get(new Date().toISOString(), id) as { retry_count: number } | undefined;
      
      if (!result) {
        logger.warn('No photo found with the given ID', { id });
        return -1;
      }
      
      logger.debug('Incremented retry count', { id, newCount: result.retry_count });
      return result.retry_count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to increment retry count', { error: safeError, id });
      throw error;
    }
  }

  /**
   * Add a new batch to the database
   */
  public addBatch(batch: Omit<Batch, 'created_at'>): string {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO batches
        (id, created_at, status, total_size, files_count)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        batch.id,
        new Date().toISOString(),
        batch.status,
        batch.total_size,
        batch.files_count
      );
      
      logger.debug('Added batch to database', { id: batch.id });
      return batch.id;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to add batch to database', { error: safeError, batchId: batch.id });
      throw error;
    }
  }

  /**
   * Update the status of a batch
   */
  public updateBatchStatus(id: string, status: Batch['status']): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE batches
        SET status = ?
        WHERE id = ?
      `);

      const result = stmt.run(status, id);
      
      if (result.changes === 0) {
        logger.warn('No batch found with the given ID', { id });
        return false;
      }
      
      logger.debug('Updated batch status', { id, status });
      return true;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to update batch status', { error: safeError, id, status });
      throw error;
    }
  }

  /**
   * Get a batch by its ID
   */
  public getBatchById(id: string): Batch | undefined {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM batches
        WHERE id = ?
      `);

      return stmt.get(id) as Batch | undefined;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get batch by ID', { error: safeError, id });
      throw error;
    }
  }

  /**
   * Get batches by status
   */
  public getBatchesByStatus(status: Batch['status'], limit: number = 10): Batch[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM batches
        WHERE status = ?
        LIMIT ?
      `);

      return stmt.all(status, limit) as Batch[];
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get batches by status', { error: safeError, status });
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  public close(): void {
    try {
      this.db.close();
      logger.info('Database connection closed');
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to close database connection', { error: safeError });
      throw error;
    }
  }

  /**
   * Vacuum the database to optimize its size
   */
  public vacuum(): void {
    try {
      this.db.exec('VACUUM');
      logger.info('Database vacuumed');
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to vacuum database', { error: safeError });
      throw error;
    }
  }
} 