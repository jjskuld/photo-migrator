import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseManager, MediaItem, Batch, MediaType, MediaStatus } from './database';

// Mock the logger to avoid console output during tests
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Test data factories
const createTestMedia = (
  type: MediaType = 'photo',
  override: Partial<Omit<MediaItem, 'retry_count'>> = {}
): Omit<MediaItem, 'retry_count'> => ({
  id: `test-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  media_type: type,
  mime_type: type === 'photo' ? 'image/jpeg' : 'video/mp4',
  original_path: type === 'photo' ? '/path/to/photo.jpg' : '/path/to/video.mp4',
  original_name: type === 'photo' ? 'photo.jpg' : 'video.mp4',
  size_bytes: 1024,
  status: 'pending',
  ...(type === 'video' ? {
    duration_seconds: 30,
    frame_rate: 30,
    codec: 'h264'
  } : {}),
  ...override,
});

// Convenience wrappers
const createTestPhoto = (override: Partial<Omit<MediaItem, 'retry_count'>> = {}): Omit<MediaItem, 'retry_count'> => 
  createTestMedia('photo', override);

const createTestVideo = (override: Partial<Omit<MediaItem, 'retry_count'>> = {}): Omit<MediaItem, 'retry_count'> => 
  createTestMedia('video', override);

const createTestBatch = (override: Partial<Omit<Batch, 'created_at'>> = {}): Omit<Batch, 'created_at'> => ({
  id: `batch-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  status: 'planned',
  total_size: 1024 * 1024,
  files_count: 5,
  ...override,
});

