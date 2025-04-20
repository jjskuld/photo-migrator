# Photo Migrator
*(Cross-Platform Apple Photos to Google Photos Uploader)*

## Overview

Photo Migrator is a desktop application designed to reliably and efficiently upload your entire Apple Photos library (from macOS) or your iCloud Photos download folder (from Windows) directly to Google Photos. It focuses on preserving metadata, managing system resources effectively, and providing a seamless user experience for migrating large photo collections.

## Key Features

*   **Cross-Platform:** Runs natively on both macOS and Windows.
*   **Metadata Preservation:** Aims to keep original filenames, creation dates, and other available metadata intact during the upload.
*   **Google Photos Integration:** Uses the official Google Photos API for uploading.
*   **Resource Management:** Includes features for smart batching, disk space monitoring, and network awareness (e.g., WiFi-only mode).
*   **Resumable & Robust:** Designed to handle interruptions, retries, and potential duplicates.
*   **Background Operation:** Can run in the background via a system tray icon.
*   **User Interface:** Built with Electron and React for a modern desktop experience, showing progress and allowing user control (Pause/Resume/Cancel).
*   **Secure:** Handles Google OAuth tokens securely using system keychains/credential managers.

## Technology Stack (Planned)

*   **Framework:** Electron
*   **UI:** React, Tailwind CSS
*   **Backend Logic:** Node.js, TypeScript
*   **macOS File Access:** Native Swift helper tool
*   **Database:** SQLite
*   **Authentication:** Google OAuth 2.0

## Current Status

Project setup and initial documentation phase complete. Core development is underway.

## Getting Started

_(Instructions will be added once the application is buildable)_

## Contributing

_(Contribution guidelines will be added later)_

## License

_(License information to be determined)_ 