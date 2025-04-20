import { DatabaseManager } from './database';
import { logger } from './logger';

interface Migration {
  id: string;
  description: string;
  apply: (db: DatabaseManager) => void;
}

/**
 * Collection of database migrations to be applied in order.
 * Each migration should have a unique ID and should be idempotent.
 */
const migrations: Migration[] = [
  {
    id: '2023-04-20-add-is-in-icloud',
    description: 'Add is_in_icloud column to media_items table',
    apply: (db: DatabaseManager) => {
      try {
        // Check if column already exists to make migration idempotent
        const stmt = db['db'].prepare(`PRAGMA table_info(media_items)`);
        const columns = stmt.all();
        const columnExists = columns.some((col: any) => col.name === 'is_in_icloud');
        
        if (!columnExists) {
          logger.info('Applying migration: Adding is_in_icloud column to media_items table');
          db['db'].exec(`ALTER TABLE media_items ADD COLUMN is_in_icloud INTEGER DEFAULT 0`);
          logger.info('Migration successful: Added is_in_icloud column');
        } else {
          logger.info('Migration skipped: is_in_icloud column already exists');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Migration failed: ${errorMessage}`, { error });
        throw error;
      }
    }
  }
];

/**
 * Applies all pending migrations to the database.
 * Migrations are tracked in a migrations table.
 * @param db DatabaseManager instance
 */
export function applyMigrations(db: DatabaseManager): void {
  try {
    logger.info('Applying database migrations...');
    
    // First ensure the database is initialized
    db.initialize();
    
    // Create migrations table if it doesn't exist
    db['db'].exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT
      )
    `);
    
    // Get list of already applied migrations
    const appliedMigrations = db['db'].prepare('SELECT id FROM migrations').all().map((row: any) => row.id);
    
    // Apply each migration that hasn't been applied yet
    for (const migration of migrations) {
      if (!appliedMigrations.includes(migration.id)) {
        logger.info(`Applying migration: ${migration.id} - ${migration.description}`);
        
        // Apply the migration
        migration.apply(db);
        
        // Record the migration as applied
        db['db'].prepare('INSERT INTO migrations (id, applied_at, description) VALUES (?, ?, ?)')
          .run(migration.id, new Date().toISOString(), migration.description);
        
        logger.info(`Migration applied: ${migration.id}`);
      } else {
        logger.debug(`Skipping already applied migration: ${migration.id}`);
        // Do NOT call migration.apply if already migrated
      }
    }
    
    logger.info('Database migrations completed successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to apply migrations: ${errorMessage}`, { error });
    throw error;
  }
} 