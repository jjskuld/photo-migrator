import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseManager, MediaItem, Batch } from './database';

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
const createTestPhoto = (override: Partial<Omit<MediaItem, 'retry_count'>> = {}): Omit<MediaItem, 'retry_count'> => ({
  id: `test-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  original_path: '/path/to/photo.jpg',
  original_name: 'photo.jpg',
  size_bytes: 1024,
  status: 'pending',
  ...override,
});

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

  describe('addPhoto', () => {
    it('should add a photo to the database', () => {
      const photoData = createTestPhoto({
        id: 'test-id-1',
        original_path: '/path/to/photo.jpg',
        local_copy_path: '/temp/photo.jpg',
        google_photos_id: 'google-123',
        error_message: undefined,
      });

      const id = dbManager.addPhoto(photoData);
      
      expect(id).toBe('test-id-1');
      
      // Verify the photo was added
      const photos = dbManager.getPhotosByStatus('pending');
      expect(photos.length).toBe(1);
      expect(photos[0].id).toBe('test-id-1');
      expect(photos[0].original_path).toBe('/path/to/photo.jpg');
      expect(photos[0].local_copy_path).toBe('/temp/photo.jpg');
      expect(photos[0].google_photos_id).toBe('google-123');
      expect(photos[0].size_bytes).toBe(1024);
      expect(photos[0].retry_count).toBe(0);
    });

    it('should fail with a unique constraint error if trying to add a photo with existing id', () => {
      const photoData = createTestPhoto({ id: 'duplicate-id' });
      
      // Add the photo once
      dbManager.addPhoto(photoData);
      
      // Try to add again with the same ID
      expect(() => dbManager.addPhoto(photoData)).toThrow();
    });
  });

  describe('addPhotoBatch', () => {
    it('should add multiple photos in a batch transaction', () => {
      const photos = [
        createTestPhoto({ id: 'batch-1', original_name: 'photo1.jpg' }),
        createTestPhoto({ id: 'batch-2', original_name: 'photo2.jpg' }),
        createTestPhoto({ id: 'batch-3', original_name: 'photo3.jpg' }),
      ];
      
      const ids = dbManager.addPhotoBatch(photos);
      
      expect(ids).toHaveLength(3);
      expect(ids).toContain('batch-1');
      expect(ids).toContain('batch-2');
      expect(ids).toContain('batch-3');
      
      // Verify all photos were added
      const pendingPhotos = dbManager.getPendingPhotos(10);
      expect(pendingPhotos.length).toBe(3);
    });

    it('should return an empty array if no photos are provided', () => {
      const ids = dbManager.addPhotoBatch([]);
      expect(ids).toHaveLength(0);
    });
  });

  describe('updatePhotoStatus', () => {
    it('should update the status of a photo', () => {
      // First add a photo
      const photoData = createTestPhoto({ id: 'test-id-2' });
      
      dbManager.addPhoto(photoData);
      
      // Update the status
      const result = dbManager.updatePhotoStatus('test-id-2', 'uploaded', 'Successfully uploaded');
      
      expect(result).toBe(true);
      
      // Verify the status was updated
      const photos = dbManager.getPhotosByStatus('uploaded');
      expect(photos.length).toBe(1);
      expect(photos[0].id).toBe('test-id-2');
      expect(photos[0].status).toBe('uploaded');
      expect(photos[0].error_message).toBe('Successfully uploaded');
    });

    it('should return false when updating a non-existent photo', () => {
      const result = dbManager.updatePhotoStatus('non-existent-id', 'uploaded');
      
      expect(result).toBe(false);
    });
  });

  describe('updateGooglePhotosId', () => {
    it('should update the Google Photos ID for a photo', () => {
      // First add a photo
      const photoData = createTestPhoto({ id: 'google-update-test' });
      
      dbManager.addPhoto(photoData);
      
      // Update the Google Photos ID
      const result = dbManager.updateGooglePhotosId('google-update-test', 'google-photos-id-123');
      
      expect(result).toBe(true);
      
      // Verify the Google Photos ID was updated
      const photo = dbManager.getPhotoById('google-update-test');
      expect(photo).toBeDefined();
      expect(photo?.google_photos_id).toBe('google-photos-id-123');
    });

    it('should return false when updating a non-existent photo', () => {
      const result = dbManager.updateGooglePhotosId('non-existent-id', 'test-id');
      
      expect(result).toBe(false);
    });
  });

  describe('updateLocalCopyPath', () => {
    it('should update the local copy path for a photo', () => {
      // First add a photo
      const photoData = createTestPhoto({ id: 'local-path-test' });
      
      dbManager.addPhoto(photoData);
      
      // Update the local copy path
      const result = dbManager.updateLocalCopyPath('local-path-test', '/tmp/exported/photo.jpg');
      
      expect(result).toBe(true);
      
      // Verify the local copy path was updated
      const photo = dbManager.getPhotoById('local-path-test');
      expect(photo).toBeDefined();
      expect(photo?.local_copy_path).toBe('/tmp/exported/photo.jpg');
    });

    it('should return false when updating a non-existent photo', () => {
      const result = dbManager.updateLocalCopyPath('non-existent-id', '/tmp/not-found.jpg');
      
      expect(result).toBe(false);
    });
  });

  describe('getPhotosByStatus and getPendingPhotos', () => {
    beforeEach(() => {
      // Add multiple photos with different statuses
      dbManager.addPhoto(createTestPhoto({
        id: 'pending-1',
        original_path: '/path/pending1.jpg',
        original_name: 'pending1.jpg',
        status: 'pending',
      }));
      
      dbManager.addPhoto(createTestPhoto({
        id: 'pending-2',
        original_path: '/path/pending2.jpg',
        original_name: 'pending2.jpg',
        status: 'pending',
      }));
      
      dbManager.addPhoto(createTestPhoto({
        id: 'uploaded-1',
        original_path: '/path/uploaded1.jpg',
        original_name: 'uploaded1.jpg',
        status: 'uploaded',
      }));
    });

    it('should return photos with the specified status', () => {
      const pendingPhotos = dbManager.getPhotosByStatus('pending');
      const uploadedPhotos = dbManager.getPhotosByStatus('uploaded');
      
      expect(pendingPhotos.length).toBe(2);
      expect(uploadedPhotos.length).toBe(1);
      
      expect(pendingPhotos[0].id).toBe('pending-1');
      expect(pendingPhotos[1].id).toBe('pending-2');
      expect(uploadedPhotos[0].id).toBe('uploaded-1');
    });

    it('should respect the limit parameter', () => {
      const pendingPhotos = dbManager.getPhotosByStatus('pending', 1);
      
      expect(pendingPhotos.length).toBe(1);
      expect(pendingPhotos[0].id).toBe('pending-1');
    });

    it('getPendingPhotos should return the same results as getPhotosByStatus', () => {
      const pendingUsingGeneric = dbManager.getPhotosByStatus('pending');
      const pendingUsingSpecific = dbManager.getPendingPhotos();
      
      expect(pendingUsingSpecific.length).toBe(pendingUsingGeneric.length);
      expect(pendingUsingSpecific[0].id).toBe(pendingUsingGeneric[0].id);
    });
  });

  describe('getPhotoByHash', () => {
    beforeEach(() => {
      dbManager.addPhoto(createTestPhoto({
        id: 'hash-test',
        original_path: '/path/hash-test.jpg',
        original_name: 'hash-test.jpg',
        sha256_hash: 'test-hash-value',
        status: 'pending',
      }));
    });

    it('should return a photo with the matching hash', () => {
      const photo = dbManager.getPhotoByHash('test-hash-value');
      
      expect(photo).toBeDefined();
      expect(photo?.id).toBe('hash-test');
    });

    it('should return undefined for a non-existent hash', () => {
      const photo = dbManager.getPhotoByHash('non-existent-hash');
      
      expect(photo).toBeUndefined();
    });
  });

  describe('getPhotoById', () => {
    beforeEach(() => {
      dbManager.addPhoto(createTestPhoto({
        id: 'id-test',
        original_path: '/path/id-test.jpg',
        original_name: 'id-test.jpg',
        status: 'pending',
      }));
    });

    it('should return a photo with the matching id', () => {
      const photo = dbManager.getPhotoById('id-test');
      
      expect(photo).toBeDefined();
      expect(photo?.original_path).toBe('/path/id-test.jpg');
    });

    it('should return undefined for a non-existent id', () => {
      const photo = dbManager.getPhotoById('non-existent-id');
      
      expect(photo).toBeUndefined();
    });
  });

  describe('count methods', () => {
    beforeEach(() => {
      // Add photos with different statuses
      dbManager.addPhoto(createTestPhoto({ id: 'p1', original_path: '/p1', original_name: 'p1.jpg', status: 'pending' }));
      dbManager.addPhoto(createTestPhoto({ id: 'p2', original_path: '/p2', original_name: 'p2.jpg', status: 'pending' }));
      dbManager.addPhoto(createTestPhoto({ id: 'u1', original_path: '/u1', original_name: 'u1.jpg', status: 'uploaded' }));
      dbManager.addPhoto(createTestPhoto({ id: 'f1', original_path: '/f1', original_name: 'f1.jpg', status: 'failed' }));
    });

    it('should return the total count of photos', () => {
      const totalCount = dbManager.getTotalCount();
      
      expect(totalCount).toBe(4);
    });

    it('should return the count of photos by status', () => {
      const pendingCount = dbManager.getCountByStatus('pending');
      const uploadedCount = dbManager.getCountByStatus('uploaded');
      const failedCount = dbManager.getCountByStatus('failed');
      const exportedCount = dbManager.getCountByStatus('exported');
      
      expect(pendingCount).toBe(2);
      expect(uploadedCount).toBe(1);
      expect(failedCount).toBe(1);
      expect(exportedCount).toBe(0);
    });

    it('getCompletedCount should return the same results as getCountByStatus for uploaded', () => {
      const usingGeneric = dbManager.getCountByStatus('uploaded');
      const usingSpecific = dbManager.getCompletedCount();
      
      expect(usingSpecific).toBe(usingGeneric);
    });
  });

  describe('incrementRetryCount', () => {
    beforeEach(() => {
      dbManager.addPhoto(createTestPhoto({
        id: 'retry-test',
        original_path: '/path/retry-test.jpg',
        original_name: 'retry-test.jpg',
        status: 'failed',
      }));
    });

    it('should increment the retry count for a photo', () => {
      const newCount = dbManager.incrementRetryCount('retry-test');
      
      expect(newCount).toBe(1);
      
      // Increment again
      const secondCount = dbManager.incrementRetryCount('retry-test');
      
      expect(secondCount).toBe(2);
      
      // Verify in the database
      const photo = dbManager.getPhotoById('retry-test');
      expect(photo?.retry_count).toBe(2);
    });

    it('should return -1 for a non-existent photo', () => {
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
      // Add a photo
      const photoData = createTestPhoto({ id: 'constraint-test' });
      dbManager.addPhoto(photoData);
      
      // Try to add another photo with the same ID
      expect(() => dbManager.addPhoto(photoData)).toThrow();
    });
  });
}); 