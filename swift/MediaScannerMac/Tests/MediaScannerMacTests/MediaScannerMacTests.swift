import XCTest
@testable import MediaScannerMac // Import your module to test its internals

final class MediaScannerMacTests: XCTestCase {

    // Test encoding and decoding of the MediaItem struct
    func testMediaItemCodable() throws {
        // 1. Create a sample Date
        // Use components to ensure consistency across timezones for the test
        let components = DateComponents(year: 2024, month: 4, day: 20, hour: 10, minute: 30, second: 0, nanosecond: 123_000_000)
        let calendar = Calendar(identifier: .iso8601)
        guard let sampleDate = calendar.date(from: components) else {
            XCTFail("Failed to create sample date")
            return
        }

        // 2. Create a sample MediaItem
        let sampleItem = MediaItem(
            localIdentifier: "ABCDEFGH-1234-5678-90AB-CDEFGHIJKL",
            originalPath: nil,
            originalFilename: "IMG_0001.JPG",
            uti: "public.jpeg",
            creationDate: sampleDate,
            modificationDate: sampleDate,
            sizeBytes: 1_234_567,
            pixelWidth: 4032,
            pixelHeight: 3024,
            isInCloud: false,
            mediaType: "photo",
            durationSeconds: nil, 
            codec: nil
        )

        // 3. Encode the sample item to JSON data
        let encoder = JSONEncoder()
        // Match main code's date strategy
        let encodingDateFormatter = DateFormatter()
        encodingDateFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ"
        encodingDateFormatter.locale = Locale(identifier: "en_US_POSIX")
        encodingDateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
        encoder.dateEncodingStrategy = .formatted(encodingDateFormatter)
        // Match main code's output formatting 
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys] 
        
        let jsonData = try encoder.encode(sampleItem)

        // 4. Decode the JSON data back into a MediaItem
        // IMPORTANT: Use the *exact same* date formatter settings as the main code for decoding
        let decoder = JSONDecoder()
        let decodingDateFormatter = DateFormatter()
        decodingDateFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ"
        decodingDateFormatter.locale = Locale(identifier: "en_US_POSIX")
        decodingDateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
        decoder.dateDecodingStrategy = .formatted(decodingDateFormatter)
        
        let decodedItem = try decoder.decode(MediaItem.self, from: jsonData)

        // 5. Assert that the decoded item matches the original
        XCTAssertEqual(decodedItem.localIdentifier, sampleItem.localIdentifier)
        XCTAssertEqual(decodedItem.originalFilename, sampleItem.originalFilename)
        XCTAssertEqual(decodedItem.uti, sampleItem.uti)
        XCTAssertEqual(decodedItem.sizeBytes, sampleItem.sizeBytes)
        XCTAssertEqual(decodedItem.pixelWidth, sampleItem.pixelWidth)
        XCTAssertEqual(decodedItem.pixelHeight, sampleItem.pixelHeight)
        XCTAssertEqual(decodedItem.isInCloud, sampleItem.isInCloud)
        XCTAssertEqual(decodedItem.mediaType, sampleItem.mediaType)
        XCTAssertEqual(decodedItem.durationSeconds, sampleItem.durationSeconds)
        XCTAssertEqual(decodedItem.codec, sampleItem.codec)

        // Special check for date equality
        // Direct equality can fail due to floating-point precision issues after encoding/decoding.
        // Compare time intervals with a small tolerance instead.
        let tolerance = 0.001 // Allow for millisecond differences
        if let decodedCreationDate = decodedItem.creationDate, let sampleCreationDate = sampleItem.creationDate {
            XCTAssertEqual(decodedCreationDate.timeIntervalSinceReferenceDate, 
                           sampleCreationDate.timeIntervalSinceReferenceDate, 
                           accuracy: tolerance, 
                           "Decoded creation date should match sample creation date within tolerance")
        } else {
            XCTAssertEqual(decodedItem.creationDate, sampleItem.creationDate, "Creation dates should both be nil or non-nil")
        }
        
        if let decodedModDate = decodedItem.modificationDate, let sampleModDate = sampleItem.modificationDate {
             XCTAssertEqual(decodedModDate.timeIntervalSinceReferenceDate, 
                            sampleModDate.timeIntervalSinceReferenceDate, 
                            accuracy: tolerance, 
                            "Decoded modification date should match sample modification date within tolerance")
        } else {
             XCTAssertEqual(decodedItem.modificationDate, sampleItem.modificationDate, "Modification dates should both be nil or non-nil")
        }
    }

    // Add more test functions here to test specific parts of your code.
    // func testJsonOutputStructure() throws { ... }
    // func testDateEncoding() throws { ... }
} 