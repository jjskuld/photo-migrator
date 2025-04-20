# Product Requirements Document (PRD)

## Project Name:
**Photo Migrator**
*(Cross-Platform Apple Photos to Google Photos Uploader for Photos and Videos)*

---

## 1. Purpose
Create a reliable, efficient, and user-friendly desktop application that uploads a user's Apple Photos library (including photos, videos, and music) to Google Photos while:
- Preserving original metadata, EXIF data, and filenames
- Managing bandwidth and disk usage
- Supporting background and offline-resilient operation
- Providing progress visibility and retry logic
- Running on macOS and Windows

**Target Audience:**
- Professional photographers and content creators with large media libraries
- Casual users with limited disk space seeking reliable backups
- Families sharing a single Google Photos account for collaborative uploads

### Key Drivers:
1. **Efficient Disk Usage:** Existing iCloud sync workflows can double the library's size temporarily, making them unusable on machines with limited disk space. This tool avoids unnecessary duplication.
2. **Improved Visibility:** Current tools offer poor feedback on sync progress. This app provides granular, real-time progress tracking.
3. **Multi-Album Handling:** Users with multiple Apple Photos libraries or albums need the ability to merge and upload while managing duplicates intelligently. Support for multiple family members contributing to a shared Google Photos account is also a priority.
4. **Performance Focus:** Designed for low-spec machines, with minimal RAM and disk requirements, and optimized for speed and reliability.
5. **Highly Customizable:** Users can opt to skip cloud-only iCloud photos, customize concurrency, upload bandwidth, and prioritize locally available files for maximum control.

---

## 2. Out of Scope
- Editing or modifying photos/videos
- Uploading from mobile devices
- Synchronizing between devices
- Uploading to destinations other than Google Photos
- Converting or transcoding videos

**Dependencies:**
- Google Photos API quota and rate limits
- Rust ≥1.60 and Tauri ≥1.0 compatibility
- SQLite 3.x engine
- Swift 5+ on macOS for Photos.framework integration
---

## 3. Features

### 3.0 Success Metrics
- **Upload Completion Rate:** ≥99% of selected media successfully uploaded on first attempt
- **Average Throughput:** ≥10 MB/s under standard network conditions
- **Disk Usage Efficiency:** Temporary staging never exceeds 80% of configured cap
- **User Satisfaction:** ≥90% positive feedback in beta testing

### 3.1 File Discovery and Metadata Extraction

### 3.1 File Discovery and Metadata Extraction
**Description:** Identify all eligible media files (photos, videos, and music) in the Apple Photos library or designated iCloud download folder.

**Subtasks:**
- macOS: Use Swift + AppleScript to access Photos.framework, resolve file paths, detect iCloud-only items
- Windows: Scan iCloud synced downloads folder
- Extract metadata: creation date, original filename, file size, media type, mime_type, EXIF data, video duration (for videos)
- Preserve original filenames and EXIF metadata
- Persist scan results in local DB (SQLite)
- Configurable behavior to skip iCloud-only items (cloud-only references without full-res local copy)
- Implement rolling-window download strategy to process cloud-only items in batches, auto-cleaning files after upload

**Acceptance Criteria:**
- 100% of accessible media files included
- Cloud-only items are optionally skipped or processed in rolling batches
- Metadata and EXIF properly extracted and persisted
- Original filenames retained

**Subtasks:**
- macOS: Use Swift + AppleScript to access Photos.framework, resolve file paths, detect iCloud-only items
- Windows: Scan iCloud synced downloads folder
- Extract metadata: creation date, original filename, file size, media type, EXIF data, video duration (for videos)
- Preserve original filenames and EXIF metadata
- Persist scan results in local DB
- Configurable behavior to skip iCloud-only items (cloud-only references without full-res local copy)

**Acceptance Criteria:**
- 100% of media files with accessible paths and metadata are included
- iCloud-only files are optionally skipped if configured
- Video and photo metadata including EXIF is properly extracted and persisted
- Original filenames are retained

### 3.2 Upload Engine (Google Photos API)
**Description:** Uploads media in batches using the Google Photos API, using resumable upload endpoints with error handling, metadata preservation, and duplicate detection. Authentication is handled via OAuth2, but to protect sensitive credentials (e.g. client secret), the application requires a lightweight backend service to handle the OAuth token exchange step securely. This backend service is only used during initial authentication. All uploads are handled entirely by the local desktop application and sent directly to Google Photos — no media files are transmitted through or stored by the backend.

$1- Implement a minimal backend service to handle OAuth client secret securely and perform token exchange
- OAuth2 login and refresh
- Use `mediaItems:batchCreate` endpoint
- Retry failed uploads
- Deduplication via hash + metadata
- Preserve timestamps, EXIF metadata, and filenames (if API permits)
- Handle video upload edge cases
- Configurable concurrency for simultaneous uploads

**Acceptance Criteria:**
- No duplicates in destination
- Upload resumes on crash/restart
- Metadata (EXIF, timestamp, media type) and filenames visible in Google Photos
- Videos retain original quality
- Concurrency level matches user-defined setting

### 3.3 Smart Batching and Disk Management
**Description:** Create temporary upload batches based on available disk space.

**Subtasks:**
- Monitor available disk space
- Use safe threshold (e.g., 80% max)
- Select batch intelligently to avoid overflow
- Prioritize smaller files when tight on space
- Clean up after each batch

**Acceptance Criteria:**
- Never exceeds configured disk space
- Gracefully skips large files
- Avoids unnecessary duplication

### 3.4 Progress Tracking and GUI
**Description:** Desktop UI for progress, control, logs, and configuration.

**Subtasks:**
- File counts, progress bars
- Media type indicators
- ETA display
- Error/retry/skipped logs
- React + Tailwind UI inside Electron
- System tray with background status

