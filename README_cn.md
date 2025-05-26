# HTML 轉 PNG/JPEG 轉換服務與命令行工具

一個使用 Node.js 實現的服務和命令行工具，用於將 HTML 內容（來自本地文件、遠程 URL 或直接的 HTML 字符串）轉換為 PNG 或 JPEG 圖片，使用 Puppeteer 進行瀏覽器渲染。服務提供了實時進度更新和多種高級轉換選項。

## 功能特點

-   **多種輸入源：**
    -   從本地 HTML 文件轉換（命令行）。
    -   從遠程 URL 轉換（服務和命令行）。
    -   從直接的 HTML 內容字符串轉換（服務和命令行）。
    -   安全的 HTML 文件上傳轉換（服務 API）。
    -   **新增：** 批量處理整個目錄中的所有 HTML 文件（命令行）。
-   **輸出選項：**
    -   PNG 或 JPEG 格式（由輸出文件擴展名決定）。
    -   可配置的圖片質量（對於 JPEG）。
    -   可選的全頁截圖。
    -   可選擇省略默認白色背景（對於需要透明背景的 PNG）。
    -   **新增：** 智能自適應頁面尺寸，自動檢測內容實際寬度並調整視口大小，減少空白區域。
-   **高級功能：**
    -   基於 CSS 選擇器將單個 HTML 頁面分割為多個圖片。
    -   通過 Server-Sent Events (SSE) 為 API 用戶提供實時進度更新。
    -   **新增：** 優化檢測固定寬度內容，避免寬視口下產生過多空白。
-   **操作模式：**
    -   HTTP API 服務（`server.js`）。
    -   命令行界面（`html-to-png.js`）。

## 先決條件

