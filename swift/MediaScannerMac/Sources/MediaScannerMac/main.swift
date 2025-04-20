import Foundation
import Photos

// Define the structure for the JSON output
struct MediaItem: Codable {
    let localIdentifier: String // Added localIdentifier, useful for later export task
    let originalPath: String? // Path if available locally (might be nil for iCloud)
    let originalFilename: String?
    let uti: String? // Uniform Type Identifier (e.g., public.jpeg)
    let creationDate: Date?
    let modificationDate: Date?
    let sizeBytes: Int64? // Use Int64 for potentially large files
    let pixelWidth: Int?
    let pixelHeight: Int?
    let isInCloud: Bool
    let mediaType: String // "photo" or "video"
    let durationSeconds: Double? // For videos
    // Placeholder for codec, might require AVFoundation
    let codec: String? // Removed `= nil` to avoid Codable warning for now
}

// Function to process a single PHAsset into a MediaItem
func processAsset(_ asset: PHAsset) -> MediaItem {
    let mediaTypeString = asset.mediaType == .video ? "video" : "photo"
    let duration = asset.mediaType == .video ? asset.duration : nil

    // Get asset resources to find filename, UTI, size, etc.
    let resources = PHAssetResource.assetResources(for: asset)
    
    // Try to find the primary resource (photo/video data)
    // Prioritize original/full size if possible
    let primaryResource = resources.first { res in 
        (asset.mediaType == .image && (res.type == .photo || res.type == .fullSizePhoto)) || 
        (asset.mediaType == .video && (res.type == .video || res.type == .fullSizeVideo))
    } ?? resources.first // Fallback to the first resource if specific type not found

    var sizeBytes: Int64? = nil
    var uti: String? = nil
    var originalFilename: String? = nil
    let isInCloud = true // Assume in cloud unless we find a locally available resource

    if let resource = primaryResource {
         originalFilename = resource.originalFilename
         uti = resource.uniformTypeIdentifier
         // Check if resource indicates local availability
         // Note: This might not be perfectly reliable for "is it fully downloaded?"
         // Size might require explicit data request later, but try valueForKey
         if let fileSize = resource.value(forKey: "fileSize") as? NSNumber {
              sizeBytes = fileSize.int64Value
         }

         // More robust check might involve PHImageManager or PHAssetResourceManager later
         // For now, let's assume if we have *a* resource, something exists locally or remotely.
         // A more direct check isn't readily available on PHAssetResource itself.
         // We will refine isInCloud detection later if needed.
          // isInCloud = !resource.locallyAvailable // TEMPORARY: Commented out, needs better check
          // For now, assume true unless proven otherwise later
          // isInCloud = !(resource.value(forKey: "isLocallyAvailable") as? Bool ?? false)
    } else {
         fputs("Warning: Could not find primary resource for asset \(asset.localIdentifier)\n", stderr)
    }
   
    // Correctly handle potential nil pixelWidth/Height
    let pixelWidth = asset.pixelWidth == 0 ? nil : asset.pixelWidth
    let pixelHeight = asset.pixelHeight == 0 ? nil : asset.pixelHeight

    return MediaItem(
        localIdentifier: asset.localIdentifier,
        originalPath: nil, // Path is generally not directly accessible
        originalFilename: originalFilename,
        uti: uti,
        creationDate: asset.creationDate,
        modificationDate: asset.modificationDate,
        sizeBytes: sizeBytes,
        pixelWidth: pixelWidth,
        pixelHeight: pixelHeight,
        isInCloud: isInCloud, // Need a reliable way to determine this
        mediaType: mediaTypeString,
        durationSeconds: duration,
        codec: nil // Explicitly nil here as it's not populated
    )
}

// Function to fetch and print media items
func fetchMediaItems() {
    let fetchOptions = PHFetchOptions()
    // fetchOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
    // fetchOptions.includeAssetSourceTypes = [.typeUserLibrary, .typeCloudShared, .typeiTunesSynced] // Be specific if needed
    
    let allMediaAssets = PHAsset.fetchAssets(with: fetchOptions)
    var results: [MediaItem] = [] // Array to hold results
    results.reserveCapacity(allMediaAssets.count)
    
    fputs("Starting media scan. Found \(allMediaAssets.count) assets...\n", stderr)

    // Use the extracted processing function
    allMediaAssets.enumerateObjects { (asset, index, stop) in
        let item = processAsset(asset)
        results.append(item)
        
        // Log progress to stderr periodically
        if (index + 1) % 100 == 0 {
             fputs("Processed \(index + 1)/\(allMediaAssets.count) assets...\n", stderr)
        }
    }
    
    fputs("Finished processing assets. Encoding JSON...\n", stderr)

    // Encode the entire array at the end
    let jsonEncoder = JSONEncoder()
    
    // Configure a specific date formatter to ensure fractional seconds are included
    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ" // ISO 8601 format with fractional seconds and timezone
    dateFormatter.locale = Locale(identifier: "en_US_POSIX") // Essential for consistent ISO 8601 parsing/formatting
    dateFormatter.timeZone = TimeZone(secondsFromGMT: 0) // Use UTC (Zulu time)
    
    jsonEncoder.dateEncodingStrategy = .formatted(dateFormatter)

    // Use compact output for efficiency when piping to Node.js
    // Output formatting set to sorted keys for deterministic output, easier for testing/diffing
    jsonEncoder.outputFormatting = [.prettyPrinted, .sortedKeys] // Use prettyPrinted for readability during debug, remove later for pure efficiency
    
    do {
        let jsonData = try jsonEncoder.encode(results)
        if let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString) // Print the complete JSON array string
             fputs("Successfully encoded and printed JSON output.\n", stderr)
            exit(0) // Exit successfully
        } else {
            fputs("Error: Failed to convert final JSON data to string.\n", stderr)
            exit(1)
        }
    } catch {
        fputs("Error encoding final JSON array: \(error)\n", stderr)
        exit(1)
    }
}

// --- Main Execution --- 

// Check authorization status
let status = PHPhotoLibrary.authorizationStatus(for: .readWrite) // Request readWrite for future export needs

switch status {
case .authorized, .limited: // Handle limited access if applicable
    // Access is granted
    if status == .limited {
        fputs("Warning: Limited photo library access granted.\n", stderr)
    }
    fetchMediaItems()
case .notDetermined:
    // Request authorization
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { newStatus in
        if newStatus == .authorized || newStatus == .limited {
            DispatchQueue.main.async { // Ensure fetch is on main thread if needed by Photos API
                 fetchMediaItems()
            }
        } else {
            fputs("Error: Photo library access denied.\n", stderr)
            exit(1) // Exit with error code
        }
    }
case .denied, .restricted:
    // Access denied or restricted
    fputs("Error: Photo library access denied or restricted.\n", stderr)
    exit(1) // Exit with error code
@unknown default:
    fputs("Error: Unknown photo library authorization status.\n", stderr)
    exit(1)
}

// Keep the script running until the async authorization callback completes
// This is needed because requestAuthorization is async.
RunLoop.main.run() 