**Acceptance Criteria:**
- Real-time updates
- Pause/resume/cancel support
- Separate indicators for video uploads

### 3.5 Network and Bandwidth Management
**Description:** Manage network conditions and upload speed.

**Subtasks:**
- Detect online/offline state
- Restrict to WiFi (optional)
- Upload speed cap
- Pause on disconnect, resume on reconnect
- Optional video upload restrictions
- User-defined max bandwidth usage

**Acceptance Criteria:**
- Upload pauses when offline or on metered connection
- Speed cap enforced
- Photo/video policies configurable
- Bandwidth and concurrency customizable by user

### 3.6 Background Operation and Auto-Resume
**Description:** Ensure the app continues working in background and recovers from interruptions.

**Subtasks:**
- Persist state in SQLite
- Resume incomplete uploads
- Opt-in auto-launch
- Chunked resume for videos

**Acceptance Criteria:**
- Upload resumes within 10 seconds
- State preserved across reboots
- Video chunks resume properly

### 3.7 Configuration and Settings
**Description:** User-configurable behaviors.

Configuration will be stored in a dedicated SQLite table to ensure reliable persistence and concurrent access. A JSON export/import feature may be provided for advanced users who wish to backup or share their configuration settings.

**Subtasks:**
- Disk usage cap
- Retry settings
- Speed limit
- WiFi-only toggle
- OAuth re-auth
- Media type filters
- Skip iCloud-only photos (optional)
- Concurrency (number of simultaneous uploads)

**Acceptance Criteria:**
- Persistent settings
- Validated inputs
- Media filters and concurrency settings applied correctly

### 3.8 Security and Privacy
**Description:** Secure handling of sensitive data.

**Subtasks:**
- Store tokens securely
- Obfuscate logs and credentials
- Opt-in telemetry only
- Clear all data on uninstall

**Acceptance Criteria:**
- No plaintext sensitive data
- OAuth compliance ensured

---

## 4. Technical Stack

| Layer         | Technology                     |
|---------------|---------------------------------|
| UI            | Tauri + WebView + Tailwind     |
| Backend       | Rust                           |
| File Access   | Swift (macOS), FS (Windows)    |
| Upload API    | Google Photos API              |
| Auth          | oauth2 crate for Rust          |
| Local DB      | SQLite (via rusqlite)          |
| Packaging     | Tauri Bundler                  |
| Background    | Tauri tray + auto-launch       |

**Version Constraints:** Rust ≥1.60, Tauri ≥1.0, SQLite 3.x, oauth2 ≥4.x, Swift ≥5.0

---------------|---------------------------------|
| UI            | Tauri + WebView + Tailwind     |
| Backend       | Rust                           |
| File Access   | Swift (macOS), FS (Windows)    |
| Upload API    | Google Photos API              |
| Auth          | oauth2 crate for Rust          |
| Local DB      | SQLite (via rusqlite)          |
| Packaging     | Tauri Bundler                  |
| Background    | Tauri tray + auto-launch |

---

## 5. Architecture Overview
**Core Modules:**
- Media Scanner
- Upload Worker
- Persistent Store (SQLite)
- Auth Manager
- UI Renderer

*(Refer to the Component Interaction Diagram in Appendix A)*

---

## 6. Delivery Plan

| Phase | Scope                                               | Target Date |
|-------|-----------------------------------------------------|-------------|
| P1    | CLI scanner + uploader (photos/videos)              | Q2 2025     |
| P2    | Smart batching + SQLite resume logic                | Q3 2025     |
| P3    | Full GUI with pause/resume, settings                | Q4 2025     |
| P4    | Background mode + tray + notifications              | Q1 2026     |
| P5    | Windows support + installer packaging               | Q2 2026     |

-------|--------|
| P1 | CLI scanner + uploader (photos/videos) |
| P2 | Smart batching + SQLite resume logic |
| P3 | Full GUI with pause/resume, settings |
| P4 | Background mode + tray + notifications |
| P5 | Windows support + installer packaging |

---

## 7. Risks & Mitigation

| Risk                          | Probability | Impact | Mitigation                                   |
|-------------------------------|-------------|--------|----------------------------------------------|
| iCloud media unavailable      | Medium      | High   | Queue for download, warn user if space low   |
| Large video files             | Medium      | Medium | Smarter batching strategy                    |
| Token expiry                  | Low         | High   | Auto-refresh, fallback re-auth flow          |
| API quotas                    | Medium      | High   | Track usage, backoff + retry logic           |
| Upload failures               | Medium      | High   | Resumable chunks, retry limits               |
| Codec issues                  | Low         | Medium | Document compatible formats                  |

------|-------------|
| iCloud media unavailable | Queue for download, warn user if space low |
| Large video files | Smarter batching strategy |
| Token expiry | Auto-refresh, fallback re-auth flow |
| API quotas | Track usage, backoff + retry logic |
| Upload failures | Resumable chunks, retry limits |
| Codec issues | Document compatible formats |

---

## 8. Future Considerations

| Phase | Feature                                           |
|-------|---------------------------------------------------|
| P2    | Multiple Google account support                   |
| P3    | Album-specific uploads                            |
| P4    | Transcoding options for videos                    |
| P4    | Enhanced media classification                     |

---

## 9. Glossary
- **Batch:** Group of media files uploaded together
- **EXIF Data:** Embedded metadata in image files (camera, location, timestamp)
- **Resumable Upload:** Google API feature for chunked, retryable uploads
- **Rolling-Window Download Strategy:** Process cloud-only items in limited batches to minimize disk usage
- **Staging Folder:** Temporary folder for exporting media before upload
- **Tray App:** Background UI element accessible from system tray

