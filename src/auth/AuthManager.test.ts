import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { AuthManager } from './AuthManager';
import { OAuth2Client, Credentials } from 'google-auth-library';
// Correct import paths for response types if they changed
import { GetTokenResponse } from 'google-auth-library/build/src/auth/oauth2client';
import { GetAccessTokenResponse } from 'google-auth-library/build/src/auth/oauth2client';
import * as fs from 'fs/promises'; // Re-add fs import
import * as os from 'os';

// Mock the dependencies
vi.mock('google-auth-library');
vi.mock('fs/promises');
vi.mock('os', () => ({
    homedir: vi.fn(() => '/mock/home'), 
}));

// Construct paths manually using the mocked homedir
const MOCK_CONFIG_DIR = '/mock/home/.config/photo-migrator';
const MOCK_CONFIG_PATH = `${MOCK_CONFIG_DIR}/config.json`;
const MOCK_TOKEN_PATH = `${MOCK_CONFIG_DIR}/google-tokens.json`;

const MOCK_CLIENT_ID = 'mock-client-id';
const MOCK_CLIENT_SECRET = 'mock-client-secret';
const MOCK_VALID_CONFIG = JSON.stringify({ clientId: MOCK_CLIENT_ID, clientSecret: MOCK_CLIENT_SECRET });

// Define mock types for clarity - Make it simpler/Partial
type MockOAuth2ClientInstance = Partial<OAuth2Client> & { // Use Partial
    generateAuthUrl: Mock<(...args: any[]) => string>;
    getToken: Mock<(...args: any[]) => Promise<GetTokenResponse>>;
    setCredentials: Mock<(...args: any[]) => void>;
    getAccessToken: Mock<(...args: any[]) => Promise<GetAccessTokenResponse>>;
    credentials: Partial<Credentials>; 
};

// Helper to reset mocks between tests
const resetMocks = (configExists = true, configIsValid = true, tokensExist = false, tokensAreValid = true) => {
    vi.clearAllMocks();
    vi.resetModules(); 

    vi.mocked(os.homedir).mockReturnValue('/mock/home');

    // --- Mock fs --- 
    if (configExists) {
        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
            if (filePath === MOCK_CONFIG_PATH) {
                if (configIsValid) {
                    return MOCK_VALID_CONFIG;
                } else {
                    return 'invalid json{';
                }
            }
            if (filePath === MOCK_TOKEN_PATH) {
                if (tokensExist) {
                    const tokenContent = tokensAreValid
                        ? { access_token: 'loaded_access', refresh_token: 'loaded_refresh', scope: 'loaded_scope' }
                        : { access_token: 'invalid' }; 
                    return JSON.stringify(tokenContent);
                } else {
                    throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
                }
            }
            throw Object.assign(new Error(`Unexpected readFile call: ${filePath}`), { code: 'ENOENT' });
        });
    } else {
        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
             if (filePath === MOCK_CONFIG_PATH) {
                 throw Object.assign(new Error('Config not found'), { code: 'ENOENT' });
             }
             if (filePath === MOCK_TOKEN_PATH && tokensExist) {
                 const tokenContent = tokensAreValid
                        ? { access_token: 'loaded_access', refresh_token: 'loaded_refresh', scope: 'loaded_scope' }
                        : { access_token: 'invalid' };
                    return JSON.stringify(tokenContent);
             }
              throw Object.assign(new Error(`ENOENT for ${filePath}`), { code: 'ENOENT' });
        });
    }

    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    // --- Mock OAuth2Client --- 
    const mockOAuth2ClientInstance: MockOAuth2ClientInstance = {
        generateAuthUrl: vi.fn().mockReturnValue('mock_auth_url'),
        getToken: vi.fn().mockResolvedValue({ tokens: { access_token: 'mock_access_token', refresh_token: 'mock_refresh_token', scope: 'scope' } } as GetTokenResponse),
        setCredentials: vi.fn(),
        getAccessToken: vi.fn().mockImplementation(async () => {
            const newToken = 'refreshed_access_token_' + Date.now();
            const newExpiry = Date.now() + 3600 * 1000;
            return { token: newToken, res: { data: { expiry_date: newExpiry } } } as GetAccessTokenResponse;
        }),
        credentials: {}, 
    };
    mockOAuth2ClientInstance.setCredentials.mockImplementation((creds: Credentials) => {
        mockOAuth2ClientInstance.credentials = creds;
    });

    vi.mocked(OAuth2Client).mockImplementation(() => mockOAuth2ClientInstance as unknown as OAuth2Client);

    // Assign prototype mocks directly 
    OAuth2Client.prototype.generateAuthUrl = mockOAuth2ClientInstance.generateAuthUrl;
    OAuth2Client.prototype.getToken = mockOAuth2ClientInstance.getToken;
    OAuth2Client.prototype.setCredentials = mockOAuth2ClientInstance.setCredentials;
    OAuth2Client.prototype.getAccessToken = mockOAuth2ClientInstance.getAccessToken;
    Object.defineProperty(OAuth2Client.prototype, 'credentials', {
        get: () => mockOAuth2ClientInstance.credentials,
        configurable: true
    });
};

