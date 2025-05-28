# html2png-mcp

> GitHub: [https://github.com/witmeng/html2png](https://github.com/witmeng/html2png)  
> npm: `npm i html2png-mcp`

## Project Overview

`html2png-mcp` is a server-side tool based on the MCP (Model Context Protocol) standard. It supports batch rendering of HTML pages, URLs, or base64 file content into PNG images. It features page splitting, command-line batch processing, and is suitable for LLM applications, automated testing, content archiving, and more.

---

## Key Features

- **MCP Server Standard**: Can be launched as an MCP Stdio Server, supporting integration with AI Agents, LLMs, and other upstream/downstream systems.
- **Multiple Input Types**: Supports URL, HTML string, and base64 file content.
- **Page Splitting**: Automatically splits a single HTML page into multiple images using a CSS selector.
- **Batch Processing**: Supports batch conversion of multiple pages or files.
- **Detailed Logs and Progress Notifications**.

---

## Installation & Startup

1. Install dependencies

   ```bash
   npm install
   ```

2. Build the project

   ```bash
   npm run build
   ```

3. Start the MCP Server

   ```bash
   npm start
   ```
   Or run directly:
   ```bash
   node dist/mcp-stdio-server.js
   ```

   > **Note**: By default, the service runs as an MCP Stdio Server, suitable for clients supporting the MCP protocol.

---

## Usage as an MCP Server

- **Protocol**: This service is implemented based on [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) and supports MCP tool invocation.
- **Input Parameters** (JSON example):

  ```json
  {
    "type": "html",
    "input": "<html>...</html>",
    "outputFileName": "result.png",
    "options": {
      "splitSelector": ".page-container"
    }
  }
  ```

- **Parameter Description**:
  - `type`: Input type, supports `url`, `html`, `base64`
  - `input`: HTML string, URL, or base64 content
  - `outputFileName`: Output file name (optional)
  - `options`: Advanced options (e.g., splitting, image quality, etc.)

---

## Page Splitting

### Automatically Split a Single HTML into Multiple Images

- **Scenario**: When an HTML page contains multiple "page containers" (e.g., e-books, slides, long documents), the tool can automatically detect and capture each as a separate image.
- **Usage**:
  - Add a common CSS class (e.g., `.page-container`) to each page section in your HTML:
    ```html
    <div class="page-container">Page 1 content</div>
    <div class="page-container">Page 2 content</div>
    ```
  - Specify the `splitSelector` parameter when calling:
    ```json
    {
      "type": "html",
      "input": "<html>...</html>",
      "outputFileName": "result.png",
      "options": {
        "splitSelector": ".page-container"
      }
    }
    ```
  - Result: Outputs `result_part_0.png`, `result_part_1.png`, etc., each corresponding to a page container.

- **Default Behavior**: If `splitSelector` is not specified, `.page-container` is used by default. You can customize the selector as needed.

---

## OSS Cloud Storage Auto Upload

> Currently, only Aliyun OSS (Aliyun Object Storage Service) is supported.

This tool supports **automatically uploading generated PNG images to Aliyun OSS** and returns the public URLs.

### OSS Configuration

Set the following environment variables before running:

- `ALI_OSS_REGION`: OSS region (e.g., `oss-cn-shanghai`)
- `ALI_OSS_KEY`: OSS AccessKeyId
- `ALI_OSS_SECRET`: OSS AccessKeySecret
- `ALI_OSS_BUCKET`: OSS bucket name
- `ALI_OSS_ENDPOINT`: OSS endpoint (optional, can be auto-detected)
- `OSS_EXPECTED_BASE_URL`: Public URL prefix for images (e.g., `https://your-bucket.oss-cn-shanghai.aliyuncs.com`, optional)

### Output Example

After each conversion, the result will include an `ossUrls` field listing all public URLs of the uploaded images:

```json
{
  "outputPaths": ["output_images/result_part_0.png", "output_images/result_part_1.png"],
  "ossUrls": [
    "https://your-bucket.oss-cn-shanghai.aliyuncs.com/html2png/20240528/result_part_0.png",
    "https://your-bucket.oss-cn-shanghai.aliyuncs.com/html2png/20240528/result_part_1.png"
  ]
}
```

### Notes

- If OSS environment variables are not set, only local images are generated and no upload occurs.
- Upload failures are logged in `mcp_logs/`.

---

## Command-Line Batch Conversion (for development/debugging)

```bash
node dist/html-to-png.js file test_html/index.html -o output_images/index.png -s .page-container
```

- `-s` or `--split-selector`: Specify the CSS selector for splitting

---

## Directory Structure

```
.
├── dist/              # Compiled JS files
├── src/               # TypeScript source code
├── output_images/     # PNG output directory
├── test_html/         # Test HTML files
├── mcp_logs/          # Logs
├── package.json
└── README.md
```

---

## FAQ

- **How to customize splitting?**  
  Change `splitSelector` (e.g., `.slide`, `.page`, etc.) and ensure your HTML structure contains the corresponding elements.

- **How to connect to the MCP Server?**  
  Refer to [typescript-sdk/README.md](./typescript-sdk/README.md) or the official MCP documentation. Use an MCP-compatible client to connect to this service.

---

## License

MIT License

---

For more detailed API or integration instructions, please refer to the source code comments or contact the author.

---

**Support/Business Contact: myspsp@gmail.com** 