import { createLogger } from './utils/logger';

const logger = createLogger('main');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  try {
    logger.info(`Starting Photo Migrator with command: ${command}`);
    
    switch (command) {
      case 'scan':
        logger.info('Scanning photos (not implemented yet)');
        break;
      case 'upload':
        logger.info('Uploading photos (not implemented yet)');
        break;
      case 'login':
        logger.info('Authentication (not implemented yet)');
        break;
      case 'status':
        logger.info('Status check (not implemented yet)');
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