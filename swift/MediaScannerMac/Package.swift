// swift-tools-version:6.1
import PackageDescription

let package = Package(
    name: "MediaScannerMac",
    platforms: [
        .macOS(.v12) // Requires macOS 12 or later for Photos framework access used
    ],
    targets: [
        // Target for the executable command-line tool
        .executableTarget(
            name: "MediaScannerMac",
            path: "Sources" // Assuming source code is in Sources/
            // No external dependencies needed for basic Photos access
        ),
        // Test target
        .testTarget(
            name: "MediaScannerMacTests",
            dependencies: ["MediaScannerMac"])
    ]
) 