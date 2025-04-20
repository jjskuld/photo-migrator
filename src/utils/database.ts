import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

export type MediaType = 'photo' | 'video';
export type MediaStatus = 'pending' | 'exported' | 'uploaded' | 'failed' | 'skipped' | 'skipped_icloud';

export interface MediaItem {
  id: string;
  media_type: MediaType;
  mime_type: string; // e.g., "image/jpeg", "video/mp4", etc.
  original_path: string;
  local_copy_path?: string;
  original_name: string;
  size_bytes?: number;
  creation_date?: string;
  sha256_hash?: string;
  visual_hash?: string;
  pixel_size?: string;
  // Video-specific fields
  duration_seconds?: number;
  frame_rate?: number;
  codec?: string;
  status: MediaStatus;
  retry_count: number;
  last_attempt_at?: string;
  google_photos_id?: string;
  error_message?: string;
  is_in_icloud?: boolean; // New property to indicate if media is stored primarily in iCloud
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
          media_type TEXT CHECK(media_type IN ('photo', 'video')) NOT NULL,
          mime_type TEXT NOT NULL,
          original_path TEXT NOT NULL,
          local_copy_path TEXT,
          original_name TEXT NOT NULL,
          size_bytes INTEGER,
          creation_date TEXT,
          sha256_hash TEXT,
          visual_hash TEXT,
          pixel_size TEXT,
          duration_seconds REAL,
          frame_rate REAL,
          codec TEXT,
          status TEXT CHECK(status IN ('pending', 'exported', 'uploaded', 'failed', 'skipped', 'skipped_icloud')),
          retry_count INTEGER DEFAULT 0,
          last_attempt_at TEXT,
          google_photos_id TEXT,
          error_message TEXT,
          is_in_icloud INTEGER DEFAULT 0
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
        CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(media_type);
        CREATE INDEX IF NOT EXISTS idx_media_mime_type ON media_items(mime_type);
        CREATE INDEX IF NOT EXISTS idx_media_retry_count ON media_items(retry_count);
        CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
        
