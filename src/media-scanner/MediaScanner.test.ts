import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaScanner } from './MediaScanner';
import { DatabaseManager, MediaItem, MediaStatus } from '../utils/database';
import { AuthManager } from '../auth/AuthManager';
import axios from 'axios';
import fs from 'fs';
import { Readable } from 'stream';
import { spawn } from 'child_process'; // Import the original spawn
import path from 'path';
import { EventEmitter } from 'events'; // Import EventEmitter

// Mocks
vi.mock('../utils/database');
vi.mock('../auth/AuthManager');
vi.mock('axios');
vi.mock('fs');
// Mock child_process selectively
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual, // Keep other exports from the module if needed
    spawn: vi.fn(), // Mock only the spawn function
  };
});

// Get a typed reference to the mocked spawn function AFTER mocks are defined
const mockedSpawn = vi.mocked(spawn);

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

describe('MediaScanner', () => {
  let mockDbManager: ReturnType<typeof vi.mocked<any>>;
  let mediaScanner: MediaScanner;
  const originalPlatform = process.platform;
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
    vi.resetAllMocks();

    // Mock DatabaseManager instance methods
    mockDbManager = {
      initialize: vi.fn().mockReturnValue(true),
      addMediaBatch: vi.fn(),
      getMediaById: vi.fn().mockReturnValue(undefined),
    };
    // Mock the DatabaseManager constructor to return our instance
    vi.mocked(DatabaseManager).mockImplementation(() => mockDbManager as unknown as DatabaseManager);
    
    // Mock fs checks
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.accessSync).mockImplementation(() => {});

    // Set platform to darwin for most tests
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    // Instantiate AFTER mocks are set up
    mediaScanner = new MediaScanner(mockDbManager as unknown as DatabaseManager);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should initialize and check for Swift executable on macOS', () => {
    expect(fs.existsSync).toHaveBeenCalledWith(MOCK_EXECUTABLE_PATH);
    // expect(DatabaseManager).toHaveBeenCalledTimes(1); // Check constructor call - REMOVED as constructor is mocked
    expect(mediaScanner).toBeDefined();
  });

  it('should skip scan and resolve if not on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // Re-instantiate with the new platform value active
    mediaScanner = new MediaScanner(mockDbManager as unknown as DatabaseManager);

    await expect(mediaScanner.scanLibrary()).resolves.toBeUndefined();
    expect(mockedSpawn).not.toHaveBeenCalled(); // Use the mocked reference
    expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

  it('should reject if Swift executable does not exist or is not executable', async () => {
    vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('Access denied'); });
    // No need to re-instantiate, check happens in scanLibrary
    await expect(mediaScanner.scanLibrary()).rejects.toThrow(/Swift executable not found or not executable/);
    expect(mockedSpawn).not.toHaveBeenCalled(); // Spawn shouldn't be called
  });

  it('should spawn Swift process, parse output, and add items to DB', async () => {
    const mockProcess = createMockProcess(mockSwiftOutput);
    mockedSpawn.mockReturnValue(mockProcess); // Use the mocked reference
    
    vi.mocked(mockDbManager.getMediaById).mockReturnValue(undefined); 

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();
    
    await expect(scanPromise).resolves.toBeUndefined();

    expect(mockedSpawn).toHaveBeenCalledWith(MOCK_EXECUTABLE_PATH, [], expect.anything());
    expect(mockDbManager.initialize).toHaveBeenCalled();
    expect(mockDbManager.getMediaById).toHaveBeenCalledTimes(2);
    expect(mockDbManager.getMediaById).toHaveBeenCalledWith('ID1');
    expect(mockDbManager.getMediaById).toHaveBeenCalledWith('ID2');
    expect(mockDbManager.addMediaBatch).toHaveBeenCalledTimes(1);
    
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
    mockedSpawn.mockReturnValue(mockProcess);

    vi.mocked(mockDbManager.getMediaById)
      .mockReturnValueOnce({ id: 'ID1' } as MediaItem)
      .mockReturnValueOnce(undefined);

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();

    await expect(scanPromise).resolves.toBeUndefined();

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockDbManager.getMediaById).toHaveBeenCalledTimes(2);
    expect(mockDbManager.addMediaBatch).toHaveBeenCalledTimes(1);
    
    const addedItems = vi.mocked(mockDbManager.addMediaBatch).mock.calls[0][0];
    expect(addedItems).toHaveLength(1);
    expect(addedItems[0].id).toBe('ID2');
  });

  it('should handle empty output from Swift process', async () => {
    const mockProcess = createMockProcess('');
    mockedSpawn.mockReturnValue(mockProcess);

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();

    await expect(scanPromise).resolves.toBeUndefined();
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockDbManager.getMediaById).not.toHaveBeenCalled();
    expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

  it('should reject if Swift process exits with non-zero code', async () => {
    const mockProcess = createMockProcess('', 'Some error', 1);
    mockedSpawn.mockReturnValue(mockProcess);

    const scanPromise = mediaScanner.scanLibrary();
    mockProcess.run();

    await expect(scanPromise).rejects.toThrow(/Swift process exited with non-zero code 1/);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

  it('should reject if Swift process emits an error', async () => {
      const mockProcess = createMockProcess();
      mockedSpawn.mockReturnValue(mockProcess);
      const testError = new Error('Spawn failed');

      const scanPromise = mediaScanner.scanLibrary();
      // Simulate process emitting error BEFORE run() is called (spawn failure)
      mockProcess.triggerSpawnError(testError); 

      await expect(scanPromise).rejects.toThrow('Spawn failed');
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
      // mockProcess.run() might not even get called if spawn fails
  });

  it('should reject if JSON parsing fails', async () => {
      const mockProcess = createMockProcess('invalid json');
      mockedSpawn.mockReturnValue(mockProcess);

      const scanPromise = mediaScanner.scanLibrary();
      mockProcess.run();

      await expect(scanPromise).rejects.toThrow(/JSON parse error/);
      expect(mockedSpawn).toHaveBeenCalledTimes(1);
      expect(mockDbManager.addMediaBatch).not.toHaveBeenCalled();
  });

}); 