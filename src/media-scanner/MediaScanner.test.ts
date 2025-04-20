import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaScanner } from './MediaScanner';
import { DatabaseManager, MediaItem } from '../utils/database';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

// Mock the child_process module
vi.mock('child_process');
// Mock the DatabaseManager
vi.mock('../utils/database');
// Mock fs module for existsSync and accessSync checks
vi.mock('fs');

// Helper to create a mock ChildProcess
const createMockProcess = (stdout = '', stderr = '', exitCode = 0) => {
  const mockProcess = new EventEmitter() as any; // Use EventEmitter for close/error events
  mockProcess.stdout = new EventEmitter();
  mockProcess.stderr = new EventEmitter();

  // Function to simulate emitting data and closing
  mockProcess.run = () => {
    if (stdout) mockProcess.stdout.emit('data', Buffer.from(stdout));
    if (stderr) mockProcess.stderr.emit('data', Buffer.from(stderr));
    mockProcess.emit('close', exitCode);
  };
  
  // Function to simulate an error during spawn
  mockProcess.triggerSpawnError = (error: Error) => {
    mockProcess.emit('error', error);
  };

  return mockProcess;
};


describe('MediaScanner', () => {
  let mockDbManager: ReturnType<typeof vi.mocked<any>>; // Use any for mocked constructor
  let mediaScanner: MediaScanner;
  const originalPlatform = process.platform; // Store original platform
  const MOCK_EXECUTABLE_PATH = path.join(process.cwd(), 'bin', 'MediaScannerMac');

  // Sample Swift output JSON
  const mockSwiftOutput = JSON.stringify([
    {
      localIdentifier: 'ID1',
      originalPath: null,
      originalFilename: 'image1.jpg',
      uti: 'public.jpeg',
      creationDate: '2024-01-01T10:00:00.000Z',
      modificationDate: '2024-01-01T11:00:00.000Z',
      sizeBytes: 1024,
      pixelWidth: 1920,
      pixelHeight: 1080,
      isInCloud: false,
      mediaType: 'photo',
      durationSeconds: null,
      codec: null,
    },
    {
      localIdentifier: 'ID2',
      originalPath: null,
      originalFilename: 'video1.mov',
      uti: 'com.apple.quicktime-movie',
      creationDate: '2024-01-02T12:00:00.000Z',
      modificationDate: '2024-01-02T13:00:00.000Z',
      sizeBytes: 512000,
      pixelWidth: 1280,
      pixelHeight: 720,
      isInCloud: true,
      mediaType: 'video',
      durationSeconds: 30.5,
      codec: 'h264',
    },
  ]);

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Mock DatabaseManager instance and methods
    mockDbManager = {
      initialize: vi.fn().mockReturnValue(true), // Assume initialization succeeds
      addMediaBatch: vi.fn(),
      getMediaById: vi.fn().mockReturnValue(undefined), // Default: item doesn't exist
    };
    // Mock the constructor to return our mock instance
    vi.mocked(DatabaseManager).mockImplementation(() => mockDbManager);

    // Mock fs checks - Assume executable exists by default
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.accessSync).mockImplementation(() => {}); // No error = executable

    // Set platform to darwin for most tests
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    // Instantiate MediaScanner with the mocked DB manager
    mediaScanner = new MediaScanner(mockDbManager as unknown as DatabaseManager);
  });

  afterEach(() => {
      // Restore original platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should initialize and check for Swift executable on macOS', () => {
    expect(fs.existsSync).toHaveBeenCalledWith(MOCK_EXECUTABLE_PATH);
    // Constructor doesn't call accessSync, scanLibrary does
    // expect(fs.accessSync).toHaveBeenCalledWith(MOCK_EXECUTABLE_PATH, fs.constants.X_OK);
    expect(DatabaseManager).toHaveBeenCalledTimes(1);
    expect(mediaScanner).toBeDefined();
  });

  it('should skip scan and resolve if not on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // Re-instantiate after changing platform
    mediaScanner = new MediaScanner(mockDbManager as unknown as DatabaseManager);
    const spawnMock = vi.mocked(require('child_process').spawn);

    await expect(mediaScanner.scanLibrary()).resolves.toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

  it('should reject if Swift executable does not exist or is not executable', async () => {
    vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('Access denied'); });
    
    // Re-instantiate to trigger check
    mediaScanner = new MediaScanner(mockDbManager as unknown as DatabaseManager);

    await expect(mediaScanner.scanLibrary()).rejects.toThrow(/Swift executable not found or not executable/);
  });

  it('should spawn Swift process, parse output, and add items to DB', async () => {
    const mockProcess = createMockProcess(mockSwiftOutput);
    const spawnMock = vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess);
    
    // Make getMediaById return undefined for both items (they are new)
    vi.mocked(mockDbManager.getMediaById).mockReturnValue(undefined); 

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run(); // Simulate process running and exiting successfully
    
    await expect(scanPromise).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledWith(MOCK_EXECUTABLE_PATH, [], expect.anything());
    expect(mockDbManager.initialize).toHaveBeenCalled();
    expect(mockDbManager.getMediaById).toHaveBeenCalledTimes(2);
    expect(mockDbManager.getMediaById).toHaveBeenCalledWith('ID1');
    expect(mockDbManager.getMediaById).toHaveBeenCalledWith('ID2');
    expect(mockDbManager.addMediaBatch).toHaveBeenCalledTimes(1);
    
    // Check the argument passed to addMediaBatch
    const addedItems = vi.mocked(mockDbManager.addMediaBatch).mock.calls[0][0];
    expect(addedItems).toHaveLength(2);
    expect(addedItems[0]).toMatchObject({
        id: 'ID1',
        media_type: 'photo',
        mime_type: 'public.jpeg',
        original_name: 'image1.jpg',
        original_path: 'urn:apple:photos:library:asset:ID1',
        creation_date: '2024-01-01T10:00:00.000Z',
        size_bytes: 1024,
        pixel_size: '1920x1080',
        status: 'pending',
    });
     expect(addedItems[1]).toMatchObject({
        id: 'ID2',
        media_type: 'video',
        mime_type: 'com.apple.quicktime-movie',
        original_name: 'video1.mov',
        original_path: 'urn:apple:photos:library:asset:ID2',
        creation_date: '2024-01-02T12:00:00.000Z',
        size_bytes: 512000,
        pixel_size: '1280x720',
        duration_seconds: 30.5,
        codec: 'h264',
        status: 'pending',
    });
  });

  it('should skip items that already exist in the database', async () => {
    const mockProcess = createMockProcess(mockSwiftOutput);
    const spawnMock = vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess);

    // Simulate ID1 existing, ID2 being new
    vi.mocked(mockDbManager.getMediaById)
      .mockReturnValueOnce({ id: 'ID1' } as MediaItem) // Mock existing item for ID1
      .mockReturnValueOnce(undefined); // ID2 does not exist

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();

    await expect(scanPromise).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(mockDbManager.getMediaById).toHaveBeenCalledTimes(2);
    expect(mockDbManager.getMediaById).toHaveBeenCalledWith('ID1');
    expect(mockDbManager.getMediaById).toHaveBeenCalledWith('ID2');
    expect(mockDbManager.addMediaBatch).toHaveBeenCalledTimes(1);
    
    const addedItems = vi.mocked(mockDbManager.addMediaBatch).mock.calls[0][0];
    expect(addedItems).toHaveLength(1); // Only ID2 should be added
    expect(addedItems[0].id).toBe('ID2');
  });

  it('should handle empty output from Swift process', async () => {
    const mockProcess = createMockProcess(''); // Empty stdout
    const spawnMock = vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess);

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();

    await expect(scanPromise).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(mockDbManager.getMediaById).not.toHaveBeenCalled();
    expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

  it('should reject if Swift process exits with non-zero code', async () => {
    const mockProcess = createMockProcess('', 'Some error', 1); // Exit code 1
    const spawnMock = vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess);

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();

    await expect(scanPromise).rejects.toThrow(/Swift process exited with non-zero code 1/);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

  it('should reject if Swift process emits an error', async () => {
      const mockProcess = createMockProcess();
      const spawnMock = vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess);
      const testError = new Error('Spawn failed');

      const scanPromise = mediaScanner.scanLibrary();
      mockProcess.triggerSpawnError(testError); // Simulate spawn error

      await expect(scanPromise).rejects.toThrow('Spawn failed');
      expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('should reject if JSON parsing fails', async () => {
      const mockProcess = createMockProcess('invalid json');
      const spawnMock = vi.mocked(require('child_process').spawn).mockReturnValue(mockProcess);

      const scanPromise = mediaScanner.scanLibrary();
      mockProcess.run();

      await expect(scanPromise).rejects.toThrow(/JSON parse error/);
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

}); 