-   [Node.js](https://nodejs.org/) (推薦 LTS 版本，例如 18.x 或更新版本)
-   npm (通常隨 Node.js 一起安裝) 或 yarn

## 安裝步驟

1.  克隆倉庫 (如果適用) 或下載項目文件。
2.  導航到項目目錄：
    ```bash
    cd path/to/html2png
    ```
3.  安裝依賴項：
    ```bash
    npm install
    ```
    (如果您偏好 yarn，請使用 `yarn install`)

    這將安裝 `puppeteer`、`express`、`multer` 及其他必要的包。
    **注意：** Puppeteer 首次安裝時會下載一個 Chromium 版本 (約 170-250MB，取決於操作系統)，這可能需要一些時間。請確保您的網絡連接穩定。

## 運行 HTTP 服務 (`server.js`)

該服務提供 API 端點用於啟動轉換並追蹤其進度。

**啟動服務：**

```bash
npm start
```
或者，您也可以運行：
```bash
node server.js
```

默認情況下，服務器監聽端口 `3000`。您可以通過設置 `PORT` 環境變量或修改 `server.js` 文件來配置端口。
服務成功啟動後，您會看到類似以下的消息：`HTML to PNG service with SSE listening on port 3000`。
生成的圖片將保存到項目根目錄下的 `output_images` 文件夾中。

### API 端點

#### 1. `POST /convert`

此端點用於啟動 HTML 到圖片的轉換。它設計為快速響應，接受請求後返回一個 `conversionId`，該 ID 可用於通過 SSE 流追蹤轉換進度（轉換過程可能耗時較長）。

**請求格式：**

*   **對於 `type: "url"` (遠程 URL) 或 `type: "html"` (直接 HTML 字符串)：**
    *   `Content-Type: application/json`
    *   **請求體示例：**
        ```json
        {
          "type": "url", // 或 "html"
          "input": "https://example.com", // 若為 "html" 類型，此處為 HTML 字符串
          "outputFileName": "my_image.png", // 期望的輸出文件名 (例如：image.png, page.jpeg)
          "options": { // 可選：詳見下方的 'options 對象詳解'
            "fullPage": true,
            "quality": 85, // 僅適用於 JPEG
            "splitSelector": ".page-section",
            "omitBackground": false,
            "waitUntil": "networkidle0",
            "timeout": 60000
          }
        }
        ```

*   **對於 `type: "file"` (HTML 文件上傳)：**
    *   `Content-Type: multipart/form-data`
    *   **表單字段：**
        *   `htmlFile`: (文件) 要轉換的 HTML 文件。對於 `type: "file"` 此為必填字段。
        *   `type`: (文本) 字符串值 `"file"`。此為必填字段。
        *   `outputFileName`: (文本, 可選) 期望的輸出文件名。如果省略，將根據上傳文件的原始名稱生成 (例如：`uploaded_file.png`)。
        *   `options`: (文本, 可選) 代表轉換選項的 JSON 字符串。示例：`'{"fullPage": true, "quality": 75}'`。詳見下方的 'options 對象詳解'。

        表單字段數據結構示例 (概念性，不含實際文件部分)：
        (注意：此為概念表示，實際請求為 `multipart/form-data`。)
        ```json
        {
          "type": "file", // 作為文本表單字段發送
          "outputFileName": "my_uploaded_page.png", // 作為文本表單字段發送 (可選)
          "options": "{\"fullPage\": true, \"quality\": 80}" // 作為文本表單字段發送 (JSON 字符串，可選)
          // 'htmlFile' 文件本身作為 multipart 請求中的文件部分發送。
        }
        ```

**`options` 對象詳解 (適用於 JSON 請求體及 multipart 選項字符串)：**

*   `format` (string): 頁面格式字符串，如 'A4', 'Letter'。主要供 Puppeteer 生成 PDF 時使用，但如果未明確覆蓋，也可能影響截圖的視口。
*   `quality` (number): 對於 JPEG 圖片，指定質量的整數 (0-100)。
*   `fullPage` (boolean): 若為 `true`，嘗試捕獲整個可滾動頁面。如果提供了 `splitSelector`，則此選項會被忽略。(Puppeteer 默認為 `false`，但轉換器類若未設置可能有其自身默認值)。
*   `omitBackground` (boolean): 若為 `true`，則忽略默認的白色背景。如果頁面背景透明，這可以生成帶有透明背景的 PNG。(默認：`false`)。
*   `waitUntil` (string | string[]): 定義 Puppeteer 何時認為導航成功。常用值包括 `'load'`, `'domcontentloaded'`, `'networkidle0'`, `'networkidle2'`。(轉換器默認使用：`'networkidle0'`)。
*   `timeout` (number): 最大導航時間 (毫秒)。(轉換器默認使用：`90000ms`)。
*   `splitSelector` (string): 一個 CSS 選擇器。如果提供，頁面將被截取為多張圖片，每個匹配選擇器的元素一張。使用此選項時，通常會忽略針對整個頁面的 `fullPage` 選項，每個選定元素會被完整捕獲。

**成功響應 (`202 Accepted`):**

表示服務器已接受請求進行處理。實際轉換異步進行。
```json
{
  "success": true,
  "message": "轉換請求已接受，正在處理中。請使用提供的 conversionId 監聽事件。",
  "conversionId": "a1b2c3d4e5f67890abcdef1234567890", // 此轉換任務的唯一ID
  "eventsUrl": "/events/a1b2c3d4e5f67890abcdef1234567890" // 用於監聽進度的SSE端點
}
```

**錯誤響應 (示例)：**
*   `400 Bad Request`: 如果缺少必填字段、`options` JSON 格式錯誤，或其他輸入驗證失敗。
*   `415 Unsupported Media Type`: 如果發送了錯誤的 `Content-Type` 頭 (例如，為文件上傳類型發送 JSON 而未使用 `multipart/form-data`)。
*   `500 Internal Server Error`: 如果在轉換過程中服務器發生意外錯誤。

#### 2. `GET /events/:conversionId`

此端點為特定轉換任務提供 Server-Sent Events (SSE) 流，以實現實時進度更新。

*   **URL 參數：**
    *   `conversionId` (string): 從 `POST /convert` 響應中獲取的唯一ID。

**事件流格式：**

客戶端將接收一個事件流。每個事件通常包含：
*   `id`: 事件的唯一ID (通常為時間戳)。
*   `event`: 事件名稱 (例如：`connected`, `progress`, `complete`, `error`, `warning`)。
*   `data`: 包含事件負載的 JSON 字符串。

**事件類型及數據負載：**

1.  **`connected`**: SSE 連接成功建立時發送。
    ```json
    {"message":"SSE 連接已建立","conversionId":"[conversionId]"}
    ```
2.  **`progress`**: 表示轉換過程中的進度更新。
    ```json
    {
      "eventName":"progress",
      "status":"launching_browser", // 代表當前步驟的代碼
      "message":"正在啟動瀏覽器..." // 人類可讀的消息
      // 對於分割截圖，可能還包含 'part', 'totalParts', 'partPath' 等附加字段
    }
    ```
    *進度事件的關鍵 `status` 值包括 (但不限於)：*
    `conversion_started`, `launching_browser`, `opening_page`, `navigating_to_file`, `setting_content`, `navigating_to_url`, `scroll_to_load_start`, `scroll_to_load_complete`, `evaluating_split_selector`, `no_split_selector`, `split_screenshot_start` (可能包含 `count`), `capturing_part` (可能包含 `part`, `totalParts`, `partPath`), `part_captured` (可能包含 `part`, `totalParts`, `partPath`), `all_parts_processed` (可能包含 `filePaths` 數組), `single_screenshot_start`, `single_screenshot_captured` (可能包含 `outputPath`), `closing_browser`。

3.  **`warning`**: 轉換過程中發生非關鍵問題或警告時發送。
    ```json
    {
      "eventName":"warning",
      "status":"split_selector_error", // 警告類型的代碼
      "message":"使用選擇器 "[selector]" 查找元素時出錯",
      "error":"可選的錯誤詳情..."
    }
    ```

4.  **`complete`**: 轉換成功完成時發送。
    *   對於單個輸出文件：
        ```json
        {
          "eventName":"complete",
          "status":"success",
          "message":"成功將 [input] 轉換為 [outputFileName]",
          "outputPath":"output_images/result.png" // 生成的單個文件路徑
        }
        ```
    *   對於多個輸出文件 (如果使用了 `splitSelector`)：
        ```json
        {
          "eventName":"complete",
          "status":"success",
          "message":"成功將 [input] 分割轉換為多個圖片",
          "filePaths":[ // 生成的多個文件路徑數組
            "output_images/result_part_0.png",
            "output_images/result_part_1.png"
          ]
        }
        ```

5.  **`error`**: 發生嚴重錯誤導致轉換任務失敗時發送。
    ```json
    {
      "eventName":"error",
      "status":"failed",
      "message":"轉換過程中發生錯誤",
      "error":"詳細的錯誤信息或堆棧跟踪"
    }
    ```

**客戶端 SSE 示例 (JavaScript 使用 `EventSource`):**
```javascript
const conversionId = 'YOUR_CONVERSION_ID'; // 替換為從 POST /convert 獲取的ID
const eventSource = new EventSource(`/events/${conversionId}`);

eventSource.onopen = function() {
    console.log("SSE Connection opened for " + conversionId);
};

eventSource.addEventListener('progress', function(event) {
    const data = JSON.parse(event.data);
    console.log('Progress Update:', data.message, data);
    // 示例：更新UI上的進度條或狀態消息
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
    eventSource.close(); // 完成後務必關閉連接
});

eventSource.addEventListener('error', function(event) {
    const data = JSON.parse(event.data);
    console.error('Conversion Failed:', data.message, data.error);
    eventSource.close(); // 出錯後務必關閉連接
});

eventSource.onerror = function(err) {
    console.error("EventSource encountered an error:", err);
    eventSource.close(); // EventSource 一般錯誤也應關閉連接
};
```

## 命令行工具 (`html-to-png.js`)

`html-to-png.js` 腳本可以直接從命令行運行，用於簡單的轉換操作，無需啟動 HTTP 服務。

**基本用法：**

```bash
node html-to-png.js <command> <input_source> [options]
```

**命令：**

*   `file <input.html>`: 轉換單個 HTML 文件。
    *   示例：`node html-to-png.js file ./mypage.html -o mypage_image.png`
*   `url <URL>`: 轉換遠程網頁。
    *   示例：`node html-to-png.js url "https://example.com" -o example_snapshot.png`
*   `html <file_containing_html.html>`: 從本地文件讀取 HTML 內容，並作為 HTML 字符串進行轉換。
    *   示例：`node html-to-png.js html ./my_raw_html.html -o raw_output.png`
*   `folder <directory_path>`: 轉換目錄中的所有 HTML/HTM 文件。
    *   示例：`node html-to-png.js folder ./html_files -o ./output_images`

**常用選項：**

*   `-o, --output <path>`: 
    - 對於 `file`/`url`/`html` 命令：指定輸出文件路徑。擴展名 (`.png` 或 `.jpeg`/`.jpg`) 決定格式。(默認：`output.png`)
    - 對於 `folder` 命令：指定輸出目錄路徑。(默認：`output_images`)
*   `--full-page`: 指示 Puppeteer 捕獲整個可滾動頁面。
*   `--omit-background`: 如果頁面沒有背景色，則使背景透明 (對 PNG 有用)。
*   `-q, --quality <number>`: 設置 JPEG 圖片的質量 (0-100 之間的整數)。
*   `-s <CSS_selector>`: 用於將截圖分割為多個文件的 CSS 選擇器。每個匹配選擇器的元素將另存為一個獨立圖片。
*   `-f, --format <format_string>`: 頁面格式字符串 (例如：'A4', 'Letter')。
*   `-h, --help`: 顯示詳細的幫助信息和所有可用選項。

**示例：**

```bash
# 將本地 HTML 文件轉換為全頁 PNG
node html-to-png.js file input.html -o output.png --full-page

# 將 URL 轉換為質量為 80% 的 JPEG 圖片
node html-to-png.js url "https://www.google.com" -o google.jpeg -q 80

# 轉換本地 HTML 文件，並根據 class 為 "page-container" 的元素分割輸出
node html-to-png.js file content.html -o content_pages.png -s ".page-container"

# 處理整個目錄中的 HTML 文件
node html-to-png.js folder ./html_files -o ./output_folder
```

**增強特性:**

* **智能視口尺寸調整:** 工具會自動檢測頁面的實際內容寬度，並相應地調整視口大小，減少輸出圖片中的空白區域。特別適用於固定寬度的響應式設計頁面。

* **分割截圖模式:** 使用 `-s` 選項指定 CSS 選擇器，可以將頁面分割成多個截圖，每個匹配的元素作為一個單獨的圖片。

* **批量處理:** `folder` 命令使您能夠一次性處理整個目錄中的所有 HTML 文件，保留原始文件名並將結果輸出到指定目錄。

## 主要依賴項

此項目依賴於以下幾個關鍵的 Node.js 包：

-   **Puppeteer**: 用於通過 Chrome/Chromium 進行無頭瀏覽，以準確渲染 HTML 內容。
-   **Express**: Node.js 的 Web 應用框架，此處用於構建 HTTP API 服務器。
-   **Multer**: 用於處理 `multipart/form-data` 的中間件，主要用於服務中處理 HTML 文件上傳。

## 重要說明與注意事項

-   **Chromium 下載**: 如前所述，Puppeteer 在首次 `npm install` 時會下載一個兼容的 Chromium 版本。這需要網絡連接且可能耗時較長。
-   **資源消耗**: 通過 Puppeteer 運行無頭瀏覽器實例可能消耗大量資源 (CPU 和內存)。對於 HTTP 服務的高並發場景，請考慮實施請求隊列、速率限制或管理瀏覽器實例池，以優化性能和穩定性。
-   **文件上傳 (服務)**：
    -   HTTP 服務限制上傳的 HTML 文件大小 (默認為 10MB，可在 `server.js` 中配置)。
    -   默認情況下，僅接受擴展名為 `.html` 或 `.htm` (或 `text/html` mimetype) 的文件上傳 (可在 `server.js` 中配置)。
-   **安全性 (URL 及 HTML 字符串輸入)**：當公開 HTTP 服務時，尤其是接受 URL 或直接 HTML 字符串的端點，請注意潛在的安全風險。這些包括：
    -   如果可以處理任意 URL，可能導致服務器端請求偽造 (SSRF)。
    -   如果提交過於複雜或惡意的 HTML/JavaScript，可能導致資源耗盡。
    -   如果服務面向互聯網，考慮對 URL 實施輸入驗證、清理、域名白名單，或對 HTML 內容進行沙盒處理。
-   **輸出目錄**: 所有由服務生成的圖片，或由命令行工具生成且未指定此目錄外的特定輸出路徑的圖片，都將保存到項目根目錄下的 `output_images` 文件夾中。請確保應用程序對此目錄具有寫入權限。 