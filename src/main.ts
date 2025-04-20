import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createLogger } from './utils/logger';
import { DatabaseManager, MediaItem } from './utils/database';
import { MediaScanner } from './media-scanner/MediaScanner';
import { AuthManager } from './auth/AuthManager';
import { Uploader } from './uploader/Uploader';

const logger = createLogger('main');

// Initialize shared components - Instantiate within command handlers where needed
// to ensure fresh state or specific configurations if necessary.
// We definitely need dbManager early for initialization.
const dbManager = new DatabaseManager();

async function run() {
  try {
    // Ensure DB is initialized before any command attempts to use it
    await dbManager.initialize();

    await yargs(hideBin(process.argv))
      .command(
        'login',
        'Authenticate with Google Photos',
        () => {}, // No specific options for login
        async () => {
          // Task 1.6.3: Implement login command
          logger.info('Starting Google Photos authentication...');
          const authManager = new AuthManager(); // Instantiate here
          // Cannot handle interactive input, so just get and print the URL
          try {
            const authUrl = await authManager.getAuthUrl();
            console.log('\\nPlease visit the following URL in your browser to authorize the application:');
            console.log(authUrl);
            console.log('\\nAfter authorization, you will receive a code.');
            // TODO: Implement a way to provide the received code back to the application
            // e.g., add a new command like `photo-migrator auth:code <PASTE_CODE_HERE>`
            logger.info('Authentication process started. Follow the instructions above.');
          } catch (error) {
            logger.error('Failed to get authentication URL:', error);
          }
        }
      )
      .command(
        'scan',
        'Scan Apple Photos library for media items (macOS only)',
        () => {}, // No specific options for scan
        async () => {
          // Task 1.6.4: Implement scan command
          logger.info('Starting media library scan...');
          const mediaScanner = new MediaScanner(dbManager); // Instantiate here
          await mediaScanner.scanLibrary();
          logger.info('Media library scan finished.');
        }
      )
      .command(
        'status',
        'Show the current upload status',
        () => {}, // No specific options for status
        async () => {
          // Task 1.6.6: Implement status command
          logger.info('Checking status...');
          
          const totalCount = dbManager.getTotalCount();
          const photoCount = dbManager.getCountByType('photo');
          const videoCount = dbManager.getCountByType('video');
          
          const pendingPhotos = dbManager.getCountByTypeAndStatus('photo', 'pending');
          const pendingVideos = dbManager.getCountByTypeAndStatus('video', 'pending');
          const pendingTotal = pendingPhotos + pendingVideos; // Calculate total pending explicitly
          
          const uploadedPhotos = dbManager.getCountByTypeAndStatus('photo', 'uploaded');
          const uploadedVideos = dbManager.getCountByTypeAndStatus('video', 'uploaded');
          const uploadedTotal = uploadedPhotos + uploadedVideos;

          const failedPhotos = dbManager.getCountByTypeAndStatus('photo', 'failed');
          const failedVideos = dbManager.getCountByTypeAndStatus('video', 'failed');
          const failedTotal = failedPhotos + failedVideos;

          // TODO: Add counts for 'skipped' and 'exported' statuses if needed later

          console.log('\\n--- Upload Status ---');
          console.log(`Total Items Found: ${totalCount} (Photos: ${photoCount}, Videos: ${videoCount})`);
          console.log(`---------------------`);
          console.log(`Pending Upload:  ${pendingTotal} (Photos: ${pendingPhotos}, Videos: ${pendingVideos})`);
          console.log(`Uploaded:        ${uploadedTotal} (Photos: ${uploadedPhotos}, Videos: ${uploadedVideos})`);
          console.log(`Failed:          ${failedTotal} (Photos: ${failedPhotos}, Videos: ${failedVideos})`);
          console.log('---------------------\\n');
        }
      )
      .command(
        'upload',
        'Upload pending media items to Google Photos',
        (yargs) => {
          // Task 1.6.5: Filtering options
          return yargs
            .option('photos-only', {
              alias: 'p',
              type: 'boolean',
              description: 'Upload only photos',
              default: false,
              conflicts: 'videos-only', // Cannot use both flags
            })
            .option('videos-only', {
              alias: 'v',
              type: 'boolean',
              description: 'Upload only videos',
              default: false,
              conflicts: 'photos-only', // Cannot use both flags
            })
            .option('batch-size', {
              alias: 'b',
              type: 'number',
              description: 'Number of items to process per batch',
              default: 5,
            });
        },
        async (argv) => {
          // Task 1.6.5: Implement upload command
          logger.info('Starting upload process...');
          const batchSize = argv.batchSize > 0 ? argv.batchSize : 5; // Ensure positive batch size

          const authManager = new AuthManager(); // Instantiate dependencies
          const uploader = new Uploader(dbManager, authManager);

          // Check authentication status first (important!)
          const token = await authManager.getAccessToken(); // Attempt to get token (will trigger refresh if needed)
          if (!token) {
              logger.error('Not authenticated. Please run the "login" command first.');
              return; // Stop if not authenticated
          }
          logger.info('Authentication verified.');

          let itemsToUpload: MediaItem[] = [];
          if (argv.photosOnly) {
              logger.info(`Fetching up to ${batchSize} pending photos...`);
              itemsToUpload = dbManager.getPendingPhotos(batchSize);
          } else if (argv.videosOnly) {
              logger.info(`Fetching up to ${batchSize} pending videos...`);
              itemsToUpload = dbManager.getPendingVideos(batchSize);
          } else {
              logger.info(`Fetching up to ${batchSize} pending items (photos and videos)...`);
              itemsToUpload = dbManager.getPendingMedia(batchSize);
          }

          if (itemsToUpload.length === 0) {
              logger.info('No items found matching the criteria to upload in this batch.');
              return;
          }

          logger.info(`Attempting to upload ${itemsToUpload.length} items...`);
          
          // The Uploader's processUploadQueue handles fetching its own batch,
          // but we need to pass the filtering logic somehow.
          // FOR NOW: Let's simplify and assume processUploadQueue will be modified or
          // we process items fetched here. We'll use the latter for now as it requires no Uploader changes yet.
          
          let successCount = 0;
          let failureCount = 0;
          const totalItems = itemsToUpload.length;

          for (let i = 0; i < totalItems; i++) {
            const item = itemsToUpload[i];
            logger.info(`Uploading item ${i + 1} of ${totalItems}: ${item.original_name} (ID: ${item.id})`);
             try {
                 // Call the *private* uploadMediaItem directly for now.
                 // This is not ideal - processUploadQueue should ideally handle filtering.
                 // Reflecting this internal method directly for CLI task completion.
                 // Accessing private method via type assertion for demonstration.
                 await (uploader as any).uploadMediaItem(item); 
                 successCount++;
                 logger.info(`Successfully uploaded: ${item.original_name}`);
             } catch (error: any) {
                 failureCount++;
                 logger.error(`Failed to upload ${item.original_name}: ${error.message}`, { error });
                 // Error status should be updated within uploadMediaItem's error handling
             }
          }

          logger.info(`Upload batch finished. Success: ${successCount}, Failed: ${failureCount}`);
        }
      )
      .demandCommand(1, 'Please specify a command.')
      .strict() // Report errors for unknown commands/options
      .help() // Enable --help option
      .alias('h', 'help')
      .wrap(yargs.terminalWidth()) // Adjust help message width
      .fail((msg, err, yargs) => { // Custom failure handler
        if (err) {
          logger.error('Command execution failed:', err); // Log the actual error
        } else {
          console.error(`Error: ${msg}\\n`);
          yargs.showHelp(); // Show help message on validation failure
        }
        process.exit(1);
      })
      .parse(); // Parse arguments and execute command handler

  } catch (error) {
    logger.error('An unexpected error occurred in the main process:', error);
    process.exit(1);
  }
}

// Run the async function
run().catch(err => {
  logger.error('Unhandled promise rejection in main execution:', err);
  process.exit(1);
}); 