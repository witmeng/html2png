#!/usr/bin/env node
/**
 * html2png-mcp-server
 *
 * 這是一個基於 MCP (Model Context Protocol) 標準的 Stdio Server，
 * 使用 @modelcontextprotocol/sdk (typescript-sdk) 實現，
 * 主要用途為將 HTML、網址、檔案內容（base64）轉換為 PNG 圖片。
 *
 * 支持的 input 類型：
 *   - type: 'url'    // 支持分號分隔的多個網址，批次轉換
 *   - type: 'html'   // 直接傳入 HTML 字串
 *   - type: 'base64' // 以 base64 編碼的檔案內容（如 HTML 檔案），client 需先將檔案內容 base64 encode 後傳給 server
 *
 * 主要功能：
 *   - 批次處理多個網址
 *   - 支持 base64 檔案內容上傳與轉換
 *   - 轉換結果以陣列形式回傳所有生成的 PNG 路徑與檔名
 *   - 支持進度通知與詳細日誌
 *
 * 技術棧：
 *   - MCP 協議 server 實現：typescript-sdk (McpServer, StdioServerTransport)
 *   - Schema 驗證：zod
 *   - 圖片轉換：HtmlToPngConverter
 *
 * 適用於 LLM 應用、批次自動化、AI Agent 等場景。
 *
 * 詳細協議與 SDK 說明請參考 typescript-sdk/README.md
 */
export {};
