# Project Tasks: Photo Migrator
*(Cross-Platform Apple Photos to Google Photos Uploader for Photos and Videos)*

This document outlines the development tasks required to build the uploader application. Tasks are broken down into phases following an agile approach, prioritizing a functional Minimum Viable Product (MVP) first. Each task includes checkboxes for tracking progress.

**Testing Note:** Every feature implementation task should be accompanied by corresponding unit and/or integration tests as defined in `TESTING.md`. E2E tests will be added progressively, focusing on key workflows.

---

## Phase 0: Prerequisites & Setup

- [x] ✅ **Task 0.1:** Set up Google Cloud Project and OAuth Credentials for Desktop App.
  *Detail:* Requires manual steps in Google Cloud Console and automated steps via `gcloud` CLI.
  *Project ID:* `soda-381700`
  1.  **[Automated - Optional]** Authenticate CLI: Run `gcloud auth login` and follow prompts if not already authenticated with the correct account.
  2.  **[Automated]** Set active `gcloud` project: `gcloud config set project photo-migrator-457412`.
  3.  **[Automated]** Enable Photos Library API: `gcloud services enable photoslibrary.googleapis.com --project=photo-migrator-457412`.
  4.  **[Manual - Console]** Navigate to APIs & Services > OAuth consent screen.
  5.  **[Manual - Console]** Configure Consent Screen:
      *   Select User Type: **External**.
      *   Fill in App name (e.g., "Photo Migrator"), User support email, Developer contact info.
      *   Save and continue (scopes can be skipped).
      *   Add your Google Account email as a **Test User**.
      *   Save/Complete consent screen setup.
  6.  **[Manual - Console]** Navigate to APIs & Services > Credentials.
  7.  **[Manual - Console]** Create Credentials:
      *   Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
      *   Select Application type: **Desktop app**.
      *   Give it a name (e.g., "Photo Migrator Desktop Client").
      *   Click **Create**.
  8.  **[Manual - Local]** Copy the displayed **Client ID** and **Client Secret**.
  9.  **[Manual - Local]** Update the `~/.config/photo-migrator/config.json` file with these credentials.
  - *Outcome:* Obtain the `CLIENT_ID` and `CLIENT_SECRET` required for `config.json` (see Task 1.3.3 & FSD 3.2.1).
  *Resource:* [Google Cloud Console](https://console.cloud.google.com/)

---

## Phase 1: Core MVP - CLI Scanner & Uploader (macOS Focus)

**Goal:** Establish the fundamental backend logic for scanning the Apple Photos library on macOS, authenticating with Google, uploading files, and basic state management. Output will be via console logs.

### 1.1 Project Setup & Core Dependencies
- [x] ✅ **Task 1.1.1:** Initialize Node.js project (`npm init`).
- [x] ✅ **Task 1.1.2:** Set up TypeScript configuration (`tsconfig.json`).
  - *Detail:* Configure strict mode, module resolution (NodeNext), target (ES2022 or later), and output directory.
- [x] ✅ **Task 1.1.3:** Install core dependencies:
  - [x] ✅ `typescript`, `@types/node`
  - [x] ✅ `google-auth-library` (for OAuth)
  - [x] ✅ `axios` or `node-fetch` (for API calls)
  - [x] ✅ `better-sqlite3` (for local database)
  - [x] ✅ `winston` or similar (for logging)
- [x] ✅ **Task 1.1.4:** Set up basic project structure (e.g., `src/`, `dist/`, `scripts/`).
- [x] ✅ **Task 1.1.5:** Configure ESLint and Prettier for code quality.
  - *Detail:* Use recommended rulesets (`eslint:recommended`, `plugin:@typescript-eslint/recommended`) and integrate Prettier.
- [x] ✅ **Task 1.1.6:** Set up `Vitest` or `Jest` for unit testing.
  - *Detail:* Configure test runner, add basic test script to `package.json`.

### 1.2 SQLite Database Setup
- [x] ✅ **Task 1.2.1:** Define SQLite schema for tracking files (e.g., `media_items` table).
  - *Fields:* `id` (PK), `original_path` (path in Photos library), `local_copy_path` (temp path if exported), `original_name`, `size_bytes`, `creation_date`, `sha256_hash`, `status` (e.g., 'pending', 'exported', 'uploaded', 'failed', 'skipped'), `google_photos_id` (optional), `error_message`, `media_type` ('photo' or 'video'), `duration_seconds` (for videos), `mime_type`, `codec` (for videos).
- [x] ✅ **Task 1.2.2:** Implement `DatabaseManager` module.
  - *Methods:* `initialize()`, `addMedia()`, `updateMediaStatus()`, `getPendingMedia()`, `getMediaByHash()`, `getTotalCount()`, `getCompletedCount()`, `getMediaCountByType()`.
- [x] ✅ **Task 1.2.3:** Write unit tests for `DatabaseManager`.
  - *Coverage:* Test all CRUD operations and query logic.

### 1.3 Authentication (Google OAuth2)
- [x] ✅ **Task 1.3.1:** Implement `AuthManager` module.
  - *Detail:* Use `google-auth-library`.
- [x] ✅ **Task 1.3.2:** Implement OAuth consent flow (open browser, handle redirect/OOB code).
  - *Detail:* Print auth URL to console for user to visit. Handle manual code input via CLI.
- [x] ✅ **Task 1.3.3:** Handle OAuth Credentials & Token Storage (Phase 1).
  - *Credentials:* Load `clientId` and `clientSecret` from required `config.json` file located in `~/.config/photo-migrator/` (or OS equivalent). See FSD 3.2.1 for format.
  - *Tokens:* Store received OAuth tokens (access, refresh, expiry, scope) in `google-tokens.json` within the same configuration directory using Node.js `fs` module with restricted permissions (0o600).
  - *Note:* This file-based storage is for Phase 1 simplicity. Secure storage (`keytar`) and client secret handling (backend proxy) are planned for Phase 4 (Tasks 4.6.1, 4.6.2).
- [x] ✅ **Task 1.3.4:** Implement token refresh logic.
  - *Detail:* Utilize `google-auth-library`'s built-in refresh capabilities. Ensure loaded refresh token is used and updated tokens (access token, expiry) are re-stored to `google-tokens.json` after successful refresh.
- [x] ✅ **Task 1.3.5:** Add basic unit tests for `AuthManager`.
  - *Detail:* Mock `google-auth-library` and Node.js `fs` module. Test initialization (config loading), auth URL generation, code handling, token loading, access token retrieval (including refresh), and token clearing.

### 1.4 Media Scanner (macOS - Swift Bridge)
- [x] ✅ **Task 1.4.1:** Create a Swift command-line tool project (`MediaScannerMac`).
  - *Detail:* Use Swift Package Manager.
- [x] ✅ **Task 1.4.2:** Implement Swift code to access `Photos.framework`.
  - *Functionality:* Iterate through all photos/videos in the system library.
  - *Output:* For each item, print JSON to stdout containing: `originalPath` (if available locally), `original_name`, `uti` (file type), `creationDate`, `modificationDate`, `sizeBytes`, `isIniCloud`, `mediaType` ('photo' or 'video'), `durationSeconds`, `codec`.
  - *Error Handling:* Handle permissions errors gracefully.
- [x] ✅ **Task 1.4.3:** Implement Node.js module (`MediaScanner`) to run the Swift tool as a child process.
  - *Functionality:* Spawn the Swift executable, capture stdout, parse JSON output line by line.
  - *Integration:* Add scanned media to the SQLite database via `DatabaseManager`.
- [x] ✅ **Task 1.4.4:** Add basic integration tests for the Node.js `MediaScanner` (mocking the Swift executable's output).
- [x] ✅ **Task 1.4.5:** Document how to build and where to place the Swift executable for the Node.js app to find it.
- [x] ✅ **Task 1.4.6:** Add basic unit tests for the Swift `MediaScannerMac` code.
  - *Detail:* Set up `XCTest` target. Add placeholder tests confirming the test setup works. Focus on testing helper functions or data structures if refactored later.
  - *Note:* Requires the full Xcode command-line tools path to be active (`sudo xcode-select -s /Applications/Xcode.app/...`) for `swift test` to find `XCTest`.

### 1.5 Uploader Engine (Google Photos API)
- [x] ✅ **Task 1.5.1:** Implement `Uploader` module.
- [x] ✅ **Task 1.5.2:** Implement function to upload bytes (Step 1 in `API.md`).
  - *Input:* File path, access token.
  - *Output:* Upload token.
  - *Error Handling:* Implement basic retry logic for 5xx errors. Handle 401 by signaling `AuthManager` to refresh.
  - *Video Support:* Implement longer timeouts and larger chunk sizes for videos.
- [x] ✅ **Task 1.5.3:** Implement function to create media item (Step 2 in `API.md`).
  - *Input:* Upload token, access token, media type, (optional) description.
  - *Output:* Success status, new media item ID (if successful).
  - *Error Handling:* Handle specific errors mentioned in `API.md`.
- [x] ✅ **Task 1.5.4:** Implement core upload workflow:
  - Fetch a pending media item from `DatabaseManager`.
  - Get a valid access token from `AuthManager`.
  - If file is in iCloud (`local_copy_path` is null), *initially skip* (downloading handled later).
  - *MVP Simplification:* Assume files are locally available for now. Use `original_path`.
  - Upload bytes, get upload token.
  - Create media item.
  - Update media status in `DatabaseManager` ('completed' or 'failed' with error message).
  - Handle media type-specific requirements (longer timeouts for videos).
- [x] ✅ **Task 1.5.5:** Add basic unit tests for `Uploader` (mocking API calls and `DatabaseManager`).

### 1.6 Basic CLI Orchestration
- [✅] **Task 1.6.1:** Create main CLI entry point (`src/main.ts`).
- [✅] **Task 1.6.2:** Add command-line arguments parsing (e.g., using `yargs`).
    - *Commands:* `scan`, `upload`, `login`, `status`.
    - *Filters:* Add `--type` option to filter by media type (photos, videos, or all).
- [✅] **Task 1.6.3:** Implement `login` command (triggers `AuthManager`).
- [✅] **Task 1.6.4:** Implement `scan` command (triggers `MediaScanner`).
- [✅] **Task 1.6.5:** Implement `upload` command (loops through pending media items, triggers `Uploader`).
    - *Detail:* Add basic console logging for progress (e.g., "Uploading file X of Y...").
    - *Media Types:* Add support for filtering by media type (`--photos-only`, `--videos-only`).
- [✅] **Task 1.6.6:** Implement `status` command (queries `DatabaseManager` for counts).
    - *Detail:* Report counts by media type (photos vs videos).
- [✅] **Task 1.6.7:** Add `npm` scripts for running commands (e.g., `npm run scan`, `npm run upload`).

---

## Phase 2: Essential Features & Stability

**Goal:** Enhance the core engine with robust features like batching, resource management, better error handling, basic UI integration, and Windows support.

### 2.1 Smart Batching & Temporary Export
- [ ] **Task 2.1.1:** Implement `BatchPlanner` module.
  - *Functionality:* Selects media from the database for the next batch based on estimated size.
  - *Input:* Available disk space (initially mocked/hardcoded), max batch size.
  - *Media Types:* Support batching strategies based on media type (e.g., prioritize photos first).
- [ ] **Task 2.1.2:** Modify macOS Swift tool (`MediaScannerMac`) to add an *export* command.
  - *Input:* List of media identifiers (e.g., `localIdentifier` from Photos.framework).
  - *Functionality:* Exports the specified photos/videos to a temporary directory. Returns JSON mapping identifiers to exported file paths.
  - *Handling iCloud:* If a file needs downloading, the Swift tool should wait (with timeout) or report it as 'downloading'.
  - *Video Support:* Handle large video exports appropriately, report progress.
- [ ] **Task 2.1.3:** Update Node.js `MediaScanner` module to call the new Swift export command.
  - *Workflow:* `BatchPlanner` selects media -> `MediaScanner` calls Swift `export` -> `MediaScanner` updates `local_copy_path` in DB.
  - *Media Types:* Handle media type specific behaviors during export.
- [ ] **Task 2.1.4:** Modify `Uploader` to use `local_copy_path` for uploads.
- [ ] **Task 2.1.5:** Implement cleanup logic: delete temporary files after successful batch upload.
- [ ] **Task 2.1.6:** Add unit/integration tests for `BatchPlanner` and export flow.

### 2.2 Disk Space Monitoring
- [ ] **Task 2.2.1:** Implement `DiskMonitor` module.
  - *Dependency:* Use `check-disk-space` or similar library.
  - *Functionality:* Periodically check free space on the volume containing the temporary export directory.
  - *Video Support:* Add special warnings for large video files.
- [ ] **Task 2.2.2:** Integrate `DiskMonitor` with `BatchPlanner`.
  - *Logic:* Pass actual available disk space to the planner. Pause exports/uploads if space is critically low.
  - *Media Types:* Implement different space thresholds for photos vs. videos.
- [ ] **Task 2.2.3:** Add unit tests for `DiskMonitor`.

### 2.3 Network Monitoring & Resilience
- [ ] **Task 2.3.1:** Implement `NetworkMonitor` module.
  - *Dependency:* Use Node.js `dns` module or `node-fetch` with a known endpoint to check connectivity.
  - *Functionality:* Periodically check online status. Emit events ('online', 'offline').
- [ ] **Task 2.3.2:** Integrate `NetworkMonitor` with `Uploader`.
  - *Logic:* Pause uploads when offline, resume when online.
  - *Media Types:* Add optional configuration to only upload videos on certain network types.
- [ ] **Task 2.3.3:** Enhance `Uploader` retry logic (exponential backoff).
  - *Detail:* Use a library like `async-retry` or implement manually. Configure max attempts.
  - *Media Types:* Implement different retry strategies for photos vs. videos.
- [ ] **Task 2.3.4:** Add unit tests for `NetworkMonitor` and retry logic.

### 2.4 Windows Support - Initial Setup
- [ ] **Task 2.4.1:** Set up development environment for Windows testing (VM or physical machine).
- [ ] **Task 2.4.2:** Adapt secure token storage for Windows (Credential Manager).
  - *Detail:* Update `AuthManager` to use `keytar`'s Windows backend.
- [ ] **Task 2.4.3:** Implement Windows `MediaScanner` alternative.
  - *Strategy:* Scan a user-specified directory (representing the iCloud Photos download location).
  - *Implementation:* Use Node.js `fs` module (`readdir`, `stat`) to find media files.
  - *Metadata:* Use a library like `exif-parser` to extract creation dates from JPEGs. Handle videos/other types best-effort.
  - *Video Support:* Extract video metadata (duration, codec) using appropriate libraries.
- [ ] **Task 2.4.4:** Add conditional logic in main CLI/orchestrator to use the correct `MediaScanner` based on OS.
- [ ] **Task 2.4.5:** Test basic scan and upload functionality on Windows.

### 2.5 Basic Electron Shell Setup
- [ ] **Task 2.5.1:** Add Electron dependencies (`electron`, `electron-builder`).
- [ ] **Task 2.5.2:** Create basic main process file (`electron/main.ts`).
  - *Functionality:* Create a `BrowserWindow`.
- [ ] **Task 2.5.3:** Create a minimal preload script (`electron/preload.ts`).
- [ ] **Task 2.5.4:** Create a placeholder renderer process HTML file (`index.html`).
- [ ] **Task 2.5.5:** Configure `electron-builder` for macOS and Windows packaging (basic setup).
- [ ] **Task 2.5.6:** Set up IPC (Inter-Process Communication) basics (`ipcMain`, `ipcRenderer`).
  - *Goal:* Allow the future UI to trigger backend actions (scan, upload) and receive status updates.
- [ ] **Task 2.5.7:** Modify CLI orchestrator logic to be callable via IPC handlers instead of direct CLI commands.

### 2.6 Basic UI - Progress Display
- [ ] **Task 2.6.1:** Add React and Tailwind CSS to the project for the renderer process.
- [ ] **Task 2.6.2:** Create a simple React component (`App.tsx`) in the renderer.
- [ ] **Task 2.6.3:** Display basic status information received via IPC from the main process.
  - *Info:* Total files, uploaded files, current status (e.g., "Scanning...", "Uploading file X...", "Idle").
  - *Media Types:* Add counters and indicators for photos vs. videos.
  - *No controls yet.*
- [ ] **Task 2.6.4:** Ensure backend modules (`DatabaseManager`, `Uploader`) emit progress updates consumable via IPC.
  - *Detail:* Include media type in progress events.

---

## Phase 3: Full GUI & User Experience

**Goal:** Implement the complete graphical user interface using Electron/React, add user controls, settings management, and background operation features.

### 3.1 UI Implementation (React + Tailwind)
- [ ] **Task 3.1.1:** Design basic UI layout (mockups recommended).
  - *Sections:* Status overview, progress bar (overall), detailed log view, settings panel, start/pause/cancel buttons.
  - *Media Types:* Add UI elements to show photo vs. video stats.
- [ ] **Task 3.1.2:** Implement Status Overview component.
  - *Display:* Total files, completed, failed, remaining. Estimated time (basic calculation).
  - *Media Types:* Add breakdown by photos vs. videos.
- [ ] **Task 3.1.3:** Implement Progress Bar component.
  - *Detail:* Show separate progress indicators for photos and videos if appropriate.
- [ ] **Task 3.1.4:** Implement Log View component.
  - *Display:* Show timestamped logs from the backend (info, errors, warnings).
  - *Media Types:* Include media type in log entries where relevant.
- [ ] **Task 3.1.5:** Implement Control Buttons (Start Scan, Start Upload, Pause, Resume, Cancel).
  - *Functionality:* Wire up buttons to send IPC messages to the main process.
  - *Media Types:* Add filters for photo/video selection.
- [ ] **Task 3.1.6:** Implement main process handlers for UI controls.
  - *Logic:* Start/pause/resume/cancel scan or upload operations.

### 3.2 Settings Management
- [ ] **Task 3.2.1:** Implement `SettingsManager` module (backend).
  - *Functionality:* Load/save settings to a JSON file or use `electron-store`.
  - *Settings:* Disk usage limit (%), upload speed limit (optional, maybe later), retry count, WiFi-only mode (boolean), auto-start on boot (boolean).
  - *Media Types:* Add video-specific settings (enable/disable video uploads, max video size).
- [ ] **Task 3.2.2:** Create Settings Panel UI component (React).
  - *Elements:* Input fields/checkboxes for each setting. Save button.
  - *Media Types:* Add section for video-specific settings.
- [ ] **Task 3.2.3:** Implement IPC communication for loading/saving settings.
- [ ] **Task 3.2.4:** Integrate settings into relevant backend modules:
  - `BatchPlanner` (disk limit)
  - `Uploader`
  - `NetworkMonitor` (WiFi-only - *requires detecting connection type*)
- [ ] **Task 3.2.5:** Add unit tests for `SettingsManager`.

### 3.3 System Tray & Background Operation
- [ ] **Task 3.3.1:** Implement system tray icon creation in Electron main process.
  - *Dependency:* Use Electron `Tray` API.
  - *Icon:* Create basic app icons for tray (macOS/Windows).
- [ ] **Task 3.3.2:** Implement tray menu.
  - *Options:* Show App, Status (brief), Pause/Resume, Quit.
  - *Media Types:* Add status indicators for photos vs. videos.
- [ ] **Task 3.3.3:** Allow app window to be closed while process continues in background (tray).
  - *Logic:* Intercept window close event, hide window instead of quitting if uploads are active.
- [ ] **Task 3.3.4:** Implement auto-start on system boot feature (opt-in via settings).
  - *Dependency:* Use Electron `app.setLoginItemSettings` API.

### 3.4 Windows Refinements
- [ ] **Task 3.4.1:** Test and refine Windows UI specifics (styling, window controls).
- [ ] **Task 3.4.2:** Ensure Windows Credential Manager integration is robust.
- [ ] **Task 3.4.3:** Test Windows installer creation using `electron-builder`.
  - *Configuration:* Signing certificate (if available), install mode (per-user vs machine).

### 3.5 E2E Testing Setup
- [ ] **Task 3.5.1:** Add Playwright or Spectron for Electron E2E testing.
- [ ] **Task 3.5.2:** Write first E2E test case: Launch -> Login -> Scan -> Basic Upload -> Quit.
  - *Mocking:* Use MSW (Mock Service Worker) or similar to mock Google Photos API calls during E2E tests.
  - *Data:* Set up mock photo/video library/directory for tests.
  - *Media Types:* Include both photos and videos in the test suite.

---

## Phase 4: Polish & Advanced Features

**Goal:** Improve robustness, performance, UX, and add features like duplicate handling and better configuration.

### 4.1 Duplicate Detection
- [ ] **Task 4.1.1:** Implement SHA256 hash calculation during media scanning (Node.js).
  - *Detail:* Calculate hash for locally available files. Store in SQLite DB.
  - *Media Types:* Handle video file hashing appropriately (may be more expensive).
- [ ] **Task 4.1.2:** Modify `Uploader` to check for existing hash in DB before uploading.
  - *Logic:* If exact hash match found, mark as 'skipped_duplicate' in DB.
- [ ] **Task 4.1.3:** (Optional - Advanced) Implement perceptual hashing (e.g., `blockhash-js` or similar).
  - *Detail:* Calculate visual hash during scan. Store in DB.
  - *Media Types:* For videos, generate hash from thumbnail or selected frames.
- [ ] **Task 4.1.4:** (Optional - Advanced) Add setting for visual duplicate handling (Skip / Warn).
- [ ] **Task 4.1.5:** (Optional - Advanced) If 'Warn', add UI element to show potential visual duplicates and let user decide.
- [ ] **Task 4.1.6:** Add tests for duplicate detection logic.

### 4.2 UI/UX Refinements
- [ ] **Task 4.2.1:** Improve progress reporting (per-file progress, better ETA).
  - *Media Types:* Make ETAs more accurate for videos based on size/duration.
- [ ] **Task 4.2.2:** Add notifications for key events (e.g., upload complete, critical error).
  - *Dependency:* Use Electron `Notification` API.
- [ ] **Task 4.2.3:** Refine styling (Tailwind) for a more polished look & feel.
- [ ] **Task 4.2.4:** Implement Light/Dark mode support based on OS settings.
- [ ] **Task 4.2.5:** Accessibility Audit (`axe-core`) and fixes.
  - *Checks:* Keyboard navigation, screen reader compatibility (labels, roles).

### 4.3 Performance & Optimization
- [ ] **Task 4.3.1:** Profile application during large uploads (`clinic.js`, DevTools).
  - *Media Types:* Measure performance differences between photo and video uploads.
- [ ] **Task 4.3.2:** Optimize database queries (add indices to SQLite table).
- [ ] **Task 4.3.3:** Optimize media scanning process (if bottlenecks identified).
- [ ] **Task 4.3.4:** Investigate and implement upload concurrency (if safe and beneficial).
  - *Caution:* Respect API rate limits. Start with 1 concurrent upload.
  - *Media Types:* Consider different concurrency settings for photos vs. videos.

### 4.4 Testing Enhancements
- [ ] **Task 4.4.1:** Increase unit test coverage, focusing on core logic modules (target >90%).
- [ ] **Task 4.4.2:** Add more E2E test scenarios covering:
  - Pause/Resume
  - Network offline/online transitions
  - Settings changes
  - Error conditions (disk full, API errors)
  - Duplicate skipping
  - Media type specific tests (photos vs. videos)
- [ ] **Task 4.4.3:** Set up CI (GitHub Actions) to run tests automatically on PRs.
  - *Workflows:* Linting, Type Checking, Unit Tests, E2E Tests (on macOS and Windows runners).

### 4.5 Final Packaging & Distribution
- [ ] **Task 4.5.1:** Finalize `electron-builder` configuration for macOS and Windows.
  - *Include:* App icons, code signing (macOS notarization, Windows EV cert recommended).
- [ ] **Task 4.5.2:** Implement auto-update mechanism.
  - *Dependency:* Use `electron-updater`.
- [ ] **Task 4.5.3:** Create basic README and documentation for users.
  - *Detail:* Document supported photo and video formats.
- [ ] **Task 4.5.4:** Perform manual QA testing across supported platforms (as per `TESTING.md`).
  - *Media Types:* Test with various photo and video formats.

---

This task list provides a structured path. Priorities might shift based on feedback and challenges encountered during development. Remember to commit frequently and write clear commit messages!