describe('DatabaseManager', () => {
  const testDbPath = path.join(process.cwd(), 'test-db.sqlite');
  let dbManager: DatabaseManager;

  beforeEach(() => {
    // Create a new database instance for each test
    dbManager = new DatabaseManager(testDbPath);
    dbManager.initialize();
  });

  afterEach(() => {
    // Close the database and delete the test file after each test
    dbManager.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initialize', () => {
    it('should create tables and indexes', () => {
      // Already initialized in beforeEach, just verify it works
      expect(dbManager['isInitialized']).toBe(true);
    });

    it('should not re-initialize if already initialized', () => {
      // Call initialize again and expect it to return true without error
      expect(dbManager.initialize()).toBe(true);
    });
  });

  describe('addMediaItem', () => {
    it('should add a photo to the database', () => {
      const photoData = createTestPhoto({
        id: 'test-id-1',
        mime_type: 'image/png',
        original_path: '/path/to/photo.png',
        local_copy_path: '/temp/photo.png',
        google_photos_id: 'google-123',
        error_message: undefined,
      });

      const id = dbManager.addMediaItem(photoData);
      
      expect(id).toBe('test-id-1');
      
      // Verify the photo was added
      const photos = dbManager.getMediaByTypeAndStatus('photo', 'pending');
      expect(photos.length).toBe(1);
      expect(photos[0].id).toBe('test-id-1');
      expect(photos[0].media_type).toBe('photo');
      expect(photos[0].mime_type).toBe('image/png');
      expect(photos[0].original_path).toBe('/path/to/photo.png');
      expect(photos[0].local_copy_path).toBe('/temp/photo.png');
      expect(photos[0].google_photos_id).toBe('google-123');
      expect(photos[0].size_bytes).toBe(1024);
      expect(photos[0].retry_count).toBe(0);
    });

    it('should add a video to the database', () => {
      const videoData = createTestVideo({
        id: 'video-id-1',
        mime_type: 'video/quicktime',
        original_path: '/path/to/video.mov',
        local_copy_path: '/temp/video.mov',
        duration_seconds: 120,
        frame_rate: 29.97,
        codec: 'h264',
      });

      const id = dbManager.addMediaItem(videoData);
      
      expect(id).toBe('video-id-1');
      
      // Verify the video was added
      const videos = dbManager.getMediaByTypeAndStatus('video', 'pending');
      expect(videos.length).toBe(1);
      expect(videos[0].id).toBe('video-id-1');
      expect(videos[0].media_type).toBe('video');
      expect(videos[0].mime_type).toBe('video/quicktime');
      expect(videos[0].original_path).toBe('/path/to/video.mov');
      expect(videos[0].duration_seconds).toBe(120);
      expect(videos[0].frame_rate).toBe(29.97);
      expect(videos[0].codec).toBe('h264');
    });

    it('should fail with a unique constraint error if trying to add a media item with existing id', () => {
      const photoData = createTestPhoto({ id: 'duplicate-id' });
      
      // Add the photo once
      dbManager.addMediaItem(photoData);
      
      // Try to add again with the same ID
      expect(() => dbManager.addMediaItem(photoData)).toThrow();
    });
  });

  describe('Legacy methods compatibility', () => {
    it('should use addPhoto as a wrapper for addMediaItem with photo type', () => {
      const photoData = createTestPhoto({
        id: 'legacy-id',
        original_name: 'legacy.jpg',
        // Deliberately omit mime_type to test the default
        mime_type: undefined as any
      });
      
      const id = dbManager.addPhoto(photoData);
      expect(id).toBe('legacy-id');
      
      const media = dbManager.getMediaById('legacy-id');
      expect(media).toBeDefined();
      expect(media?.media_type).toBe('photo');
      expect(media?.mime_type).toBe('image/jpeg'); // Should use default mime type
    });

    it('should handle a custom mime_type when using legacy method', () => {
      const photoData = createTestPhoto({
        id: 'legacy-id-2',
        mime_type: 'image/webp',
        original_name: 'legacy.webp',
      });
      
      dbManager.addPhoto(photoData);
      
      const media = dbManager.getMediaById('legacy-id-2');
      expect(media?.mime_type).toBe('image/webp');
    });
  });

  describe('addMediaBatch', () => {
    it('should add multiple media items in a batch transaction', () => {
      const mediaItems = [
        createTestPhoto({ id: 'batch-photo-1', original_name: 'photo1.jpg' }),
        createTestPhoto({ id: 'batch-photo-2', original_name: 'photo2.jpg' }),
        createTestVideo({ id: 'batch-video-1', original_name: 'video1.mp4' }),
      ];
      
      const ids = dbManager.addMediaBatch(mediaItems);
      
      expect(ids).toHaveLength(3);
      expect(ids).toContain('batch-photo-1');
      expect(ids).toContain('batch-photo-2');
      expect(ids).toContain('batch-video-1');
      
      // Verify photos were added
      const photos = dbManager.getMediaByTypeAndStatus('photo', 'pending');
      expect(photos.length).toBe(2);
      
      // Verify videos were added
      const videos = dbManager.getMediaByTypeAndStatus('video', 'pending');
      expect(videos.length).toBe(1);
      
      // Verify all pending media
      const pendingMedia = dbManager.getMediaByStatus('pending');
      expect(pendingMedia.length).toBe(3);
    });

    it('should return an empty array if no media items are provided', () => {
      const ids = dbManager.addMediaBatch([]);
      expect(ids).toHaveLength(0);
    });
  });

  describe('updateMediaStatus', () => {
    it('should update the status of a media item', () => {
      // First add a media item
      const photoData = createTestPhoto({ id: 'test-id-2' });
      
      dbManager.addMediaItem(photoData);
      
      // Update the status
      const result = dbManager.updateMediaStatus('test-id-2', 'uploaded', 'Successfully uploaded');
      
      expect(result).toBe(true);
      
      // Verify the status was updated
      const media = dbManager.getMediaByStatus('uploaded');
      expect(media.length).toBe(1);
      expect(media[0].id).toBe('test-id-2');
      expect(media[0].status).toBe('uploaded');
      expect(media[0].error_message).toBe('Successfully uploaded');
    });

    it('should return false when updating a non-existent media item', () => {
      const result = dbManager.updateMediaStatus('non-existent-id', 'uploaded');
      
      expect(result).toBe(false);
    });
  });

  describe('updateGooglePhotosId', () => {
    it('should update the Google Photos ID for a media item', () => {
      // First add a media item
      const photoData = createTestPhoto({ id: 'google-update-test' });
      
      dbManager.addMediaItem(photoData);
      
      // Update the Google Photos ID
      const result = dbManager.updateGooglePhotosId('google-update-test', 'google-photos-id-123');
      
      expect(result).toBe(true);
      
      // Verify the Google Photos ID was updated
      const media = dbManager.getMediaById('google-update-test');
      expect(media).toBeDefined();
      expect(media?.google_photos_id).toBe('google-photos-id-123');
    });

    it('should return false when updating a non-existent media item', () => {
      const result = dbManager.updateGooglePhotosId('non-existent-id', 'test-id');
      
      expect(result).toBe(false);
    });
  });

  describe('updateLocalCopyPath', () => {
    it('should update the local copy path for a media item', () => {
      // First add a media item
      const photoData = createTestPhoto({ id: 'local-path-test' });
      
      dbManager.addMediaItem(photoData);
      
      // Update the local copy path
      const result = dbManager.updateLocalCopyPath('local-path-test', '/tmp/exported/photo.jpg');
      
      expect(result).toBe(true);
      
      // Verify the local copy path was updated
      const media = dbManager.getMediaById('local-path-test');
      expect(media).toBeDefined();
      expect(media?.local_copy_path).toBe('/tmp/exported/photo.jpg');
    });

    it('should return false when updating a non-existent media item', () => {
      const result = dbManager.updateLocalCopyPath('non-existent-id', '/tmp/not-found.jpg');
      
      expect(result).toBe(false);
    });
  });

  describe('getMediaByStatus and type filtering', () => {
    beforeEach(() => {
      // Add multiple media items with different types and statuses
      dbManager.addMediaItem(createTestPhoto({
        id: 'pending-photo-1',
        original_path: '/path/pending-photo1.jpg',
        original_name: 'pending-photo1.jpg',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestPhoto({
        id: 'uploaded-photo-1',
        original_path: '/path/uploaded-photo1.jpg',
        original_name: 'uploaded-photo1.jpg',
        status: 'uploaded',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'pending-video-1',
        original_path: '/path/pending-video1.mp4',
        original_name: 'pending-video1.mp4',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'failed-video-1',
        original_path: '/path/failed-video1.mp4',
        original_name: 'failed-video1.mp4',
        status: 'failed',
      }));
    });

    it('should return media items with the specified status', () => {
      const pendingMedia = dbManager.getMediaByStatus('pending');
      const uploadedMedia = dbManager.getMediaByStatus('uploaded');
      const failedMedia = dbManager.getMediaByStatus('failed');
      
      expect(pendingMedia.length).toBe(2);
      expect(uploadedMedia.length).toBe(1);
      expect(failedMedia.length).toBe(1);
    });

    it('should return media items with the specified type and status', () => {
      const pendingPhotos = dbManager.getMediaByTypeAndStatus('photo', 'pending');
      const pendingVideos = dbManager.getMediaByTypeAndStatus('video', 'pending');
      
      expect(pendingPhotos.length).toBe(1);
      expect(pendingVideos.length).toBe(1);
      
      expect(pendingPhotos[0].id).toBe('pending-photo-1');
      expect(pendingVideos[0].id).toBe('pending-video-1');
    });

    it('should respect the limit parameter', () => {
      // Add another pending photo to have multiple
      dbManager.addMediaItem(createTestPhoto({
        id: 'pending-photo-2',
        original_path: '/path/pending-photo2.jpg',
        original_name: 'pending-photo2.jpg',
        status: 'pending',
      }));
      
      const pendingMedia = dbManager.getMediaByStatus('pending', 2);
      
      expect(pendingMedia.length).toBe(2);
    });

    it('getPendingPhotos should return only photos with pending status', () => {
      const pendingPhotos = dbManager.getPendingPhotos();
      const pendingVideos = dbManager.getPendingVideos();
      
      expect(pendingPhotos.length).toBe(1);
      expect(pendingVideos.length).toBe(1);
      
      expect(pendingPhotos[0].id).toBe('pending-photo-1');
      expect(pendingVideos[0].id).toBe('pending-video-1');
    });
  });

  describe('getMediaByHash', () => {
    beforeEach(() => {
      dbManager.addMediaItem(createTestPhoto({
        id: 'hash-test-photo',
        original_path: '/path/hash-test.jpg',
        original_name: 'hash-test.jpg',
        sha256_hash: 'test-photo-hash-value',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'hash-test-video',
        original_path: '/path/hash-test.mp4',
        original_name: 'hash-test.mp4',
        sha256_hash: 'test-video-hash-value',
        status: 'pending',
      }));
    });

    it('should return a media item with the matching hash', () => {
      const photo = dbManager.getMediaByHash('test-photo-hash-value');
      const video = dbManager.getMediaByHash('test-video-hash-value');
      
      expect(photo).toBeDefined();
      expect(photo?.id).toBe('hash-test-photo');
      expect(photo?.media_type).toBe('photo');
      
      expect(video).toBeDefined();
      expect(video?.id).toBe('hash-test-video');
      expect(video?.media_type).toBe('video');
    });

    it('should return undefined for a non-existent hash', () => {
      const media = dbManager.getMediaByHash('non-existent-hash');
      
      expect(media).toBeUndefined();
    });
  });

  describe('getMediaById', () => {
    beforeEach(() => {
      dbManager.addMediaItem(createTestPhoto({
        id: 'id-test-photo',
        original_path: '/path/id-test.jpg',
        original_name: 'id-test.jpg',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'id-test-video',
        original_path: '/path/id-test.mp4',
        original_name: 'id-test.mp4',
        status: 'pending',
      }));
    });

    it('should return a media item with the matching id', () => {
      const photo = dbManager.getMediaById('id-test-photo');
      const video = dbManager.getMediaById('id-test-video');
      
      expect(photo).toBeDefined();
      expect(photo?.original_path).toBe('/path/id-test.jpg');
      expect(photo?.media_type).toBe('photo');
      
      expect(video).toBeDefined();
      expect(video?.original_path).toBe('/path/id-test.mp4');
      expect(video?.media_type).toBe('video');
    });

    it('should return undefined for a non-existent id', () => {
      const media = dbManager.getMediaById('non-existent-id');
      
      expect(media).toBeUndefined();
    });
  });

  describe('count methods', () => {
    beforeEach(() => {
      // Add media items with different types and statuses
      dbManager.addMediaItem(createTestPhoto({ id: 'p1', original_path: '/p1', original_name: 'p1.jpg', status: 'pending' }));
      dbManager.addMediaItem(createTestPhoto({ id: 'p2', original_path: '/p2', original_name: 'p2.jpg', status: 'pending' }));
      dbManager.addMediaItem(createTestPhoto({ id: 'pu', original_path: '/pu', original_name: 'pu.jpg', status: 'uploaded' }));
      dbManager.addMediaItem(createTestVideo({ id: 'v1', original_path: '/v1', original_name: 'v1.mp4', status: 'pending' }));
      dbManager.addMediaItem(createTestVideo({ id: 'v2', original_path: '/v2', original_name: 'v2.mp4', status: 'failed' }));
    });

    it('should return the total count of media items', () => {
      const totalCount = dbManager.getTotalCount();
      expect(totalCount).toBe(5);
    });

    it('should return the count of media items by type', () => {
      const photoCount = dbManager.getCountByType('photo');
      const videoCount = dbManager.getCountByType('video');
      
      expect(photoCount).toBe(3);
      expect(videoCount).toBe(2);
    });

    it('should return the count of media items by status', () => {
      const pendingCount = dbManager.getCountByStatus('pending');
      const uploadedCount = dbManager.getCountByStatus('uploaded');
      const failedCount = dbManager.getCountByStatus('failed');
      const exportedCount = dbManager.getCountByStatus('exported');
      
      expect(pendingCount).toBe(3); // 2 photos + 1 video
      expect(uploadedCount).toBe(1);
      expect(failedCount).toBe(1);
      expect(exportedCount).toBe(0);
    });

    it('should return the count of media items by type and status', () => {
      const pendingPhotoCount = dbManager.getCountByTypeAndStatus('photo', 'pending');
      const pendingVideoCount = dbManager.getCountByTypeAndStatus('video', 'pending');
      
      expect(pendingPhotoCount).toBe(2);
      expect(pendingVideoCount).toBe(1);
    });

    it('getCompletedCount should return the same results as getCountByStatus for uploaded', () => {
      const usingGeneric = dbManager.getCountByStatus('uploaded');
      const usingSpecific = dbManager.getCompletedCount();
      
      expect(usingSpecific).toBe(usingGeneric);
    });
  });

  describe('incrementRetryCount', () => {
    beforeEach(() => {
      dbManager.addMediaItem(createTestPhoto({
        id: 'retry-test-photo',
        original_path: '/path/retry-test.jpg',
        original_name: 'retry-test.jpg',
        status: 'failed',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'retry-test-video',
        original_path: '/path/retry-test.mp4',
        original_name: 'retry-test.mp4',
        status: 'failed',
      }));
    });

    it('should increment the retry count for a media item', () => {
      const newPhotoCount = dbManager.incrementRetryCount('retry-test-photo');
      const newVideoCount = dbManager.incrementRetryCount('retry-test-video');
      
      expect(newPhotoCount).toBe(1);
      expect(newVideoCount).toBe(1);
      
      // Increment again
      const secondPhotoCount = dbManager.incrementRetryCount('retry-test-photo');
      
      expect(secondPhotoCount).toBe(2);
      
      // Verify in the database
      const photo = dbManager.getMediaById('retry-test-photo');
      const video = dbManager.getMediaById('retry-test-video');
      
      expect(photo?.retry_count).toBe(2);
      expect(video?.retry_count).toBe(1);
    });

    it('should return -1 for a non-existent media item', () => {
      const result = dbManager.incrementRetryCount('non-existent-id');
      
      expect(result).toBe(-1);
    });
  });

  describe('batch operations', () => {
    it('should add a batch and update its status', () => {
      const batchData = createTestBatch({ id: 'batch-1' });
      
      const id = dbManager.addBatch(batchData);
      
      expect(id).toBe('batch-1');
      
      // Update the batch status
      const result = dbManager.updateBatchStatus('batch-1', 'uploading');
      
      expect(result).toBe(true);
    });

    it('should return false when updating a non-existent batch', () => {
      const result = dbManager.updateBatchStatus('non-existent-batch', 'complete');
      
      expect(result).toBe(false);
    });

    it('should get a batch by ID', () => {
      const batchData = createTestBatch({ id: 'get-batch-test' });
      dbManager.addBatch(batchData);
      
      const batch = dbManager.getBatchById('get-batch-test');
      
      expect(batch).toBeDefined();
      expect(batch?.id).toBe('get-batch-test');
      expect(batch?.status).toBe('planned');
    });

    it('should return undefined for a non-existent batch ID', () => {
      const batch = dbManager.getBatchById('non-existent-batch');
      
      expect(batch).toBeUndefined();
    });

    it('should get batches by status', () => {
      // Add multiple batches with different statuses
      dbManager.addBatch(createTestBatch({ id: 'planned-batch-1', status: 'planned' }));
      dbManager.addBatch(createTestBatch({ id: 'planned-batch-2', status: 'planned' }));
      dbManager.addBatch(createTestBatch({ id: 'uploading-batch', status: 'uploading' }));
      
      const plannedBatches = dbManager.getBatchesByStatus('planned');
      const uploadingBatches = dbManager.getBatchesByStatus('uploading');
      
      expect(plannedBatches.length).toBe(2);
      expect(uploadingBatches.length).toBe(1);
      
      expect(plannedBatches[0].id).toBe('planned-batch-1');
      expect(plannedBatches[1].id).toBe('planned-batch-2');
      expect(uploadingBatches[0].id).toBe('uploading-batch');
    });

    it('should respect the limit parameter when getting batches by status', () => {
      // Add multiple batches with the same status
      dbManager.addBatch(createTestBatch({ id: 'limit-test-1', status: 'planned' }));
      dbManager.addBatch(createTestBatch({ id: 'limit-test-2', status: 'planned' }));
      dbManager.addBatch(createTestBatch({ id: 'limit-test-3', status: 'planned' }));
      
      const batches = dbManager.getBatchesByStatus('planned', 2);
      
      expect(batches.length).toBe(2);
      expect(batches[0].id).toBe('limit-test-1');
      expect(batches[1].id).toBe('limit-test-2');
    });
  });

  describe('error scenarios', () => {
    it('should handle invalid database path', () => {
      // Create a directory where we can't write a file
      const invalidDir = path.join(process.cwd(), 'invalid-path');
      fs.mkdirSync(invalidDir, { recursive: true });
      fs.chmodSync(invalidDir, 0o444); // Read-only directory

      try {
        const invalidPath = path.join(invalidDir, 'test.db');
        expect(() => new DatabaseManager(invalidPath)).toThrow();
      } finally {
        // Clean up
        fs.chmodSync(invalidDir, 0o777);
        fs.rmdirSync(invalidDir);
      }
    });

    it('should handle SQL constraint violations', () => {
      // Add a media item
      const mediaData = createTestPhoto({ id: 'constraint-test' });
      dbManager.addMediaItem(mediaData);
      
      // Try to add another media item with the same ID
      expect(() => dbManager.addMediaItem(mediaData)).toThrow();
    });
  });

  describe('MIME type operations', () => {
    beforeEach(() => {
      // Add multiple media items with different MIME types
      dbManager.addMediaItem(createTestPhoto({
        id: 'jpeg-photo-1',
        mime_type: 'image/jpeg',
        original_name: 'jpeg-photo.jpg',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestPhoto({
        id: 'png-photo-1',
        mime_type: 'image/png',
        original_name: 'png-photo.png',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestPhoto({
        id: 'png-photo-2',
        mime_type: 'image/png',
        original_name: 'png-photo2.png',
        status: 'uploaded',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'mp4-video-1',
        mime_type: 'video/mp4',
        original_name: 'mp4-video.mp4',
        status: 'pending',
      }));
      
      dbManager.addMediaItem(createTestVideo({
        id: 'webm-video-1',
        mime_type: 'video/webm',
        original_name: 'webm-video.webm',
        status: 'pending',
      }));
    });

    it('should get media items by MIME type', () => {
      const jpegPhotos = dbManager.getMediaByMimeType('image/jpeg');
      const pngPhotos = dbManager.getMediaByMimeType('image/png');
      const mp4Videos = dbManager.getMediaByMimeType('video/mp4');
      
      expect(jpegPhotos.length).toBe(1);
      expect(pngPhotos.length).toBe(2);
      expect(mp4Videos.length).toBe(1);
      
      expect(jpegPhotos[0].id).toBe('jpeg-photo-1');
      expect(pngPhotos.map(item => item.id)).toContain('png-photo-1');
      expect(pngPhotos.map(item => item.id)).toContain('png-photo-2');
      expect(mp4Videos[0].id).toBe('mp4-video-1');
    });

    it('should get media items by MIME type and status', () => {
      const pendingPngPhotos = dbManager.getMediaByMimeTypeAndStatus('image/png', 'pending');
      const uploadedPngPhotos = dbManager.getMediaByMimeTypeAndStatus('image/png', 'uploaded');
      
      expect(pendingPngPhotos.length).toBe(1);
      expect(uploadedPngPhotos.length).toBe(1);
      
      expect(pendingPngPhotos[0].id).toBe('png-photo-1');
      expect(uploadedPngPhotos[0].id).toBe('png-photo-2');
    });

    it('should get count of media items by MIME type', () => {
      const jpegCount = dbManager.getCountByMimeType('image/jpeg');
      const pngCount = dbManager.getCountByMimeType('image/png');
      const mp4Count = dbManager.getCountByMimeType('video/mp4');
      const webmCount = dbManager.getCountByMimeType('video/webm');
      const nonExistentCount = dbManager.getCountByMimeType('application/pdf');
      
      expect(jpegCount).toBe(1);
      expect(pngCount).toBe(2);
      expect(mp4Count).toBe(1);
      expect(webmCount).toBe(1);
      expect(nonExistentCount).toBe(0);
    });
  });
}); 