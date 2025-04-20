# Google Photos API Integration Specification

## Purpose
This document outlines how the uploader application integrates with the Google Photos API for both photos and videos, including endpoints, authentication, error handling, and quota management.

---

## 1. OAuth2 Authentication

### Scopes Required
- `https://www.googleapis.com/auth/photoslibrary.appendonly`
  - Allows the app to upload media items to the user's library but not read or modify existing content.

### OAuth Flow
1. Open browser for consent screen
2. Redirect to `urn:ietf:wg:oauth:2.0:oob` or a localhost callback handler
3. Store `access_token` and `refresh_token` securely using:
   - macOS: Keychain
   - Windows: Credential Manager

### Token Refresh
- Use `refresh_token` to get a new access token when the current one expires (every 3600 seconds).
- Refresh in the background before expiry.

---

## 2. Upload Process

### Step 1: Upload Bytes (Resumable Upload)
**Endpoint:** `https://photoslibrary.googleapis.com/v1/uploads`

**Headers:**
- `Authorization: Bearer <ACCESS_TOKEN>`
- `Content-type: application/octet-stream`
- `X-Goog-Upload-File-Name: <filename>`
- `X-Goog-Upload-Protocol: raw`
- For large video files: `X-Goog-Upload-Content-Length: <file_size_bytes>`

**Response:** Upload Token (string)

**Video-specific considerations:**
- For videos over 150MB, use the resumable upload protocol with chunks
- Set additional headers:
  - `X-Goog-Upload-Command: start`
  - `X-Goog-Upload-Content-Length: <total_size>`
- For subsequent chunks:
  - `X-Goog-Upload-Command: upload`
  - `X-Goog-Upload-Offset: <current_offset>`
- For final chunk:
  - `X-Goog-Upload-Command: upload, finalize`

### Step 2: Create Media Item
**Endpoint:** `https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate`

**Request Body:**
```json
{
  "newMediaItems": [
    {
      "description": "<optional>",
      "simpleMediaItem": {
        "uploadToken": "<upload_token>"
      }
    }
  ]
}
```

**Response:**
- `mediaItemResults`: Contains status and new media item ID if successful
- `error.status`, `error.message` for each failed item

---

## 3. Error Handling

### Upload Failures (Step 1)
- 401 Unauthorized → Refresh token and retry
- 429 Too Many Requests → Backoff + retry
- 5xx Errors → Retry with exponential backoff (max 5 times)
- For videos: handle connection timeouts with proper resume functionality

### Create Media Item Failures (Step 2)
- Status codes inside response array
- Common failure: `invalid uploadToken` (re-upload file)
- Log and retry items that fail, up to `retryLimit`

---

## 4. Rate Limits and Quotas

### Daily Quotas (default for unverified apps)
- 10,000 uploads/day per user
- 300 write requests/minute/user

### Monitoring
- Track number of uploaded items
- Display warning when user approaches quota

---

## 5. Duplicate Detection Strategy
Google Photos does not reject duplicates automatically. Our app uses client-side fingerprinting:
- **Exact match:** SHA256 of file bytes
- **Fuzzy match:** Visual hash + pixel dimensions
- **Policy:**
  - If exact match found, skip
  - If visual match, warn user or auto-skip based on config

---

## 6. Media Types and Restrictions
- Supported images: JPEG, PNG, HEIC, WebP, GIF
- Supported videos: MP4, MOV, MPEG, MKV, AVI, WebM
- Max file size: 200MB for images, 10GB for videos (with chunked upload)
- Upload fails for unsupported formats — app logs and skips these
- Video codecs supported: H.264, H.265, VP8, VP9
- Video considerations:
  - Check codec compatibility before upload attempt
  - Calculate and track upload time estimates for large videos
  - Handle uploads that may take hours for very large files

---

## 7. Security Considerations
- All tokens stored using system secure storage
- Logs do not include tokens, user IDs, or personal filenames
- App requests minimal API scope
- For videos, verify file integrity before and after upload using checksums

---

## 8. Future Enhancements
- Upload to specific albums
- Support `description` metadata
- Upload ordering by timestamp
- Video-specific enhancements:
  - Transcoding options for incompatible videos
  - Thumbnail generation for video preview
  - Custom cover frame selection

