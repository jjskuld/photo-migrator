import { DatabaseManager, MediaItem } from '../utils/database';
import { AuthManager } from '../auth/AuthManager'; // Assuming AuthManager lives here
import { createLogger } from '../utils/logger';
import path from 'path'; // Import path module
import fs from 'fs'; // Import fs module
import axios, { AxiosRequestConfig, AxiosError } from 'axios'; // Import axios
import retry from 'async-retry'; // Import async-retry
// TODO: Import necessary HTTP client (e.g., axios)

const logger = createLogger('Uploader');

// Constants for Google Photos API
const GOOGLE_PHOTOS_API_BASE_URL = 'https://photoslibrary.googleapis.com/v1';
const UPLOAD_ENDPOINT = `${GOOGLE_PHOTOS_API_BASE_URL}/uploads`;
const MEDIA_ITEMS_CREATE_ENDPOINT = `${GOOGLE_PHOTOS_API_BASE_URL}/mediaItems:batchCreate`;

export class Uploader {
    private dbManager: DatabaseManager;
    private authManager: AuthManager;

    constructor(dbManager: DatabaseManager, authManager: AuthManager) {
        this.dbManager = dbManager;
        this.authManager = authManager;
        logger.info('Uploader initialized.');
    }

    /**
     * Processes the upload queue, fetching pending items and uploading them.
     */
    async processUploadQueue(batchSize: number = 5): Promise<void> {
        logger.info(`Processing upload queue (batch size: ${batchSize})...`);
        
        const pendingItems = this.dbManager.getPendingMedia(batchSize);
        if (pendingItems.length === 0) {
            logger.info('No pending items found in the queue.');
            return;
        }

        logger.info(`Found ${pendingItems.length} pending items to upload.`);

        for (const item of pendingItems) {
            try {
                logger.info(`Attempting to upload item: ${item.id} (${item.original_name})`);
                await this.uploadMediaItem(item);
                logger.info(`Successfully processed item: ${item.id}`);
            } catch (error: any) {
                logger.error(`Failed to upload item ${item.id}: ${error.message}`, { error });
                // TODO: Implement retry logic and update item status to 'failed'
                // this.dbManager.updateMediaStatus(item.id, 'failed', error.message);
                // this.dbManager.incrementRetryCount(item.id);
            }
        }
        
        logger.info('Finished processing current batch of uploads.');
        // Consider recursively calling if more pending items exist?
    }

    /**
     * Uploads a single media item.
     * (Placeholder for Tasks 1.5.2 and 1.5.3)
     */
    private async uploadMediaItem(item: MediaItem): Promise<void> {
        logger.debug(`Uploading media item: ${item.id}`, { item });

        // 1. Get Access Token (Task 1.3)
        const accessToken = await this.authManager.getAccessToken(); // Assuming this method exists
        if (!accessToken) {
            // AuthManager should handle refresh internally or throw if it fails completely
            logger.error(`Failed to obtain access token for item ${item.id}. AuthManager did not provide one.`);
            throw new Error('Failed to obtain access token.');
        }
        logger.debug(`Obtained access token for item ${item.id}.`);
        
        // --- File Path Handling (Needs refinement in Phase 2) ---
        const filePath = item.local_copy_path || item.original_path;
        if (!filePath || filePath.startsWith('urn:')) { 
             logger.warn(`Skipping item ${item.id} - No local file path available yet (Path: ${filePath}).`);
             // Mark as failed temporarily or implement a 'needs_export' status?
             this.dbManager.updateMediaStatus(item.id, 'failed', 'No local file path available for upload');
             return; 
        }
        
        // Check if file actually exists before attempting upload
        if (!fs.existsSync(filePath)) {
             logger.error(`File not found at path: ${filePath} for item ${item.id}. Marking as failed.`);
             this.dbManager.updateMediaStatus(item.id, 'failed', `File not found at expected path: ${filePath}`);
             return;
        }

        // 2. Upload Bytes (Task 1.5.2)
        logger.info(`Starting byte upload for item ${item.id} from ${filePath}`);
        const uploadToken = await this.uploadFileBytes(filePath, accessToken, item.mime_type);
        logger.info(`Got upload token for ${item.id}: ${uploadToken}`);

        // 3. Create Media Item (Task 1.5.3)
        logger.info(`Attempting to create media item for token: ${uploadToken}`);
        // Pass original_name as description for now
        const creationResult = await this.createMediaItem(uploadToken, accessToken, item.original_name);
        
        if (!creationResult.success) {
            // Error is logged within createMediaItem, just throw to trigger main error handling
            // TODO: Consider more specific error handling/retry based on createMediaItem failure type?
            throw new Error(`Failed to create media item in Google Photos for item ${item.id}.`);
        }

        // 4. Update DB Status (Task 1.5.4)
        // If creation was successful, update DB status to 'uploaded' and store Google Photos ID
        this.dbManager.updateMediaStatus(item.id, 'uploaded');
        if (creationResult.mediaItemId) {
             this.dbManager.updateGooglePhotosId(item.id, creationResult.mediaItemId);
        }
        logger.info(`Successfully created media item and updated DB for item ${item.id} (Google ID: ${creationResult.mediaItemId || 'N/A'})`);
       
        // Placeholder logs removed
    }