        -- Compound indexes for multi-field queries
        CREATE INDEX IF NOT EXISTS idx_media_type_status ON media_items(media_type, status);
        CREATE INDEX IF NOT EXISTS idx_media_mime_status ON media_items(mime_type, status);
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
   * Add a new media item to the database
   */
  public addMediaItem(media: Omit<MediaItem, 'retry_count'>): string {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO media_items 
        (id, media_type, mime_type, original_path, local_copy_path, original_name, size_bytes, creation_date, 
         sha256_hash, visual_hash, pixel_size, duration_seconds, frame_rate, codec, status, 
         retry_count, last_attempt_at, google_photos_id, error_message, is_in_icloud)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `);

      stmt.run(
        media.id,
        media.media_type,
        media.mime_type,
        media.original_path,
        media.local_copy_path || null,
        media.original_name,
        media.size_bytes || null,
        media.creation_date || null,
        media.sha256_hash || null,
        media.visual_hash || null,
        media.pixel_size || null,
        media.duration_seconds || null,
        media.frame_rate || null,
        media.codec || null,
        media.status || 'pending',
        media.last_attempt_at || null,
        media.google_photos_id || null,
        media.error_message || null,
        media.is_in_icloud === true ? 1 : 0
      );
      
      logger.debug('Added media item to database', { id: media.id, type: media.media_type, mimeType: media.mime_type });
      return media.id;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to add media item to database', { error: safeError, mediaId: media.id });
      throw error;
    }
  }

  /**
   * Add multiple media items to the database in a single transaction
   */
  public addMediaBatch(mediaItems: Omit<MediaItem, 'retry_count'>[]): string[] {
    if (mediaItems.length === 0) {
      return [];
    }

    try {
      const ids: string[] = [];
      
      // Use a transaction for better performance and atomicity
      const transaction = this.db.transaction((mediaList: Omit<MediaItem, 'retry_count'>[]) => {
        const stmt = this.db.prepare(`
          INSERT INTO media_items 
          (id, media_type, mime_type, original_path, local_copy_path, original_name, size_bytes, creation_date, 
           sha256_hash, visual_hash, pixel_size, duration_seconds, frame_rate, codec, status, 
           retry_count, last_attempt_at, google_photos_id, error_message, is_in_icloud)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `);
        
        for (const media of mediaList) {
          stmt.run(
            media.id,
            media.media_type,
            media.mime_type,
            media.original_path,
            media.local_copy_path || null,
            media.original_name,
            media.size_bytes || null,
            media.creation_date || null,
            media.sha256_hash || null,
            media.visual_hash || null,
            media.pixel_size || null,
            media.duration_seconds || null,
            media.frame_rate || null,
            media.codec || null,
            media.status || 'pending',
            media.last_attempt_at || null,
            media.google_photos_id || null,
            media.error_message || null,
            media.is_in_icloud === true ? 1 : 0
          );
          ids.push(media.id);
        }
        
        return ids;
      });
      
      transaction(mediaItems);
      
      logger.debug(`Added ${mediaItems.length} media items to database in batch`);
      return ids;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to add media items in batch', { error: safeError, count: mediaItems.length });
      throw error;
    }
  }

  /**
   * Update the status of a media item in the database
   */
  public updateMediaStatus(id: string, status: MediaStatus, errorMessage?: string): boolean {
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
        logger.warn('No media item found with the given ID', { id });
        return false;
      }
      
      logger.debug('Updated media item status', { id, status });
      return true;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to update media item status', { error: safeError, id, status });
      throw error;
    }
  }

  /**
   * Update the Google Photos ID for a media item
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
        logger.warn('No media item found with the given ID', { id });
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
   * Update the local_copy_path for a media item
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
        logger.warn('No media item found with the given ID', { id });
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
   * Get media items with a specific status
   */
  public getMediaByStatus(status: MediaStatus, limit: number = 100): MediaItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE status = ?
        LIMIT ?
      `);

