# HTML to PNG/JPEG Conversion Service with SSE

A Node.js service and command-line tool for converting HTML content (from local files, remote URLs, or direct HTML strings) to PNG or JPEG images, using Puppeteer for browser rendering. The service provides real-time progress updates via Server-Sent Events (SSE) and supports secure HTML file uploads.

## Features

-   **Multiple Input Sources:**
    -   Convert from local HTML files (CLI).
    -   Convert from remote URLs (Service & CLI).
    -   Convert from direct HTML content strings (Service & CLI).
    -   Secure HTML file uploads for conversion (Service API).
-   **Output Options:**
    -   PNG or JPEG format (determined by the output file extension).
    -   Configurable image quality (for JPEG).
    -   Optional full-page screenshots.
    -   Option to omit the default white background (for transparent PNGs if the page has no background).
-   **Advanced Functionality:**
    -   Split a single HTML page into multiple images based on a CSS selector.
    -   Real-time progress updates via Server-Sent Events (SSE) for API users.
-   **Modes of Operation:**
    -   HTTP API service (`server.js`).
    -   Command-line interface (`html-to-png.js`).

## Prerequisites

-   [Node.js](https://nodejs.org/) (LTS version recommended, e.g., 18.x or newer)
-   npm (usually comes with Node.js) or yarn

## Installation

1.  Clone the repository (if applicable) or download the project files.
2.  Navigate to the project directory:
    ```bash
    cd path/to/html2png
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
    (or `yarn install` if you prefer yarn)

    This will install `puppeteer`, `express`, `multer`, and other necessary packages.
    **Note:** Puppeteer's first installation will download a version of Chromium (approximately 170-250MB, depending on the OS), which might take some time. Ensure you have a stable internet connection.

## Running the HTTP Service (`server.js`)

The service provides API endpoints for initiating conversions and tracking their progress.

**To start the service:**

```bash
npm start
```
Alternatively, you can run:
```bash
node server.js
```

By default, the server listens on port `3000`. This can be configured by setting the `PORT` environment variable or by modifying `server.js`.
Upon successful startup, you will see a message like: `HTML to PNG service with SSE listening on port 3000`.
Generated images are saved to the `output_images` directory within the project root.

### API Endpoints

#### 1. `POST /convert`

This endpoint initiates an HTML to image conversion. It is designed to respond quickly by accepting the request and returning a `conversionId`, which can then be used to track the progress of the (potentially long-running) conversion via an SSE stream.

**Request Formats:**

*   **For `type: "url"` (remote URL) or `type: "html"` (direct HTML string):**
    *   `Content-Type: application/json`
    *   **Request Body Example:**
        ```json
        {
          "type": "url", // or "html"
          "input": "https://example.com", // For "html" type, this would be the HTML string
          "outputFileName": "my_image.png", // Desired output filename (e.g., image.png, page.jpeg)
          "options": { // Optional: See 'options Object Details' below
            "fullPage": true,
            "quality": 85, // Only for JPEG
            "splitSelector": ".page-section",
            "omitBackground": false,
            "waitUntil": "networkidle0",
            "timeout": 60000
          }
        }
        ```

*   **For `type: "file"` (HTML file upload):**
    *   `Content-Type: multipart/form-data`
    *   **Form Fields:**
        *   `htmlFile`: (File) The HTML file to be converted. This is a required field for `type: "file"`.
        *   `type`: (Text) The string value `"file"`. This is a required field.
        *   `outputFileName`: (Text, Optional) The desired output filename. If omitted, a name will be generated based on the uploaded file's original name (e.g., `uploaded_file.png`).
        *   `options`: (Text, Optional) A JSON string representing the conversion options. Example: `'{"fullPage": true, "quality": 75}'`. See 'options Object Details' below.

        Conceptual Data Structure for Form Fields (excluding the actual file part):
        (Note: This is a conceptual representation. The actual request is `multipart/form-data`.)
        ```json
        {
          "type": "file", // This is sent as a text form field
          "outputFileName": "my_uploaded_page.png", // This is sent as a text form field (optional)
          "options": "{\"fullPage\": true, \"quality\": 80}" // This is sent as a text form field (JSON string, optional)
          // The 'htmlFile' itself is sent as a file part in the multipart request.
        }
        ```

**`options` Object Details (Common for JSON body and multipart options string):**

*   `format` (string): Page format string like 'A4', 'Letter'. This is primarily used by Puppeteer for PDF generation but might influence the viewport for screenshots if not explicitly overridden.
*   `quality` (number): For JPEG images, an integer from 0-100 specifying the quality.
*   `fullPage` (boolean): If `true`, attempts to capture the entire scrollable page. This is ignored if `splitSelector` is provided. (Default: `false` as per Puppeteer's default, though converter class might have its own default if not set).
*   `omitBackground` (boolean): If `true`, omits the default white background. If the page's background is transparent, this can result in a PNG with a transparent background. (Default: `false`).
*   `waitUntil` (string | string[]): Defines when Puppeteer considers navigation successful. Common values include `'load'`, `'domcontentloaded'`, `'networkidle0'`, `'networkidle2'`. (Default used by converter: `'networkidle0'`).
*   `timeout` (number): Maximum navigation time in milliseconds. (Default used by converter: `90000ms`).
*   `splitSelector` (string): A CSS selector. If provided, the page will be captured in multiple images, one for each element matching the selector. If used, `fullPage` option is typically ignored for the overall page, and each selected element is captured fully.

**Success Response (`202 Accepted`):**

Indicates that the server has accepted the request for processing. The actual conversion happens asynchronously.
```json
{
  "success": true,
  "message": "轉換請求已接受，正在處理中。請使用提供的 conversionId 監聽事件。",
  "conversionId": "a1b2c3d4e5f67890abcdef1234567890", // A unique ID for this conversion task
  "eventsUrl": "/events/a1b2c3d4e5f67890abcdef1234567890" // The SSE endpoint to listen for progress
}
```

**Error Responses (Examples):**
*   `400 Bad Request`: If required fields are missing, `options` JSON is malformed, or other input validation fails.
*   `415 Unsupported Media Type`: If an incorrect `Content-Type` header is sent (e.g., sending JSON for a file upload type without `multipart/form-data`).
*   `500 Internal Server Error`: If an unexpected error occurs on the server during the conversion process.

#### 2. `GET /events/:conversionId`

This endpoint provides a stream of Server-Sent Events (SSE) for real-time progress updates of a specific conversion task.

*   **URL Parameter:**
    *   `conversionId` (string): The unique ID obtained from the `POST /convert` response.

**Event Stream Format:**

The client will receive a stream of events. Each event typically includes:
*   `id`: A unique ID for the event (often a timestamp).
*   `event`: The name of the event (e.g., `connected`, `progress`, `complete`, `error`, `warning`).
*   `data`: A JSON string containing the payload for the event.

**Event Types & Data Payloads:**

1.  **`connected`**: Sent when the SSE connection is successfully established.
    ```json
    {"message":"SSE 連接已建立","conversionId":"[conversionId]"}
    ```
2.  **`progress`**: Indicates an update in the conversion process.
    ```json
    {
      "eventName":"progress",
      "status":"launching_browser", // A code representing the current step
      "message":"正在啟動瀏覽器..." // A human-readable message
      // Additional fields like 'part', 'totalParts', 'partPath' may be present for split screenshots
    }
    ```
    *Key `status` values for progress events include (but are not limited to):*
    `conversion_started`, `launching_browser`, `opening_page`, `navigating_to_file`, `setting_content`, `navigating_to_url`, `scroll_to_load_start`, `scroll_to_load_complete`, `evaluating_split_selector`, `no_split_selector`, `split_screenshot_start` (may include `count`), `capturing_part` (may include `part`, `totalParts`, `partPath`), `part_captured` (may include `part`, `totalParts`, `partPath`), `all_parts_processed` (may include `filePaths` array), `single_screenshot_start`, `single_screenshot_captured` (may include `outputPath`), `closing_browser`.

3.  **`warning`**: Sent if a non-critical issue or warning occurs during conversion.
    ```json
    {
      "eventName":"warning",
      "status":"split_selector_error", // A code for the type of warning
      "message":"使用選擇器 "[selector]" 查找元素時出錯",
      "error":"Optional error details..."
    }
    ```

4.  **`complete`**: Sent when the conversion finishes successfully.
    *   For a single output file:
        ```json
        {
          "eventName":"complete",
          "status":"success",
          "message":"成功將 [input] 轉換為 [outputFileName]",
          "outputPath":"output_images/result.png" // Path to the generated single file
        }
        ```
    *   For multiple output files (if `splitSelector` was used):
        ```json
        {
          "eventName":"complete",
          "status":"success",
          "message":"成功將 [input] 分割轉換為多個圖片",
          "filePaths":[ // Array of paths to the generated files
            "output_images/result_part_0.png",
            "output_images/result_part_1.png"
          ]
        }
        ```

5.  **`error`**: Sent if a critical error occurs and the conversion task fails.
    ```json
    {
      "eventName":"error",
      "status":"failed",
      "message":"轉換過程中發生錯誤",
      "error":"Detailed error message or stack trace"
    }
    ```

**Client-Side SSE Example (JavaScript using `EventSource`):**
```javascript
const conversionId = 'YOUR_CONVERSION_ID'; // Replace with the ID from POST /convert
const eventSource = new EventSource(`/events/${conversionId}`);

eventSource.onopen = function() {
    console.log("SSE Connection opened for " + conversionId);
};

eventSource.addEventListener('progress', function(event) {
    const data = JSON.parse(event.data);
    console.log('Progress Update:', data.message, data);
    // Example: Update a progress bar or status message on your UI
});

eventSource.addEventListener('warning', function(event) {
    const data = JSON.parse(event.data);
    console.warn('Warning Received:', data.message, data);
});

eventSource.addEventListener('complete', function(event) {
    const data = JSON.parse(event.data);
    console.log('Conversion Complete!', data);
    if (data.outputPath) {
        console.log('Image saved to:', data.outputPath);
    }
    if (data.filePaths) {
        console.log('Images saved to:', data.filePaths.join(', '));
    }
    eventSource.close(); // Important to close after completion
});

eventSource.addEventListener('error', function(event) {
    const data = JSON.parse(event.data);
    console.error('Conversion Failed:', data.message, data.error);
    eventSource.close(); // Important to close on error
});

eventSource.onerror = function(err) {
    console.error("EventSource encountered an error:", err);
    eventSource.close(); // Close on general EventSource errors too
};
```

## Command-Line Tool (`html-to-png.js`)

The `html-to-png.js` script can also be run directly from the command line for simple conversions without needing the HTTP server.

**Basic Usage:**

```bash
node html-to-png.js <command> <input_source> [options]
```

**Commands:**

*   `file <input.html>`: Converts a local HTML file.
    *   Example: `node html-to-png.js file ./mypage.html -o mypage_image.png`
*   `url <URL>`: Converts a remote webpage.
    *   Example: `node html-to-png.js url "https://example.com" -o example_snapshot.png`
*   `html <file_containing_html.html>`: Reads HTML content from a local file and converts it as an HTML string.
    *   Example: `node html-to-png.js html ./my_raw_html.html -o raw_output.png`

**Common Options:**

*   `-o, --output <path>`: Specifies the output file path. The extension (`.png` or `.jpeg`/`.jpg`) determines the format. (Default: `output.png`)
*   `--full-page`: Instructs Puppeteer to capture the entire scrollable page.
*   `--omit-background`: Makes the background transparent if the page has no background color (useful for PNGs).
*   `-q, --quality <number>`: Sets the quality for JPEG images (an integer between 0 and 100).
*   `-s <CSS_selector>`: A CSS selector used to split the screenshot into multiple files. Each element matching the selector will be saved as a separate image (e.g., `_part_0.png`, `_part_1.png`, etc., appended to the base output name).
*   `-f, --format <format_string>`: Page format string (e.g., 'A4', 'Letter').
*   `-h, --help`: Displays detailed help information and all available options.

**Examples:**

```bash
# Convert a local HTML file to a full-page PNG
node html-to-png.js file input.html -o output.png --full-page

# Convert a URL to a JPEG image with 80% quality
node html-to-png.js url "https://www.google.com" -o google.jpeg -q 80

# Convert a local HTML file and split the output based on elements with class "page-container"
node html-to-png.js file content.html -o content_pages.png -s ".page-container"
```
For a comprehensive list of all CLI options and their descriptions, run:
```bash
node html-to-png.js --help
```

## Key Dependencies

This project relies on several key Node.js packages:

-   **Puppeteer**: Used for headless browsing with Chrome/Chromium to render HTML content accurately.
-   **Express**: A web application framework for Node.js, used here to build the HTTP API server.
-   **Multer**: A middleware for handling `multipart/form-data`, primarily used for processing HTML file uploads in the service.

## Important Notes & Considerations

-   **Chromium Download**: As mentioned, Puppeteer downloads a compatible version of Chromium during the first `npm install`. This requires an internet connection and can take some time.
-   **Resource Usage**: Running a headless browser instance via Puppeteer can be resource-intensive (CPU and memory). For high-concurrency scenarios with the HTTP service, consider implementing request queuing, rate limiting, or managing a pool of browser instances to optimize performance and stability.
-   **File Uploads (Service)**:
    -   The HTTP service restricts uploaded HTML files to a maximum size (default is 10MB, configurable in `server.js`).
    -   Only files with `.html` or `.htm` extensions (or `text/html` mimetype) are accepted for upload by default (configurable in `server.js`).
-   **Security (URL & HTML String Inputs)**: When exposing the HTTP service publicly, especially the endpoints that accept URLs or direct HTML strings, be cautious about potential security risks. These include:
    -   Server-Side Request Forgery (SSRF) if arbitrary URLs can be processed.
    -   Resource exhaustion if overly complex or malicious HTML/JavaScript is submitted.
    -   Consider implementing input validation, sanitization, domain whitelisting for URLs, or sandboxing for HTML content if the service is internet-facing.
-   **Output Directory**: All images generated by the service, or by the CLI if no specific output path outside this directory is given, are saved into the `