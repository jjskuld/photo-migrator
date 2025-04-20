import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs'; // Needed for existsSync
import { DatabaseManager, MediaItem } from '../utils/database';
import { createLogger } from '../utils/logger'; // Import createLogger

const logger = createLogger('MediaScanner'); // Create a logger instance for this module

const swiftExecutableName = 'MediaScannerMac';
// Construct the path relative to the project root (where package.json is)
const swiftExecutablePath = path.join(process.cwd(), 'bin', swiftExecutableName);

// Type mirroring the Swift struct output
// Ensure this matches the Swift JSONEncoder output accurately
interface SwiftMediaItem {
  localIdentifier: string;
  originalPath: string | null;
  originalFilename: string | null;
  uti: string | null;
  creationDate: string | null; // ISO 8601 formatted string
  modificationDate: string | null; // ISO 8601 formatted string
  sizeBytes: number | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  isInCloud: boolean;
  mediaType: 'photo' | 'video';
  durationSeconds: number | null;
  codec: string | null;
}

export class MediaScanner {
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
    logger.info(`MediaScanner initialized.`);
    if (!fs.existsSync(swiftExecutablePath)) {
      logger.warn(`Swift executable NOT FOUND at: ${swiftExecutablePath}`);
      // Consider throwing an error here if macOS is detected and scan is attempted
    } else {
      logger.info(`Swift executable found at: ${swiftExecutablePath}`);
    }
  }

  /**
   * Scans the user's photo library.
   * On macOS, it runs the Swift helper tool.
   * On other platforms, it currently does nothing (pending Windows/Linux implementation).
   */
  async scanLibrary(): Promise<void> {
    // Basic OS check - only run Swift on macOS
    if (process.platform !== 'darwin') {
      logger.warn('Media scanning via Swift is only supported on macOS. Skipping scan.');
      // TODO: Implement Windows/Linux scanning logic later (Task 2.4.3)
      return Promise.resolve(); // Resolve successfully, as this isn't an error for non-macOS
    }

    // Proceed with macOS Swift execution
    return this.executeSwiftScanner();
  }

  /**
   * Executes the Swift scanner process and handles its output.
   */
  private executeSwiftScanner(): Promise<void> {
     return new Promise((resolve, reject) => {
      logger.info(`Starting Swift media scanner: ${swiftExecutablePath}`);

      // Check if executable exists and is executable
      try {
        fs.accessSync(swiftExecutablePath, fs.constants.X_OK);
      } catch (err) {
        const errorMsg = `Swift executable not found or not executable at ${swiftExecutablePath}. Please run 'npm run build:swift'.`;
        logger.error(errorMsg, err);
        return reject(new Error(errorMsg));
      }

      const swiftProcess = spawn(swiftExecutablePath, [], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdoutData = '';
      let stderrData = '';

      swiftProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      swiftProcess.stderr.on('data', (data) => {
        const logMsg = data.toString().trim();
        if (logMsg) {
          logger.info(`[Swift STERR]: ${logMsg}`);
          stderrData += logMsg + '\n';
        }
      });

      swiftProcess.on('error', (err) => {
        logger.error(`Failed to start Swift process: ${err.message}`);
        reject(err);
      });

      swiftProcess.on('close', async (code) => {
        logger.info(`Swift process finished with code ${code}`);

        if (code !== 0) {
          const errorMsg = `Swift process exited with non-zero code ${code}. Stderr: ${stderrData || 'None'}`;
          logger.error(errorMsg);
          return reject(new Error(errorMsg));
        }

        if (!stdoutData) {
          logger.warn('Swift process produced no output (stdout). Assuming no media items found.');
          return resolve(); // No data isn't necessarily an error
        }

        try {
          logger.info(`Received ${stdoutData.length} bytes of stdout data. Attempting to parse JSON...`);
          const items: SwiftMediaItem[] = JSON.parse(stdoutData);
          logger.info(`Successfully parsed ${items.length} media items from Swift process.`);

          // Add items to the database
          const results = await this.addItemsToDatabase(items);
          logger.info(`Database update complete. Added: ${results.addedCount}, Updated: ${results.updatedCount}, Skipped/Existing: ${results.skippedCount}`);
          resolve();

        } catch (parseError: any) {
          logger.error(`Failed to parse JSON output from Swift process: ${parseError.message}`);
          logger.debug('Raw stdout data on parse failure (first 1KB):\n', stdoutData.substring(0, 1000));
          reject(new Error(`JSON parse error: ${parseError.message}`));
        }
      });
    });
  }

  /**
   * Adds or updates media items in the database based on the scanned data.
   */
  private async addItemsToDatabase(items: SwiftMediaItem[]): Promise<{ addedCount: number; updatedCount: number; skippedCount: number }> {
    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // Ensure the database is initialized before proceeding
    // Calling initialize() is idempotent, so it's safe to call even if already initialized.
    if (!this.dbManager.initialize()) {
        logger.error('Database initialization failed. Cannot add media items.');
        throw new Error('DatabaseManager failed to initialize.');
    }

    const itemsToAdd: Omit<MediaItem, 'retry_count'>[] = [];
    const itemsToSkip: string[] = []; // Store IDs of items already existing

    for (const item of items) {
      try {
        // Check if the item already exists before transforming
        const existingItem = this.dbManager.getMediaById(item.localIdentifier);
        if (existingItem) {
            itemsToSkip.push(item.localIdentifier);
            continue; // Move to the next item
        }

        // Transform Swift item to DB schema (only if it doesn't exist)
        const mediaData: Omit<MediaItem, 'retry_count'> = {
          id: item.localIdentifier,
          media_type: item.mediaType,
          mime_type: item.uti ?? 'application/octet-stream',
          original_path: `urn:apple:photos:library:asset:${item.localIdentifier}`,
          local_copy_path: undefined, // Ensure it's undefined if null
          original_name: item.originalFilename ?? 'unknown_filename',
          size_bytes: item.sizeBytes ?? undefined,
          creation_date: item.creationDate ? new Date(item.creationDate).toISOString() : undefined,
          sha256_hash: undefined,
          visual_hash: undefined,
          pixel_size: (item.pixelWidth && item.pixelHeight) ? `${item.pixelWidth}x${item.pixelHeight}` : undefined,
          duration_seconds: item.durationSeconds ?? undefined,
          codec: item.codec ?? undefined,
          status: 'pending',
          // retry_count is omitted
          last_attempt_at: undefined,
          google_photos_id: undefined,
          error_message: undefined,
          is_in_icloud: item.isInCloud, // Add the isInCloud property from Swift
        };
        itemsToAdd.push(mediaData);

      } catch (dbError: any) {
        // Error during check or transformation (less likely)
        logger.error(`Failed to process media item ${item.localIdentifier} before DB add: ${dbError.message}`, { error: dbError });
        skippedCount++; // Count as skipped on error too
      }
    }

    // Add the new items in a batch
    if (itemsToAdd.length > 0) {
        try {
            this.dbManager.addMediaBatch(itemsToAdd); // Use batch method
            addedCount = itemsToAdd.length;
            logger.info(`Successfully added batch of ${addedCount} new media items.`);
        } catch(batchError: any) {
            logger.error(`Failed during batch insert: ${batchError.message}`, { error: batchError });
            // If batch fails, treat all items in that batch as skipped/error
            skippedCount += itemsToAdd.length; 
            addedCount = 0; // Reset added count as the batch failed
        }
    }
    
    skippedCount += itemsToSkip.length; // Add count of pre-existing items
    if (itemsToSkip.length > 0) {
        logger.info(`${itemsToSkip.length} media items already existed in the database.`);
    }

    // updatedCount remains 0 as we are not updating existing items yet
    return { addedCount, updatedCount, skippedCount };
  }
} 