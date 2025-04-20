import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyMigrations } from './migrations';
import { DatabaseManager } from './database';

// Mock the database and logger
vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }
}));

describe('Database Migrations', () => {
  let mockDb: any;
  let mockDbManager: any;
  let mockExec: any;
  let mockPrepare: any;
  let mockRun: any;

  beforeEach(() => {
    mockRun = vi.fn();
    mockPrepare = vi.fn((sql: string) => ({
      all: () => [],
      run: mockRun
    }));
    mockExec = vi.fn();
    mockDb = {
      exec: mockExec,
      prepare: mockPrepare
    };
    mockDbManager = {
      initialize: vi.fn(),
      db: mockDb
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should create migrations table if it does not exist', () => {
    applyMigrations(mockDbManager as unknown as DatabaseManager);
    
    // Check if migrations table is created
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS migrations'));
  });

  it('should add is_in_icloud column if it does not exist', () => {
    mockPrepare.mockImplementation((sql: string) => {
      if (sql === 'SELECT id FROM migrations') {
        return { all: () => [], run: mockRun };
      }
      if (sql === 'PRAGMA table_info(media_items)') {
        return { all: () => [{ name: 'id' }, { name: 'status' }], run: mockRun };
      }
      return { all: () => [], run: mockRun };
    });
    
    applyMigrations(mockDbManager as unknown as DatabaseManager);
    
    // Check that ALTER TABLE was called to add the column
    expect(mockExec).toHaveBeenCalledWith('ALTER TABLE media_items ADD COLUMN is_in_icloud INTEGER DEFAULT 0');
    
    // Check if the migration was recorded
    expect(mockRun).toHaveBeenCalledWith(
      '2023-04-20-add-is-in-icloud', 
      expect.any(String), 
      'Add is_in_icloud column to media_items table'
    );
  });

  it('should not add is_in_icloud column if it already exists', () => {
    mockPrepare.mockImplementation((sql: string) => {
      if (sql === 'SELECT id FROM migrations') {
        return { all: () => [], run: mockRun };
      }
      if (sql === 'PRAGMA table_info(media_items)') {
        return { all: () => [{ name: 'id' }, { name: 'is_in_icloud' }], run: mockRun };
      }
      return { all: () => [], run: mockRun };
    });
    
    applyMigrations(mockDbManager as unknown as DatabaseManager);
    
    // Check that ALTER TABLE was NOT called
    expect(mockExec).not.toHaveBeenCalledWith('ALTER TABLE media_items ADD COLUMN is_in_icloud INTEGER DEFAULT 0');
    
    // But we should still record the migration as completed
    expect(mockRun).toHaveBeenCalledWith(
      '2023-04-20-add-is-in-icloud', 
      expect.any(String), 
      'Add is_in_icloud column to media_items table'
    );
  });

  it('should not apply migration if already applied', () => {
    mockPrepare.mockImplementation((sql: string) => {
      if (sql === 'SELECT id FROM migrations') {
        return { all: () => [{ id: '2023-04-20-add-is-in-icloud' }], run: mockRun };
      }
      // Should never reach PRAGMA in this test
      return { all: () => [], run: mockRun };
    });
    
    applyMigrations(mockDbManager as unknown as DatabaseManager);
    
    // Check that PRAGMA never called (we know we can skip)
    expect(mockPrepare).not.toHaveBeenCalledWith('PRAGMA table_info(media_items)');
    
    // CHECK that we never inserted this migration again
    expect(mockRun).not.toHaveBeenCalled();
  });
}); 