      return stmt.all(status, limit) as MediaItem[];
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get media items by status', { error: safeError, status });
      throw error;
    }
  }

  /**
   * Get media items by type and status
   */
  public getMediaByTypeAndStatus(type: MediaType, status: MediaStatus, limit: number = 100): MediaItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE media_type = ? AND status = ?
        LIMIT ?
      `);

      return stmt.all(type, status, limit) as MediaItem[];
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get media items by type and status', { error: safeError, type, status });
      throw error;
    }
  }

  /**
   * Get pending media items (maintained for API compatibility with requirements)
   */
  public getPendingMedia(limit: number = 100): MediaItem[] {
    return this.getMediaByStatus('pending', limit);
  }

  /**
   * Get pending photos only
   */
  public getPendingPhotos(limit: number = 100): MediaItem[] {
    return this.getMediaByTypeAndStatus('photo', 'pending', limit);
  }

  /**
   * Get pending videos only
   */
  public getPendingVideos(limit: number = 100): MediaItem[] {
    return this.getMediaByTypeAndStatus('video', 'pending', limit);
  }

  /**
   * Get a media item by its SHA256 hash
   */
  public getMediaByHash(hash: string): MediaItem | undefined {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE sha256_hash = ?
        LIMIT 1
      `);

      return stmt.get(hash) as MediaItem | undefined;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get media item by hash', { error: safeError, hash });
      throw error;
    }
  }

  /**
   * Get a media item by its ID
   */
  public getMediaById(id: string): MediaItem | undefined {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE id = ?
        LIMIT 1
      `);

      return stmt.get(id) as MediaItem | undefined;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get media item by ID', { error: safeError, id });
      throw error;
    }
  }

  /**
   * Get the total count of media items
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
      logger.error('Failed to get total count of media items', { error: safeError });
      throw error;
    }
  }

  /**
   * Get the count of media items by type
   */
  public getCountByType(type: MediaType): number {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM media_items
        WHERE media_type = ?
      `);

      const result = stmt.get(type) as { count: number };
      return result.count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get count of media items by type', { error: safeError, type });
      throw error;
    }
  }

  /**
   * Get the count of media items by status
   */
  public getCountByStatus(status: MediaStatus): number {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM media_items
        WHERE status = ?
      `);

      const result = stmt.get(status) as { count: number };
      return result.count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get count of media items by status', { error: safeError, status });
      throw error;
    }
  }

  /**
   * Get the count of media items by type and status
   */
  public getCountByTypeAndStatus(type: MediaType, status: MediaStatus): number {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM media_items
        WHERE media_type = ? AND status = ?
      `);

      const result = stmt.get(type, status) as { count: number };
      return result.count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get count of media items by type and status', { error: safeError, type, status });
      throw error;
    }
  }

  /**
   * Get the count of completed media items (status = 'uploaded')
   * Maintained for API compatibility with requirements
   */
  public getCompletedCount(): number {
    return this.getCountByStatus('uploaded');
  }

  /**
   * Increment the retry count for a media item
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
        logger.warn('No media item found with the given ID', { id });
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

  // Legacy methods for backward compatibility
  
  /**
   * @deprecated Use addMediaItem instead
   */
  public addPhoto(photo: Omit<MediaItem, 'retry_count'>): string {
    const mediaItem = {
      ...photo,
      media_type: 'photo' as MediaType,
      mime_type: photo.mime_type || 'image/jpeg'
    };
    return this.addMediaItem(mediaItem);
  }

  /**
   * @deprecated Use addMediaBatch instead
   */
  public addPhotoBatch(photos: Omit<MediaItem, 'retry_count'>[]): string[] {
    const mediaItems = photos.map(photo => ({
      ...photo,
      media_type: 'photo' as MediaType,
      mime_type: photo.mime_type || 'image/jpeg'
    }));
    return this.addMediaBatch(mediaItems);
  }

  /**
   * @deprecated Use updateMediaStatus instead
   */
  public updatePhotoStatus(id: string, status: MediaStatus, errorMessage?: string): boolean {
    return this.updateMediaStatus(id, status, errorMessage);
  }

  /**
   * @deprecated Use getMediaByStatus instead
   */
  public getPhotosByStatus(status: MediaStatus, limit: number = 100): MediaItem[] {
    return this.getMediaByTypeAndStatus('photo', status, limit);
  }

  /**
   * @deprecated Use getMediaById instead
   */
  public getPhotoById(id: string): MediaItem | undefined {
    return this.getMediaById(id);
  }

  /**
   * @deprecated Use getMediaByHash instead
   */
  public getPhotoByHash(hash: string): MediaItem | undefined {
    return this.getMediaByHash(hash);
  }

  /**
   * Get media items by MIME type
   */
  public getMediaByMimeType(mimeType: string, limit: number = 100): MediaItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE mime_type = ?
        LIMIT ?
      `);

      return stmt.all(mimeType, limit) as MediaItem[];
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get media items by MIME type', { error: safeError, mimeType });
      throw error;
    }
  }

  /**
   * Get media items by MIME type and status
   */
  public getMediaByMimeTypeAndStatus(mimeType: string, status: MediaStatus, limit: number = 100): MediaItem[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM media_items
        WHERE mime_type = ? AND status = ?
        LIMIT ?
      `);

      return stmt.all(mimeType, status, limit) as MediaItem[];
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get media items by MIME type and status', { error: safeError, mimeType, status });
      throw error;
    }
  }

  /**
   * Get the count of media items by MIME type
   */
  public getCountByMimeType(mimeType: string): number {
    try {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM media_items
        WHERE mime_type = ?
      `);

      const result = stmt.get(mimeType) as { count: number };
      return result.count;
    } catch (error) {
      const safeError = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      logger.error('Failed to get count of media items by MIME type', { error: safeError, mimeType });
      throw error;
    }
  }
} 