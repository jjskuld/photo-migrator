import { createLogger } from './utils/logger';
import { DatabaseManager } from './utils/database';
import { MediaScanner } from './media-scanner/MediaScanner';
// TODO: Import AuthManager, Uploader etc. as they are implemented

const logger = createLogger('main');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'help';

// Initialize shared components
// Consider dependency injection later for better testability
const dbManager = new DatabaseManager();
const mediaScanner = new MediaScanner(dbManager);
// const authManager = new AuthManager(); // Placeholder
// const uploader = new Uploader(dbManager, authManager); // Placeholder

async function main() {
  try {
    logger.info(`Starting Photo Migrator with command: ${command}`);
    await dbManager.initialize(); // Ensure DB is initialized before any command

    switch (command) {
      case 'scan':
        logger.info('Starting media library scan...');
        await mediaScanner.scanLibrary();
        logger.info('Media library scan finished.');
        break;
      case 'upload':
        logger.info('Uploading photos (not implemented yet)');
        // TODO: Implement upload logic using Uploader
        break;
      case 'login':
        logger.info('Authentication (not implemented yet)');
        // TODO: Implement login logic using AuthManager
        break;
      case 'status':
        logger.info('Checking status...');
        // TODO: Implement status check using DatabaseManager
        const totalCount = dbManager.getTotalCount();
        const photoCount = dbManager.getCountByType('photo');
        const videoCount = dbManager.getCountByType('video');
        const pendingCount = dbManager.getCountByStatus('pending');
        const uploadedCount = dbManager.getCountByStatus('uploaded');
        const failedCount = dbManager.getCountByStatus('failed');
        
        console.log('\n--- Upload Status ---');
        console.log(`Total Items Found: ${totalCount}`);
        console.log(`  Photos: ${photoCount}`);
        console.log(`  Videos: ${videoCount}`);
        console.log(`---------------------`);
        console.log(`Pending Upload: ${pendingCount}`);
        console.log(`Uploaded: ${uploadedCount}`);
        console.log(`Failed: ${failedCount}`);
        console.log('---------------------\n');
        break;
      case 'help':
      default:
        console.log(`
Photo Migrator - CLI
-------------------
Available commands:
  scan   - Scan Apple Photos library
  upload - Upload photos to Google Photos
  login  - Authenticate with Google Photos
  status - Show upload status
        `);
        break;
    }
  } catch (error) {
    logger.error('An error occurred:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
}); 