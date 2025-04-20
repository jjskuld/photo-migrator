# Testing Strategy Document

## Project Name
**Photo Migrator**
*(Cross-Platform Apple Photos to Google Photos Uploader)*

## Objective
Define a comprehensive testing strategy to ensure the application is reliable, secure, performant, and user-friendly. Testing will span unit, integration, E2E, manual QA, and platform-specific behavior.

---

## 1. Test Levels and Scope

### 1.1 Unit Testing
**Goal:** Validate individual functions and modules in isolation.

**Tools:**
- `Vitest` or `Jest` for logic tests
- `Sinon` or `vi.fn()` for mocking

**Target Modules:**
- `Uploader`
- `BatchPlanner`
- `DiskMonitor`
- `NetworkMonitor`
- `SettingsManager`
- `Logger`
- `AuthManager`
- `DuplicateDetection`
- `MediaScanner`

**Example Tests:**
- Retry logic caps after configured attempts
- Disk usage estimate matches real size of files
- SHA256 and visual hash calculation correctness
- Metadata extraction returns correct creation date, camera info, and GPS
- Original filename is preserved or accurately reconstructed during scan

---

### 1.2 Integration Testing
**Goal:** Validate interactions between key modules.

**Tools:**
- Node test runner + `supertest`
- SQLite in-memory database

**Target Scenarios:**
- `BatchPlanner` → `Uploader` → `SQLiteStore`
- `AuthManager` → token refresh → `Uploader`
- `MediaScanner` + SwiftBridge → temp export folder
- SwiftBridge input/output mocking via child process stdout

**Mocking:**
- Simulate network conditions (offline, slow WiFi)
- Fake Google Photos API (stub endpoints)
- Simulated iCloud photo files with controlled EXIF and filename metadata

---

### 1.3 End-to-End (E2E) Testing
**Goal:** Ensure full app workflows work as expected.

**Tools:**
- `Playwright` or `Spectron` for Electron
- `Mock Service Worker` (MSW) for fake API responses

**Test Cases:**
- Launch app → Login → Scan photos → Upload batch → Confirm completion
- Resume after reboot
- Change settings mid-upload and verify they apply
- Trigger iCloud download wait → confirm countdown + retry
- Metadata and filename accuracy from scan → upload validation end-to-end

**Electron-Specific:**
- Tray icon behavior on macOS and Windows
- Secure preload script context (no nodeIntegration)
- Auto-launch on boot working as expected

---

### 1.4 Manual QA
**Platforms:**
- macOS (Intel + Apple Silicon)
- Windows 10/11 (x64)

**Checklist:**
- Install, login, upload media
- Change network states (WiFi/ethernet/offline)
- Low disk space scenario
- OAuth token expiration → re-authentication prompt
- Visual duplicate warning workflow
- Tray icon menu behaviors
- Confirm original filenames and EXIF metadata are retained in uploaded files via Google Photos UI

---

### 1.5 Performance Testing
**Goal:** Measure responsiveness, memory usage, disk IO

**Tools:**
- `clinic.js`, `Chrome DevTools`, Activity Monitor, Task Manager

**Tests:**
- Memory footprint during 1000 file batch
- Upload throughput under throttled bandwidth
- Export + upload + cleanup timings

---

### 1.6 Accessibility & UX Testing
**Goal:** Confirm app is usable with keyboard, screen readers, and light/dark modes.

**Tools:**
- `axe-core` for a11y audit
- Manual keyboard navigation check

**Checks:**
- All controls accessible via Tab/Shift+Tab
- Proper labels for assistive tech
- High contrast and dark mode visibility

---

### 1.7 Regression Testing
**Goal:** Prevent previously fixed bugs from returning.

**Strategy:**
- Maintain a suite of regression tests based on past bugs
- Auto-run them on every commit to main

**Tools:**
- GitHub Actions CI + caching for test runners

---

### 1.8 Code Coverage
**Goal:** Ensure tests cover meaningful execution paths.

**Tools:**
- `c8` or `vitest --coverage`

**Recommendations:**
- Track coverage per module
- Focus on logic-heavy areas (Uploader, BatchPlanner)
- Avoid coverage-for-coverage's-sake; prioritize meaningful paths

**Coverage Goals:**
| Layer | Goal |
|-------|------|
| Core Modules | 90%+ |
| Integrations | 80%+ |
| E2E | 10 key flows validated |
| Manual QA | 100% critical user flows |

---

## 2. CI/CD Integration

**Goal:** Automate build, test, and packaging with every push.

**Tools:**
- GitHub Actions

**Workflows:**
- `test.yml`: Run unit/integration tests on every PR
- `build-release.yml`: Trigger build + test + sign on tag push
- Linting + type checks with ESLint + TypeScript strict mode

---

## 3. Test Data and Fixtures

**Needs:**
- Sample media files (JPEG, HEIC, MP4)
- Corrupted files for failure testing
- Large fake datasets to simulate 2TB library
- Files with diverse EXIF data, timezone, camera info, and file renaming patterns
- Mock stdout logs from SwiftBridge for simulation
- Mock SQLite DB dumps for state rehydration

**Storage:**
- Versioned test fixtures folder under `/__tests__/fixtures`
- Git LFS or cloud link for large files

---

## 4. Mock vs Live API Testing

**Strategy:**
- Use mock servers (MSW) for unit/integration and CI testing
- Reserve live API integration for pre-release QA
- Track quota usage and token expiration behavior with rate-limited real test accounts

---

## 5. Bug Reporting Process
- Bug reported via GitHub Issues or internal tracker
- Include logs, screenshots, and replication steps
- Add failing test if reproducible

---

## 6. Future Considerations
- Cross-locale testing (i18n/l10n)
- Beta tester telemetry analysis (opt-in)
- Automated Apple Photos export validation suite
- Visual regression testing using Playwright screenshot diffing or Percy

---

## 7. Summary
This finalized testing strategy ensures robust quality coverage across unit logic, integrations, third-party APIs, and real-user workflows. It includes platform-specific checks, metadata validation, visual/duplicate fingerprinting, SwiftBridge coverage, and progressive CI integration. Code coverage tracking is built-in to enforce test discipline while prioritizing meaningful execution paths.