    // Implemented Task 1.5.2
    private async uploadFileBytes(filePath: string, accessToken: string, mimeType: string): Promise<string> {
        logger.info(`Uploading bytes for: ${filePath} (MIME: ${mimeType})`);

        const isVideo = mimeType.startsWith('video/');
        const UPLOAD_TIMEOUT = isVideo ? 300000 : 120000; // 5 minutes for video, 2 minutes otherwise
        const MAX_RETRIES = 5;

        return retry(async (bail, attempt) => {
            // bail function: call bail(new Error('Non-retriable error')) to stop retrying
            // attempt number: 1, 2, ...
            logger.debug(`Attempt ${attempt} to upload bytes for ${filePath}`);

            try {
                const stats = fs.statSync(filePath);
                const fileSize = stats.size;
                if (fileSize === 0) {
                    // Non-retriable error for empty file
                    bail(new Error('File size is 0, cannot upload empty file.'));
                    return ''; // Required return, though bail prevents it from being used
                }
                logger.debug(`File size: ${fileSize} bytes`);

                const fileStream = fs.createReadStream(filePath);

                const config: AxiosRequestConfig = {
                    method: 'post',
                    url: UPLOAD_ENDPOINT,
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/octet-stream',
                        'X-Goog-Upload-Content-Type': mimeType,
                        'X-Goog-Upload-Protocol': 'raw',
                        'Content-Length': fileSize.toString(),
                    },
                    data: fileStream,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: UPLOAD_TIMEOUT,
                };

                logger.info(`[Attempt ${attempt}] POSTing ${fileSize} bytes to ${UPLOAD_ENDPOINT}`);
                const response = await axios(config);

                if (response.status === 200 && response.data) {
                    const uploadToken = response.data as string;
                    logger.info(`Successfully uploaded bytes, received upload token.`);
                    logger.debug(`Upload Token: ${uploadToken}`);
                    return uploadToken;
                } else {
                    // Unexpected success status? Bail.
                    logger.error(`Upload bytes received unexpected status ${response.status}. Bailing.`, { responseData: response.data });
                    bail(new Error(`Upload bytes failed with unexpected status ${response.status}`));
                    return '';
                }

            } catch (error: any) {
                let errorMessage = 'Upload bytes attempt failed.';
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    errorMessage = `Axios error: ${error.message}. Status: ${status}. Data: ${JSON.stringify(error.response?.data)}`;
                    logger.warn(`[Attempt ${attempt}] ${errorMessage}`);

                    // --- Retry / Bail Logic --- 
                    if (status) {
                        if (status === 401) {
                            // Unauthorized - probably expired token. Bail and let AuthManager handle refresh.
                            logger.error('Received 401 Unauthorized. Bailing upload attempt.');
                            bail(new Error('Unauthorized (401) during byte upload'));
                        } else if (status === 429) {
                            // Too Many Requests - Retry will happen due to exponential backoff
                            logger.warn('Received 429 Too Many Requests. Will retry after backoff.');
                            throw error; // Throw to trigger retry
                        } else if (status >= 500 && status < 600) {
                            // Server error (5xx) - Retry
                            logger.warn(`Received server error ${status}. Will retry.`);
                            throw error; // Throw to trigger retry
                        } else {
                            // Other client errors (4xx) are likely non-retriable for byte upload
                            logger.error(`Received non-retriable client error ${status}. Bailing.`);
                            bail(new Error(`Non-retriable API error ${status} during byte upload`));
                        }
                    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                         logger.warn(`Network timeout during byte upload. Will retry.`);
                         throw error; // Throw to trigger retry
                    } else {
                         // Other network errors or unexpected errors, potentially retry
                         logger.warn(`Unknown axios error without status. Will retry. Code: ${error.code}, Message: ${error.message}`);
                         throw error; // Throw to trigger retry
                    }
                } else {
                    // Non-Axios error (e.g., fs error) - likely non-retriable
                    errorMessage = `Non-axios error during byte upload: ${error.message}`;
                    logger.error(errorMessage, { error });
                    bail(new Error(errorMessage)); 
                }
                return ''; // Required return, but bail/throw prevents use
            }
        }, {
            retries: MAX_RETRIES,
            factor: 2,
            minTimeout: 1000, // Start with 1 second delay
            maxTimeout: 60000, // Max 1 minute delay between retries
            onRetry: (error: unknown, attempt) => {
                // Safely access error message
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`Retrying upload for ${filePath} (attempt ${attempt}/${MAX_RETRIES}) due to error: ${errorMessage}`);
            }
        });
    }

    // Placeholder for Task 1.5.3
    private async createMediaItem(uploadToken: string, accessToken: string, description: string | undefined): Promise<{ success: boolean; mediaItemId?: string }> {
        logger.info(`Creating media item with token: ${uploadToken}`);
        const MAX_RETRIES = 3; // Use fewer retries for metadata creation?
        
        return retry(async (bail, attempt) => {
            logger.debug(`[Attempt ${attempt}] Creating media item for token ${uploadToken}`);
            const payload = {
                newMediaItems: [
                    {
                        description: description || '',
                        simpleMediaItem: {
                            uploadToken: uploadToken,
                        },
                    },
                ],
            };

            const config: AxiosRequestConfig = {
                method: 'post',
                url: MEDIA_ITEMS_CREATE_ENDPOINT,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                data: payload,
                timeout: 30000,
            };

            try {
                const response = await axios(config);

                if (response.status === 200 && response.data?.newMediaItemResults?.length > 0) {
                    const result = response.data.newMediaItemResults[0];
                    
                    if (result.uploadToken !== uploadToken) {
                        const errorMessage = `Mismatched upload token in response. Expected ${uploadToken}, got ${result.uploadToken}`;
                        logger.error(errorMessage, { responseData: response.data });
                        // This is unexpected and likely non-retriable
                        bail(new Error(errorMessage)); 
                        return { success: false };
                    }
                    
                    // Handle API-level errors reported in the response body
                    if (result.status.code !== 0 /* OK */ && result.status.message !== 'OK') {
                        const apiErrorMessage = `API error creating media item: ${result.status.message} (Code: ${result.status.code})`;
                        logger.warn(`[Attempt ${attempt}] ${apiErrorMessage}`);
                        
                        // Specific check for invalid upload token - indicates bytes need re-uploading
                        // Let's bail here and let the outer loop handle re-uploading the bytes.
                        // A more sophisticated retry could trigger re-upload directly.
                        if (result.status.message.includes('Invalid upload token') || result.status.message.includes('Expired upload token')) {
                             logger.error('Upload token invalid or expired. Bailing media item creation.');
                             // Bail, but throw a specific error? Or just let the main handler deal with {success: false}?
                             // For now, return false, the calling function needs to handle this.
                             // bail(new Error('Invalid upload token')); // Bail might prevent returning {success: false}
                              return { success: false }; // Signal failure to uploadMediaItem
                        }
                        
                        // Check if it's a potentially retriable server-side issue within the API result
                        // Assuming codes similar to HTTP might be used, or check specific API docs
                         if (result.status.code === 13 /* Internal */ || result.status.code === 14 /* Unavailable */ || result.status.code === 8 /* Resource exhausted / Quota */) {
                            logger.warn(`Potentially retriable API error ${result.status.code}. Will retry.`);
                            throw new Error(apiErrorMessage); // Throw to trigger retry
                        } else {
                            // Other API errors likely non-retriable
                            logger.error(`Non-retriable API error ${result.status.code}. Bailing.`);
                            bail(new Error(apiErrorMessage));
                            return { success: false };
                        }
                    }
                    
                    // Success case
                    const mediaItemId = result.mediaItem?.id;
                    logger.info(`Successfully created media item. Google Photos ID: ${mediaItemId}`);
                    return { success: true, mediaItemId: mediaItemId };

                } else {
                     // Unexpected successful HTTP status but invalid data structure?
                     const errorMessage = `Create media item response invalid. Status: ${response.status}. Data: ${JSON.stringify(response.data)}`;
                     logger.error(errorMessage);
                     bail(new Error(errorMessage)); // Non-retriable
                     return { success: false };
                }
            } catch (error: any) {
                 let errorMessage = 'Failed during create media item attempt.';
                 if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    errorMessage = `Axios error: ${error.message}. Status: ${status}. Data: ${JSON.stringify(error.response?.data)}`;
                    logger.warn(`[Attempt ${attempt}] ${errorMessage}`);

                    if (status) {
                        if (status === 401) {
                            logger.error('Received 401 Unauthorized. Bailing create media item attempt.');
                            bail(new Error('Unauthorized (401) during media item creation'));
                        } else if (status === 429) {
                             logger.warn('Received 429 Too Many Requests. Will retry after backoff.');
                            throw error;
                        } else if (status >= 500 && status < 600) {
                             logger.warn(`Received server error ${status}. Will retry.`);
                            throw error;
                        } else {
                             logger.error(`Received non-retriable client error ${status}. Bailing.`);
                            bail(new Error(`Non-retriable API error ${status} during media item creation`));
                        }
                     } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                         logger.warn(`Network timeout during media item creation. Will retry.`);
                         throw error; // Throw to trigger retry
                    } else {
                         logger.warn(`Unknown axios error without status. Will retry. Code: ${error.code}, Message: ${error.message}`);
                         throw error; 
                    }
                 } else {
                     errorMessage = `Non-axios error during media item creation: ${error.message}`;
                     logger.error(errorMessage, { error });
                     bail(new Error(errorMessage)); 
                 }
                 // If we bailed or exhausted retries, we need to ensure a failure object is returned
                 // Throwing within the catch block triggers a retry by async-retry
                 // If retry limit is reached, async-retry throws the last error caught
                 // We need to catch that final error outside the retry block
                 throw error; // Re-throw caught error to potentially trigger retry
            }
        }, {
            retries: MAX_RETRIES,
            factor: 2, // Standard exponential backoff
            minTimeout: 1000,
            maxTimeout: 30000, // Shorter max timeout for metadata creation
            onRetry: (error: unknown, attempt) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`Retrying media item creation for token ${uploadToken} (attempt ${attempt}/${MAX_RETRIES}) due to error: ${errorMessage}`);
            }
        }).catch(finalError => {
            // Catch error after all retries have failed
            logger.error(`Media item creation failed permanently for token ${uploadToken} after ${MAX_RETRIES} retries: ${finalError.message}`, { finalError });
            return { success: false }; // Return failure object
        });
    }

} 