import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Uploader } from './Uploader';
import { DatabaseManager, MediaItem, MediaStatus } from '../utils/database';
import { AuthManager } from '../auth/AuthManager';
import axios from 'axios';
import fs from 'fs';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mocks
vi.mock('../utils/database');
vi.mock('../auth/AuthManager');
vi.mock('axios');
vi.mock('fs');

// Helper to create a readable stream that mimics fs.ReadStream
const createMockReadStream = () => {
  const stream = new Readable() as any; // Start with Readable, cast to any to add properties
  stream._read = () => {}; // Noop _read implementation
  stream.path = '/mock/path'; // Add dummy path property
  stream.bytesRead = 0; // Add dummy bytesRead property
  stream.pending = false; // Add dummy pending property
  // Add a dummy close method
  stream.close = (callback?: (err?: NodeJS.ErrnoException | null) => void) => { 
    stream.emit('close');
    if (callback) process.nextTick(callback);
  };
  // Add a dummy destroy method (often used internally)
  stream.destroy = (error?: Error) => {
    stream.emit('error', error);
    stream.emit('close');
    return stream;
  };
  return stream as fs.ReadStream; // Cast to the expected type
};

describe('Uploader', () => {
  let uploader: Uploader;
  let mockDbManager: ReturnType<typeof vi.mocked<any>>;
  let mockAuthManager: ReturnType<typeof vi.mocked<any>>;
  let mockAxiosInstance: ReturnType<typeof vi.mocked<any>>;

  const MOCK_ACCESS_TOKEN = 'mock-access-token';
  const MOCK_UPLOAD_TOKEN = 'mock-upload-token';
  const MOCK_GOOGLE_ID = 'mock-google-photos-id';

  const createMockMediaItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    id: 'test-id-1',
    media_type: 'photo',
    mime_type: 'image/jpeg',
    original_path: 'urn:apple:photos:library:asset:test-id-1',
    local_copy_path: '/path/to/local/image.jpg',
    original_name: 'image.jpg',
    status: 'pending',
    retry_count: 0,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock DatabaseManager
    mockDbManager = {
      getPendingMedia: vi.fn().mockReturnValue([]),
      updateMediaStatus: vi.fn(),
      updateGooglePhotosId: vi.fn(),
      incrementRetryCount: vi.fn(), // Needed for error handling TODO
    };
    vi.mocked(DatabaseManager).mockImplementation(() => mockDbManager as unknown as DatabaseManager);

    // Mock AuthManager
    mockAuthManager = {
      getAccessToken: vi.fn().mockResolvedValue(MOCK_ACCESS_TOKEN),
    };
    vi.mocked(AuthManager).mockImplementation(() => mockAuthManager as unknown as AuthManager);

    // Mock Axios DEFAULT implementation for most tests (can be overridden per test)
    mockAxiosInstance = vi.mocked(axios);
    mockAxiosInstance.isAxiosError = vi.fn((error): error is any => !!error?.isAxiosError);
    mockAxiosInstance.mockResolvedValue({ status: 200, data: 'default mock success' }); // Default success

    // Mock fs
    vi.mocked(fs.existsSync).mockReturnValue(true); // Assume file exists by default
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats); // Mock file size
    vi.mocked(fs.createReadStream).mockReturnValue(createMockReadStream()); // Mock stream creation

    uploader = new Uploader(mockDbManager as unknown as DatabaseManager, mockAuthManager as unknown as AuthManager);
  });

  describe('processUploadQueue', () => {
    it('should do nothing if no pending items are found', async () => {
      mockDbManager.getPendingMedia.mockReturnValue([]);
      await uploader.processUploadQueue();
      expect(mockDbManager.getPendingMedia).toHaveBeenCalledWith(5); // Default batch size
      expect(mockAuthManager.getAccessToken).not.toHaveBeenCalled();
    });

    it('should process pending items returned by dbManager', async () => {
      const item1 = createMockMediaItem({ id: 'item1' });
      const item2 = createMockMediaItem({ id: 'item2', local_copy_path: '/path/to/local/image2.jpg' });
      mockDbManager.getPendingMedia.mockReturnValue([item1, item2]);
      
      // Mock successful upload steps for both items
      mockAxiosInstance.mockResolvedValueOnce({ // uploadFileBytes for item1
        status: 200,
        data: MOCK_UPLOAD_TOKEN + '1',
      }).mockResolvedValueOnce({ // createMediaItem for item1
        status: 200,
        data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN + '1', status: { message: 'OK' }, mediaItem: { id: MOCK_GOOGLE_ID + '1' } }] },
      }).mockResolvedValueOnce({ // uploadFileBytes for item2
        status: 200,
        data: MOCK_UPLOAD_TOKEN + '2',
      }).mockResolvedValueOnce({ // createMediaItem for item2
        status: 200,
        data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN + '2', status: { message: 'OK' }, mediaItem: { id: MOCK_GOOGLE_ID + '2' } }] },
      });

      await uploader.processUploadQueue(2);

      expect(mockDbManager.getPendingMedia).toHaveBeenCalledWith(2);
      expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(2);
      expect(mockDbManager.updateMediaStatus).toHaveBeenCalledTimes(2);
      expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith('item1', 'uploaded');
      expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith('item2', 'uploaded');
      expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledTimes(2);
      expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith('item1', MOCK_GOOGLE_ID + '1');
      expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith('item2', MOCK_GOOGLE_ID + '2');
    });

    it('should continue processing remaining items if one fails', async () => {
      const item1 = createMockMediaItem({ id: 'item1' });
      const item2 = createMockMediaItem({ id: 'item2' }); // This one will fail
      const item3 = createMockMediaItem({ id: 'item3' });
      mockDbManager.getPendingMedia.mockReturnValue([item1, item2, item3]);

      // --- Axios Mocking Sequence --- 
      // Item 1: Success (Bytes + Create)
      mockAxiosInstance
        .mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN + '1' }) // Bytes
        .mockResolvedValueOnce({ status: 200, data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN + '1', status: { message: 'OK' }, mediaItem: { id: MOCK_GOOGLE_ID + '1' } }] } }); // Create
      
      // Item 2: Fail Bytes (Non-retriable 400) -> Should stop processing this item
      mockAxiosInstance.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400 }, message: 'Bad Request' });

      // Item 3: Success (Bytes + Create)
      mockAxiosInstance
        .mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN + '3' }) // Bytes
        .mockResolvedValueOnce({ status: 200, data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN + '3', status: { message: 'OK' }, mediaItem: { id: MOCK_GOOGLE_ID + '3' } }] } }); // Create

      await uploader.processUploadQueue(3);

      expect(mockDbManager.getPendingMedia).toHaveBeenCalledWith(3);
      // Auth token needed for item1, item2 (fails), item3
      expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(3);
      
      // Axios calls: item1 (2), item2 (1 failed), item3 (2) = 5 total
      expect(mockAxiosInstance).toHaveBeenCalledTimes(5);
      
      // Check successful items
      expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith('item1', 'uploaded');
      expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith('item1', MOCK_GOOGLE_ID + '1');
      expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith('item3', 'uploaded'); // THIS WAS THE FAILING ASSERTION
      expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith('item3', MOCK_GOOGLE_ID + '3');
      
      // Check failed item
      expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith('item2', 'uploaded');
      expect(mockDbManager.updateGooglePhotosId).not.toHaveBeenCalledWith('item2', expect.anything());
      // TODO: Check for failed status update if implemented
    });
  });

  describe('uploadMediaItem (private method, tested via processUploadQueue)', () => {
    it('should fail if access token cannot be retrieved', async () => {
      const item = createMockMediaItem();
      mockDbManager.getPendingMedia.mockReturnValue([item]);
      mockAuthManager.getAccessToken.mockResolvedValue(null); // Simulate failure

      await uploader.processUploadQueue(1);

      expect(mockAxiosInstance).not.toHaveBeenCalled();
      expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
      // Should log an error, check log spy if needed
    });

    it('should skip and mark as failed if no valid file path exists', async () => {
        const item = createMockMediaItem({ local_copy_path: undefined, original_path: 'urn:apple:photos:library:asset:test-id-1' });
        mockDbManager.getPendingMedia.mockReturnValue([item]);

        await uploader.processUploadQueue(1);

        expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(1); // Token is still fetched
        expect(fs.existsSync).not.toHaveBeenCalled(); // Doesn't get to exists check
        expect(mockAxiosInstance).not.toHaveBeenCalled();
        expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith(item.id, 'failed', 'No local file path available for upload');
    });

    it('should skip and mark as failed if file does not exist at path', async () => {
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);
        vi.mocked(fs.existsSync).mockReturnValue(false); // Simulate file not existing

        await uploader.processUploadQueue(1);

        expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(1);
        expect(fs.existsSync).toHaveBeenCalledWith(item.local_copy_path);
        expect(mockAxiosInstance).not.toHaveBeenCalled();
        expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith(item.id, 'failed', `File not found at expected path: ${item.local_copy_path}`);
    });

    it('should handle failure during byte upload (non-retriable)', async () => {
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);
        // Mock non-retriable error (e.g., 400)
        mockAxiosInstance.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400 }, message: 'Bad Request' }); 

        await uploader.processUploadQueue(1);

        expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(1);
        // Should only be called ONCE because 400 is non-retriable
        expect(mockAxiosInstance).toHaveBeenCalledTimes(1); 
        expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
    });

    it('should handle failure during media item creation', async () => {
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);

        // Mock successful byte upload, failed creation
        mockAxiosInstance.mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN })
                 .mockResolvedValueOnce({ status: 200, data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN, status: { message: 'Failed internally', code: 13 } }] } }); // API error
        
        await uploader.processUploadQueue(1);
        
        expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(1);
        expect(mockAxiosInstance).toHaveBeenCalledTimes(2); // Both calls made
        expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
        // Check logs or potential future 'failed' status update
    });

    it('should successfully upload item and update database', async () => {
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);

         // Mock successful API calls
        mockAxiosInstance.mockResolvedValueOnce({ // uploadFileBytes
            status: 200,
            data: MOCK_UPLOAD_TOKEN,
        }).mockResolvedValueOnce({ // createMediaItem
            status: 200,
            data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN, status: { message: 'OK' }, mediaItem: { id: MOCK_GOOGLE_ID } }] },
        });

        await uploader.processUploadQueue(1);

        expect(mockAuthManager.getAccessToken).toHaveBeenCalledTimes(1);
        expect(fs.existsSync).toHaveBeenCalledWith(item.local_copy_path);
        expect(fs.statSync).toHaveBeenCalledWith(item.local_copy_path);
        expect(fs.createReadStream).toHaveBeenCalledWith(item.local_copy_path);
        expect(mockAxiosInstance).toHaveBeenCalledTimes(2); 
        
        // Check uploadFileBytes call details (example)
        expect(mockAxiosInstance.mock.calls[0][0]).toMatchObject({
            method: 'post',
            url: 'https://photoslibrary.googleapis.com/v1/uploads',
            headers: expect.objectContaining({
                'Authorization': `Bearer ${MOCK_ACCESS_TOKEN}`,
                'Content-Type': 'application/octet-stream',
                'X-Goog-Upload-Content-Type': item.mime_type,
                'Content-Length': '1024',
            }),
        });
        // Check createMediaItem call details (example)
         expect(mockAxiosInstance.mock.calls[1][0]).toMatchObject({
            method: 'post',
            url: 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate',
            headers: expect.objectContaining({
                'Authorization': `Bearer ${MOCK_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            }),
            data: {
                 newMediaItems: [
                    {
                        description: item.original_name,
                        simpleMediaItem: { uploadToken: MOCK_UPLOAD_TOKEN },
                    },
                ],
            },
        });
        
        // Check DB updates
        expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith(item.id, 'uploaded');
        expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith(item.id, MOCK_GOOGLE_ID);
    });

    it('should retry byte upload on 5xx error and succeed on retry', async () => {
        mockAxiosInstance.mockReset(); // Reset mock before test
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);

        // Mock 503 then 200 for byte upload, then successful creation
        mockAxiosInstance
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 }, message: 'Service Unavailable' })
            .mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN }) // Successful byte upload on retry
            .mockResolvedValueOnce({ // Successful media item creation - simplified mock
                status: 200,
                data: { 
                    newMediaItemResults: [ 
                        { 
                            uploadToken: MOCK_UPLOAD_TOKEN, 
                            status: { code: 0, message: 'OK' }, // Ensure status object exists
                            mediaItem: { id: MOCK_GOOGLE_ID } 
                        }
                    ] 
                },
            });

        await uploader.processUploadQueue(1);

        // Axios called 3 times: 1 fail (bytes), 1 success (bytes), 1 success (create)
        expect(mockAxiosInstance).toHaveBeenCalledTimes(3); // Reverted expected calls
        expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith(item.id, 'uploaded');
        expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith(item.id, MOCK_GOOGLE_ID);
    });
    
    it('should bail byte upload immediately on 401 error', async () => {
        mockAxiosInstance.mockReset(); // Reset mock before test
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);

        // Mock 401 for byte upload
        mockAxiosInstance.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401 }, message: 'Unauthorized' });

        await uploader.processUploadQueue(1);

        // Axios called only once for the failed byte upload
        expect(mockAxiosInstance).toHaveBeenCalledTimes(1);
        expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
        // Check logs or future 'failed' status update for 401
    });

    it('should exhaust retries for byte upload if 5xx error persists', async () => {
        mockAxiosInstance.mockReset(); // Reset mock before test
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);
        const MAX_RETRIES_BYTES = 5; 

        // Mock persistent 500 error for byte upload
        mockAxiosInstance.mockRejectedValue({ isAxiosError: true, response: { status: 500 }, message: 'Internal Server Error' });

        await uploader.processUploadQueue(1);

        // Check that it was called at least initial + retries times
        expect(mockAxiosInstance.mock.calls.length).toBeGreaterThanOrEqual(1 + MAX_RETRIES_BYTES);
        expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
    }, 60000); // Increase timeout significantly for this test
    
    // --- Tests for createMediaItem retry logic --- 

    it('should retry media item creation on 5xx error and succeed on retry', async () => {
        mockAxiosInstance.mockReset(); // Reset mock before test
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);

        // Mock successful byte upload
        mockAxiosInstance.mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN })
            // Mock 500 then 200 for media item creation
            .mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 }, message: 'Internal Error' })
            .mockResolvedValueOnce({ 
                status: 200, 
                data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN, status: { message: 'OK' }, mediaItem: { id: MOCK_GOOGLE_ID } }] } 
            });

        await uploader.processUploadQueue(1);

        // Axios called 3 times: 1 success (bytes), 1 fail (create), 1 success (create)
        expect(mockAxiosInstance).toHaveBeenCalledTimes(3); // Reverted expected calls
        expect(mockDbManager.updateMediaStatus).toHaveBeenCalledWith(item.id, 'uploaded');
        expect(mockDbManager.updateGooglePhotosId).toHaveBeenCalledWith(item.id, MOCK_GOOGLE_ID);
    });

    it('should fail permanently if media item creation fails with invalid token error', async () => {
        mockAxiosInstance.mockReset(); // Reset mock before test
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);

        // Mock successful byte upload
        mockAxiosInstance.mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN })
             // Mock media item creation failure due to invalid token
             .mockResolvedValueOnce({ 
                 status: 200, 
                 data: { newMediaItemResults: [{ uploadToken: MOCK_UPLOAD_TOKEN, status: { message: 'Invalid upload token', code: 3 } }] } 
             }); 

        await uploader.processUploadQueue(1);

        // Axios called twice: 1 success (bytes), 1 failure (create) - should not retry invalid token
        expect(mockAxiosInstance).toHaveBeenCalledTimes(2);
        expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
    });

     it('should exhaust retries for media item creation if 5xx error persists', async () => {
        mockAxiosInstance.mockReset(); // Reset mock before test
        const item = createMockMediaItem();
        mockDbManager.getPendingMedia.mockReturnValue([item]);
        const MAX_RETRIES_CREATE = 3;

        // Mock successful byte upload
        mockAxiosInstance.mockResolvedValueOnce({ status: 200, data: MOCK_UPLOAD_TOKEN })
             // Mock persistent 500 for media item creation
             .mockRejectedValue({ isAxiosError: true, response: { status: 500 }, message: 'Internal Server Error' });

        await uploader.processUploadQueue(1);

        // Check that it was called at least 1 (bytes) + 1 (initial create) + MAX_RETRIES_CREATE times
        expect(mockAxiosInstance.mock.calls.length).toBeGreaterThanOrEqual(1 + 1 + MAX_RETRIES_CREATE);
        expect(mockDbManager.updateMediaStatus).not.toHaveBeenCalledWith(item.id, 'uploaded');
    }, 20000); // Increase timeout further for this test

  });

}); 