// Mock initializeAuthManager function
let authManager: AuthManager;
const initializeAuthManager = async (configExists = true, configIsValid = true, tokensExist = false, tokensAreValid = true) => {
    resetMocks(configExists, configIsValid, tokensExist, tokensAreValid);
    authManager = new AuthManager();
    // Await the initialization promise directly
    // Use try/catch to handle expected initialization errors in tests
    try {
        // Access the promise - need to expose it or add a helper method
        // Let's add a helper getter for the test
        await (authManager as any).initializationPromise; 
    } catch (error) {
        // Ignore initialization errors here, tests will check behavior
        // console.log('Caught expected init error during test setup', error.message);
    }
};

describe('AuthManager', () => {
    beforeEach(() => {
        resetMocks();
    });

    describe('getAccessToken', () => {
        // ... other tests ...

        it('should refresh, store token with new expiry, and return new token', async () => {
            await initializeAuthManager(true, true, true, true); // Start with valid loaded tokens
             vi.mocked(fs.writeFile).mockClear(); 

            // Initially loaded tokens should be set
            expect((authManager as any).tokens.access_token).toBe('loaded_access');

            const initialToken = await authManager.getAccessToken(); 
            expect(typeof initialToken).toBe('string'); 
            expect(initialToken?.startsWith('refreshed_access_token_')).toBe(true);
            expect(OAuth2Client.prototype.getAccessToken).toHaveBeenCalledTimes(1);
            
            await vi.waitFor(() => {
                expect(fs.writeFile).toHaveBeenCalledTimes(1); // This should pass now
            });
            
            const writtenData = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string);
            expect(writtenData.access_token).toEqual(initialToken);
            expect(writtenData.refresh_token).toEqual('loaded_refresh'); 
            expect(writtenData.expiry_date).toBeGreaterThan(Date.now() - 5000); 
            
            // Check that the internal token state was updated
            expect((authManager as any).tokens.access_token).toEqual(initialToken);

            // Call again to ensure refresh happens again if needed
            // Add a small delay to ensure Date.now() produces a different value
            await new Promise(resolve => setTimeout(resolve, 10)); 
            const secondToken = await authManager.getAccessToken();
            expect(typeof secondToken).toBe('string');
            expect(secondToken?.startsWith('refreshed_access_token_')).toBe(true);
            expect(secondToken).not.toEqual(initialToken);
            expect(OAuth2Client.prototype.getAccessToken).toHaveBeenCalledTimes(2);
             
            await vi.waitFor(() => {
                expect(fs.writeFile).toHaveBeenCalledTimes(2);
            });
            const secondWrittenData = JSON.parse(vi.mocked(fs.writeFile).mock.calls[1][1] as string);
            expect(secondWrittenData.access_token).toEqual(secondToken);
        });

         it('should throw, clear tokens if refresh fails', async () => {
             await initializeAuthManager(true, true, true, true); // Start with valid tokens
             const refreshError = new Error('Refresh failed - invalid grant');
             (OAuth2Client.prototype.getAccessToken as Mock).mockRejectedValueOnce(refreshError);

            // Ensure the promise rejects correctly now
            await expect(authManager.getAccessToken()).rejects.toThrow(/^Failed to refresh access token:.*Refresh failed/);

            expect(fs.unlink).toHaveBeenCalledWith(MOCK_TOKEN_PATH);
            // Check state *after* the throwing operation completes
            expect(await authManager.isAuthenticated()).toBe(false); 
        });
    });

    describe('clearTokens', () => {
        beforeEach(async () => await initializeAuthManager(true, true, true, true)); // Start with tokens

        it('should clear tokens in memory and delete token file', async () => {
            // Check authenticated state *after* successful initialization
            expect(await authManager.isAuthenticated()).toBe(true);
            await authManager.clearTokens();
             // Check state *after* the clear operation completes
            expect(await authManager.isAuthenticated()).toBe(false);
            expect(fs.unlink).toHaveBeenCalledWith(MOCK_TOKEN_PATH);
            expect(OAuth2Client.prototype.setCredentials).toHaveBeenCalledWith({});
        });
    });

    describe('isAuthenticated', () => {
        // ... other tests ...

        it('should return false after clearing tokens', async () => {
             await initializeAuthManager(true, true, true, true);
             // Check initial state
             expect(await authManager.isAuthenticated()).toBe(true); 
             await authManager.clearTokens();
             // Check state *after* clear operation
             expect(await authManager.isAuthenticated()).toBe(false);
        });
         // ... other tests ...
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize OAuth2Client with credentials from config file', async () => {
            await initializeAuthManager(true, true);
             // Check initialization completed successfully (no throw from ensureInitialized)
            await expect((authManager as any).ensureInitialized()).resolves.toBeUndefined();
            expect(fs.readFile).toHaveBeenCalledWith(MOCK_CONFIG_PATH, 'utf-8');
            expect(OAuth2Client).toHaveBeenCalledTimes(1);
            expect(OAuth2Client).toHaveBeenCalledWith(MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, expect.any(String));
            // Check token load was attempted
             expect(fs.readFile).toHaveBeenCalledWith(MOCK_TOKEN_PATH, 'utf-8');
        });

        it('should reject initializationPromise on missing config file', async () => {
            // Don't await here, let the test check the promise state
             resetMocks(false, true); 
             authManager = new AuthManager();
             await expect((authManager as any).initializationPromise).rejects.toThrow(/Configuration file missing/);
             // Check that methods requiring initialization throw the specific error
             await expect(authManager.getAuthUrl()).rejects.toThrow(/Configuration file missing/);
             await expect(authManager.getAccessToken()).rejects.toThrow(/Configuration file missing/);
             expect(await authManager.isAuthenticated()).toBe(false);
        });

        it('should reject initializationPromise on invalid JSON in config file', async () => {
             resetMocks(true, false);
             authManager = new AuthManager();
             await expect((authManager as any).initializationPromise).rejects.toThrow(/Invalid JSON in config/);
             await expect(authManager.getAuthUrl()).rejects.toThrow(/Invalid JSON in config/);
             await expect(authManager.getAccessToken()).rejects.toThrow(/Invalid JSON in config/);
             expect(await authManager.isAuthenticated()).toBe(false);
        });

         it('should reject initializationPromise on missing clientId/clientSecret in config file', async () => {
            resetMocks(true, true); // Start with valid config mock setup
             // Override readFile just for config path for this specific test case
            vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
                if (filePath === MOCK_CONFIG_PATH) return JSON.stringify({ clientId: 'only-id' });
                 throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); // Default for others
            });

            authManager = new AuthManager();
             await expect((authManager as any).initializationPromise).rejects.toThrow(/clientId and clientSecret must be defined/);
             await expect(authManager.getAuthUrl()).rejects.toThrow(/clientId and clientSecret must be defined/);
        });
    });
});
