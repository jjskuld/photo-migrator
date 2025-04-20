# Product Requirements Document (PRD)

## Project Name:
**Photo Migrator**
*(Cross-Platform Apple Photos to Google Photos Uploader)*

## 1. Purpose
Create a reliable, efficient, and user-friendly desktop application that uploads a user's Apple Photos library to Google Photos while:
- Preserving original metadata and filenames
- Managing bandwidth and disk usage
- Supporting background and offline-resilient operation
- Providing progress visibility and retry logic
- Running on both macOS and Windows

## 2. Out of Scope
- Editing or modifying photos/videos
- Uploading from mobile devices
- Synchronizing between devices
- Uploading to destinations other than Google Photos

---

## 3. Features

### 3.1 File Discovery and Metadata Extraction
**Description:** Identify all eligible media files in the Apple Photos library or designated iCloud download folder.

**Subtasks:**
- macOS: Use Swift + AppleScript to access Photos.framework, resolve file paths, detect iCloud-only items
- Windows: Scan iCloud synced downloads folder
- Extract metadata: creation date, original filename, file size
- Persist scan results in local DB

**Acceptance Criteria:**
- 100% of media files with accessible paths and metadata are included in the job list
- iCloud-only files are queued for download before upload

---

### 3.2 Upload Engine (Google Photos API)
**Description:** Uploads media in batches using resumable API with error handling, metadata preservation, and duplicate detection.

**Subtasks:**
- OAuth2 login (with token refresh)
- Use `mediaItems:batchCreate` endpoint
- Retry failed uploads (configurable retry limit)
- Deduplication based on hash + metadata
- Preserve creation timestamp (if allowed by API)

**Acceptance Criteria:**
- No duplicates in destination Google Photos account
- All uploads resume on crash or restart
- Metadata (timestamp, file type) visible in uploaded photo on Google Photos

---

### 3.3 Smart Batching and Disk Management
**Description:** Create temporary upload batches sized intelligently based on available disk space.

**Subtasks:**
- Monitor free disk space dynamically
- Calculate safe usage limit (e.g., 80% of available space or user-defined cap)
- Select media for each batch based on size, avoiding overcommit
- Clean up temp files after each batch

**Acceptance Criteria:**
- App never consumes more than configured disk space
- App gracefully skips large files that exceed available space

---

### 3.4 Progress Tracking and GUI
**Description:** Modern desktop UI showing upload progress, controls, logs, and configuration.

**Subtasks:**
- Total file count and completed count
- Per-file and overall progress bars
- Estimated time remaining
- Logs of errors, retries, and skipped files
- UI built with React + Tailwind inside Electron
- System tray support with background status

**Acceptance Criteria:**
- UI updates in real time with clear feedback
- Users can pause, resume, or cancel uploads

---

### 3.5 Network and Bandwidth Management
**Description:** Ensure uploads only happen under suitable network conditions and throttle bandwidth.

**Subtasks:**
- Detect online/offline state
- Restrict uploads to WiFi (configurable)
- Set upload speed cap (e.g., 5 Mbps)
- Pause/resume on network loss and reconnect

**Acceptance Criteria:**
- Upload pauses automatically when offline or on metered connection
- Upload speed never exceeds user-defined cap

---

### 3.6 Background Operation and Auto-Resume
**Description:** Continue working without user interaction and recover from interruptions.

**Subtasks:**
- Persist upload state to SQLite
- Detect and auto-resume incomplete uploads on app launch
- Auto-start on system boot (opt-in)

**Acceptance Criteria:**
- Uploads resume within 10 seconds of app restart or reconnect
- State is preserved across reboots

---

### 3.7 Configuration and Settings
**Description:** Allow users to configure key behaviors.

**Subtasks:**
- Disk usage limit
- Retry count
- Upload speed limit
- WiFi-only mode
- OAuth re-authentication

**Acceptance Criteria:**
- Settings persist across restarts
- All settings validated for acceptable input range

---

### 3.8 Security and Privacy
**Description:** Handle user data responsibly.

**Subtasks:**
- Store tokens securely (macOS Keychain, Windows Credential Store)
- Encrypt or obfuscate logs and sensitive data
- No analytics or telemetry unless explicitly enabled
- Clear user data option on uninstall

**Acceptance Criteria:**
- No sensitive data is stored in plaintext
- App complies with OAuth app verification requirements

---

## 4. Technical Stack

| Layer         | Technology                     |
|---------------|---------------------------------|
| UI            | Electron + React + Tailwind    |
| Backend       | Node.js                        |
| File Access   | Swift (macOS), FS (Windows)    |
| Upload API    | Google Photos API              |
| Auth          | google-auth-library (OAuth2)   |
| Local DB      | SQLite (better-sqlite3)        |
| Packaging     | Electron Builder               |
| Background    | Electron tray + auto-launch    |


## 5. Architecture Overview
**Modules:**
- Media Scanner
- Batch Manager
- Upload Worker
- Disk Monitor
- Network Monitor
- UI Renderer
- Persistent Store (SQLite)
- Auth Manager

*(Diagram not shown, but recommended)*


## 6. Delivery Plan

| Phase | Scope |
|-------|--------|
| P1 | CLI-based scanner + uploader with config file |
| P2 | Smart batching + SQLite resume logic |
| P3 | Full GUI with pause/resume, settings panel |
| P4 | Background mode + tray icon + notifications |
| P5 | Windows support + installer packaging |


## 7. Risks & Mitigation

| Risk | Mitigation |
|------|-------------|
| iCloud media unavailable | Trigger downloads, warn user if space insufficient |
| OAuth token expires | Refresh tokens and re-authenticate if needed |
| API quota limits | Track usage, retry later if quota exceeded |
| Large file upload fails | Use resumable upload + retries |


## 8. Future Considerations
- Multiple Google account support
- Upload to albums
- Upload prioritization by date or face tags
- Localization (i18n)
- Accessibility (a11y)


## 9. Glossary
- **Batch**: A group of media files exported and uploaded together
- **Staging Folder**: Temp folder for export before upload
- **Resumable Upload**: Google API feature for chunked, retryable file uploads
- **Tray App**: UI that lives in system tray and operates in background

