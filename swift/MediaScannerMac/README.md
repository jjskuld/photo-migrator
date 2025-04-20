# MediaScannerMac Swift Tool

This command-line tool is part of the Photo Migrator project. It runs on macOS and uses the `Photos.framework` to access the system Photo Library and extract metadata for media items (photos and videos).

## Building

1.  **Navigate to the Directory:**
    Open your terminal and change to this tool's directory:
    ```bash
    cd path/to/photo-migrator/swift/MediaScannerMac
    ```

2.  **Build the Executable:**
    Use the Swift Package Manager (SPM) to build the optimized release version:
    ```bash
    swift build -c release
    ```
    This command compiles the Swift code and links necessary frameworks.

3.  **Locate the Binary:**
    The compiled executable will be placed in the `.build` directory, likely under an architecture-specific path on Apple Silicon.
    Example path on Apple Silicon:
    `.build/arm64-apple-macosx/release/MediaScannerMac`

## Placement for Node.js Application

The main Node.js application expects to find the compiled `MediaScannerMac` executable in a specific location relative to the project root.

1.  **Create `bin` Directory (if needed):**
    Ensure a `bin` directory exists at the root of the `photo-migrator` project.
    From the `swift/MediaScannerMac` directory, you can run:
    ```bash
    mkdir -p ../../bin 
    ```

2.  **Copy the Executable:**
    Copy the built binary from the `.build` directory to the project's `bin` directory. Adjust the source path based on your architecture.
    Example for Apple Silicon:
    ```bash
    cp .build/arm64-apple-macosx/release/MediaScannerMac ../../bin/
    ```

Now the Node.js application (specifically the `MediaScanner` module) will be able to find and execute `./bin/MediaScannerMac`.

**Note:** This build and copy process will need to be performed whenever the Swift code is updated. It could potentially be integrated into a build script for the main application later. 