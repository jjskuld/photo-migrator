import { OAuth2Client, Credentials } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Constants for Google OAuth
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Out-of-band for CLI
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.appendonly']; // Minimum required scope

// Configuration and Token Paths
const CONFIG_DIR = path.join(os.homedir(), '.config', 'photo-migrator');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'google-tokens.json');

interface AppConfig {
    clientId: string;
    clientSecret: string;
}

interface StoredTokens extends Credentials {
    // Credentials already defines most fields like access_token, refresh_token, expiry_date, token_type
    // Add any custom fields if needed, but google-auth-library types are usually sufficient.
    // We ensure scope is string | undefined by filtering null during load.
}

export class AuthManager {
    private oauth2Client: OAuth2Client | null = null;
    private tokens: StoredTokens | null = null;
    private config: AppConfig | null = null;
    private initializationPromise: Promise<void>;

    constructor() {
        this.initializationPromise = this.loadConfigAndInitializeClient();
        this.initializationPromise.catch(err => {
            console.error("AuthManager background initialization failed:", err.message);
        });
    }

    private async loadConfig(): Promise<AppConfig> {
        try {
            const configData = await fs.readFile(CONFIG_PATH, 'utf-8');
            const parsedConfig = JSON.parse(configData) as Partial<AppConfig>;

            if (!parsedConfig.clientId || !parsedConfig.clientSecret) {
                throw new Error('clientId and clientSecret must be defined in config.json');
            }
            // Ensure only expected fields are present if necessary, or trust the structure
            return { clientId: parsedConfig.clientId, clientSecret: parsedConfig.clientSecret };
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.error(`Configuration file not found at ${CONFIG_PATH}. Please create it with your clientId and clientSecret.`);
                throw new Error(`Configuration file missing: ${CONFIG_PATH}`);
            } else if (error instanceof SyntaxError) {
                 console.error(`Invalid JSON in configuration file: ${CONFIG_PATH}`);
                 throw new Error(`Invalid JSON in config: ${CONFIG_PATH}`);
            }
            console.error(`Error loading configuration from ${CONFIG_PATH}:`, error);
            throw new Error(`Failed to load configuration: ${error.message}`);
        }
    }

    private async loadConfigAndInitializeClient(): Promise<void> {
         try {
            this.config = await this.loadConfig();
            this.oauth2Client = new OAuth2Client(
                this.config.clientId,
                this.config.clientSecret,
                REDIRECT_URI
            );
            console.log("AuthManager initialized with credentials from config.")
             // Attempt to load tokens immediately after successful client initialization
             // Don't await here, let ensureInitialized handle waiting if needed
             this.loadTokens().catch(err => console.error("Error during initial token load:", err));
        } catch (error: any) {
            console.error("Critical AuthManager initialization failure:", error.message);
             // Re-throw critical configuration errors so the promise rejects
            throw error; 
        }
    }

    private async ensureInitialized(): Promise<void> {
        await this.initializationPromise;
        if (!this.oauth2Client || !this.config) {
            throw new Error('AuthManager initialization failed silently. Check logs.');
        }
    }

    async getAuthUrl(): Promise<string> {
        await this.ensureInitialized();
        const authUrl = this.oauth2Client!.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',
        });
        console.log('Authorize this app by visiting this url:', authUrl);
        return authUrl;
    }

    async handleAuthCode(code: string): Promise<void> {
        await this.ensureInitialized();
        try {
            const { tokens } = await this.oauth2Client!.getToken(code);
            if (tokens.scope === null || tokens.scope === undefined) {
                console.warn('Received tokens without a scope. Using default or previously known scope.');
                tokens.scope = SCOPES.join(' ');
            }
            this.oauth2Client!.setCredentials(tokens);
            this.tokens = tokens as StoredTokens;
            await this.storeTokens(this.tokens);
            console.log('Authentication successful! Tokens stored.');
        } catch (error) {
            console.error('Error retrieving access token:', error);
            throw new Error('Failed to authenticate with Google.');
        }
    }

    private async storeTokens(tokens: StoredTokens): Promise<void> {
        try {
            await fs.mkdir(CONFIG_DIR, { recursive: true });
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens), { mode: 0o600 });
            console.log('Tokens stored successfully to:', TOKEN_PATH);
        } catch (error) {
            console.error('Error storing tokens:', error);
        }
    }

    async loadTokens(): Promise<boolean> {
        if (!this.oauth2Client) {
            console.log("Cannot load tokens yet, client not initialized.");
            return false;
        }
        try {
            const tokenData = await fs.readFile(TOKEN_PATH, 'utf-8');
            const loadedTokens = JSON.parse(tokenData) as StoredTokens;

            if (!loadedTokens || !loadedTokens.refresh_token || loadedTokens.scope === null || loadedTokens.scope === undefined) {
                console.log('No valid tokens found, refresh token missing, or scope is invalid/missing.');
                this.tokens = null;
                await this.clearTokensOnFile();
                return false;
            }

            this.tokens = loadedTokens;
            this.oauth2Client.setCredentials(this.tokens);
            console.log('Tokens loaded successfully.');
            return true;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.log('Token file not found. Need to login or tokens were cleared.');
                this.tokens = null;
                return false;
            }
            console.error('Error loading tokens:', error);
            this.tokens = null;
            await this.clearTokensOnFile();
            return false;
        }
    }

    async getAccessToken(): Promise<string | null | undefined> {
        await this.ensureInitialized();

        if (!this.tokens) {
            const loaded = await this.loadTokens();
            if (!loaded) {
                console.log('No tokens loaded. Please authenticate first.');
                return null;
            }
        }

        if (!this.tokens) {
             console.error('Assertion failed: Tokens should be loaded by now if authentication was done.');
             return null;
        }

        try {
            const tokenResponse = await this.oauth2Client!.getAccessToken();
            const newAccessToken = tokenResponse.token;

            if (newAccessToken && newAccessToken !== this.tokens.access_token) {
                console.log('Access token refreshed.');
                this.tokens.access_token = newAccessToken;
                
                // Update expiry date from the response if available
                const newExpiry = tokenResponse.res?.data?.expiry_date;
                if (newExpiry) {
                    this.tokens.expiry_date = newExpiry;
                } else {
                    // If not in response, maybe try reading from client credentials as fallback?
                    // Or potentially estimate based on current time + expires_in if that was returned?
                    // For now, let's only update if explicitly provided in response.
                    console.warn('New expiry date not found in refresh response.');
                    // Optionally clear the old expiry? Or leave it?
                    // Leaving it might be safer if refresh didn't provide one.
                }
                
                await this.storeTokens(this.tokens);
            }

            return newAccessToken;
        } catch (error: any) {
            console.error('Error refreshing access token:', error);
            await this.clearTokens();
            throw new Error(`Failed to refresh access token: ${error.message || error}`);
        }
    }

    async clearTokens(): Promise<void> {
        this.tokens = null;
        if (this.oauth2Client) {
             this.oauth2Client.setCredentials({});
        }
        await this.clearTokensOnFile();
    }

    private async clearTokensOnFile(): Promise<void> {
        try {
            await fs.unlink(TOKEN_PATH);
            console.log('Token file deleted.');
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('Error deleting token file:', error);
            }
        }
    }

    async isAuthenticated(): Promise<boolean> {
        try {
            await this.ensureInitialized();
        } catch (error) {
            return false;
        }

        if (this.tokens === null) {
            return false; 
        }
        
        return !!this.tokens.refresh_token;
    }
} 