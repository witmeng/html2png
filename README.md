# HTML 到 PNG 轉換服務

一個 Node.js 服務，用於將 HTML 內容（來自文件、URL 或直接的 HTML 字符串）轉換為 PNG 或 JPEG 圖片。它使用 Puppeteer 進行瀏覽器渲染。

## 特性

- 支持從本地 HTML 文件轉換。
- 支持從指定的 URL 轉換。
- 支持直接從 HTML 內容字符串轉換。
- 可選全頁截圖。
- 可配置圖片質量 (JPEG)。
- 可選忽略背景。
- 可配置頁面加載等待條件和超時時間。
- 支持根據 CSS 選擇器將單個 HTML 頁面分割截取為多個圖片。
- 提供 HTTP API 接口進行轉換。

## 先決條件

- [Node.js](https://nodejs.org/) (推薦 LTS 版本)
- npm (通常隨 Node.js 一起安裝) 或 [yarn](https://yarnpkg.com/)

## 安裝

1.  確保您已安裝 Node.js 和 npm/yarn。
2.  進入 `tools/html2png` 目錄：
    ```bash
    cd path/to/your_project/tools/html2png
    ```
3.  安裝項目依賴：
    ```bash
    npm install
    # 或者
    # yarn install
    ```
    這將安裝 `puppeteer` (用於核心轉換) 和 `express` (用於 HTTP 服務) 等必要的包。

    **注意**: Puppeteer 首次安裝時會嘗試下載一個綁定版本的 Chromium (約 170-250MB，取決於操作系統)，這可能需要一些時間。

## 運行服務

要啟動 HTML 到 PNG 轉換服務：

```bash
node server.js
```

默認情況下，服務器將在端口 `3000` 上啟動。您可以修改 `server.js` 文件中的端口號。

服務器啟動成功後，您會看到類似以下的日誌：
`HTML to PNG service listening on port 3000`

## API 端點

### `POST /convert`

此端點用於觸發 HTML 到圖片的轉換。

**請求體 (Request Body)**: `application/json`

```json
{
  "type": "file", // 必填: 'file', 'html', 或 'url'
  "input": "./path/to/your/input.html", // 必填: 根據 type 不同，可以是文件路徑、HTML字符串或URL
  "outputFileName": "result.png", // 必填: 輸出的基礎文件名 (擴展名決定格式 .png 或 .jpeg)
  "options": { // 可選: 轉換選項
    "format": "A4", // 傳遞給 Puppeteer page.pdf() 的格式，主要用於PDF，截圖時可能影響視口
    "quality": 80, // 0-100, 僅適用於 JPEG 格式
    "fullPage": true, // 是否截取完整頁面
    "omitBackground": false, // 是否忽略背景，生成透明背景的PNG (如果頁面背景透明)
    "waitUntil": "networkidle0", // Puppeteer 等待條件, e.g., 'load', 'domcontentloaded', 'networkidle0', 'networkidle2'
    "timeout": 60000, // 頁面加載超時時間 (毫秒)
    "splitSelector": ".page-container" // 用於分割截圖的CSS選擇器，例如 '.section' 或 '#myElement'。如果提供，將忽略 fullPage，並按每個匹配元素生成多個圖片。
  }
}
```

**參數詳解:**

-   `type` (string, 必填):
    -   `'file'`: `input` 應為相對於服務器運行目錄的 HTML 文件路徑。
    -   `'html'`: `input` 應為包含完整 HTML 結構的字符串。
    -   `'url'`: `input` 應為一個有效的網頁 URL。
-   `input` (string, 必填): 根據 `type` 提供對應的輸入。
-   `outputFileName` (string, 必填):
    -   指定輸出的基礎文件名。擴展名 (`.png` 或 `.jpeg`/`.jpg`) 將決定輸出格式。
    -   服務器會將圖片保存在其工作目錄下的 `output_images` 文件夾中。
    -   如果使用了 `splitSelector`，實際文件名將是 `[outputFileName基礎名]_part_N.[擴展名]`。
-   `options` (object, 可選):
    -   `format`: PDF 頁面格式，對截圖影響較小，但可能會影響 Puppeteer 設置的初始視口（如果未顯式設置）。
    -   `quality`: 僅當輸出為 JPEG 格式時有效。
    -   `fullPage`: 布爾值。如果為 `true` 且未使用 `splitSelector`，將嘗試截取整個可滾動頁面。
    -   `omitBackground`: 布爾值。
    -   `waitUntil`: Puppeteer 在 `page.goto()` 或 `page.setContent()` 時的等待條件。
    -   `timeout`: Puppeteer 相關操作的超時時間。
    -   `splitSelector`: 如果提供此 CSS 選擇器，服務將查找所有匹配的元素，並為每個元素單獨截圖，而不是截取單個（可能是全頁的）圖片。截圖文件名將基於 `outputFileName` 並附加 `_part_N`。

**成功響應 (Success Response)**: `200 OK`

如果只生成一個文件：
```json
{
  "success": true,
  "message": "轉換成功。",
  "filePath": "output_images/result.png" // 相對於服務器 output_images 目錄的文件路徑
}
```

如果使用 `splitSelector` 生成多個文件：
```json
{
  "success": true,
  "message": "轉換成功，已分割為多個文件。",
  "filePaths": [ // 文件路徑數組
    "output_images/result_part_0.png",
    "output_images/result_part_1.png"
  ]
}
```

**錯誤響應 (Error Response)**: 例如 `400 Bad Request` 或 `500 Internal Server Error`

```json
{
  "success": false,
  "message": "錯誤信息描述",
  "error": "詳細的錯誤堆棧或代碼 (可選，調試時有用)"
}
```

## (可選) 靜態文件服務

為了方便訪問生成的圖片，服務器可以配置為從 `output_images` 目錄提供靜態文件服務。如果配置了，您可以通過類似 `http://localhost:3000/images/result.png` 的 URL 訪問圖片 (假設靜態路徑設置為 `/images`)。

## 命令行工具 (保留)

`html-to-png.js` 文件仍然可以作為命令行工具獨立運行 (如果其 `if (require.main === module)` 邏輯被保留)。

用法示例:
```bash
node html-to-png.js file input.html -o output.png --full-page -s ".page-container"
node html-to-png.js url "https://example.com" -o example.jpeg --quality 85
```
詳細用法請參閱：
```bash
node html-to-png.js --help
```

## 注意事項

-   **Chromium 下載**: 首次運行 `npm install` 時，Puppeteer 會下載 Chromium。請確保網絡連接正常。
-   **資源消耗**: Puppeteer 啟動瀏覽器實例是一個相對耗資源的操作。在高並發情況下，請注意服務器的內存和 CPU 使用情況。可以考慮使用瀏覽器實例池或隊列來管理請求。
-   **文件路徑**: 當 `type` 為 `'file'` 時，提供的 `input` 路徑是相對於服務器腳本的運行目錄。輸出文件將保存在服務器運行目錄下的 `output_images` 文件夾中。
-   **安全性**: 如果服務暴露在公網，請謹慎處理來自 URL 或 HTML 字符串的輸入，防止潛在的安全風險 (例如 SSRF 或注入惡意腳本導致的服務器資源濫用)。可以考慮對輸入 URL 的域名進行白名單限制，或對 HTML 內容進行清理。 