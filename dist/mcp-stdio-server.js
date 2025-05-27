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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ImplementationSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { HtmlToPngConverter } from './html-to-png.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
// 將日誌輸出到文件而不是標準輸出，避免干擾 MCP 協議
const logToFile = async (message) => {
    try {
        const logDir = path.resolve(process.cwd(), 'mcp_logs');
        await fs.mkdir(logDir, { recursive: true });
        const logFile = path.join(logDir, `mcp-server-${new Date().toISOString().slice(0, 10)}.log`);
        await fs.appendFile(logFile, `${new Date().toISOString()} - ${message}\n`);
    }
    catch (e) {
        // 避免在日誌操作失敗時拋出錯誤
    }
};
console.log = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    logToFile(`INFO: ${message}`);
};
console.error = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    logToFile(`ERROR: ${message}`);
};
console.warn = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    logToFile(`WARN: ${message}`);
};
// 在初始化日誌後寫入一條啟動信息
logToFile("MCP Stdio Server for html2png starting...");
// 1. Define Server Information
const serverInfo = ImplementationSchema.parse({
    name: 'html2png-mcp-server',
    version: '1.0.0', // TODO: Consider linking this to package.json version
});
// 2. Define Input/Output Schemas for the tool using Zod
const ConvertInputOptionsSchema = z.object({
    format: z.string().optional(),
    quality: z.number().optional(),
    fullPage: z.boolean().optional(),
    omitBackground: z.boolean().optional(),
    waitUntil: z.union([z.string(), z.array(z.string())]).optional(),
    timeout: z.number().optional(),
    splitSelector: z.string().nullable().optional(),
}).strict();
const ConvertInputSchema = z.object({
    type: z.enum(['url', 'html', 'base64']),
    input: z.string().describe("網址、HTML內容或 base64 編碼的檔案內容"),
    originalFileName: z.string().optional().describe("原始檔案名稱，僅 type 為 base64 時建議提供"),
    encoding: z.literal('base64').optional().describe("檔案內容的編碼格式，僅 type 為 base64 時使用，預設為 base64"),
    outputFileName: z.string().optional().describe("期望輸出的檔名，例如 'page.png'。若未提供則自動生成。"),
    options: ConvertInputOptionsSchema.optional(),
}).strict();
const ConvertOutputSchema = z.object({
    outputPaths: z.array(z.string()).describe("所有生成的 PNG 路徑"),
    fileNames: z.array(z.string()).describe("所有生成的檔名"),
    logs: z.array(z.string()).optional().describe("轉換日誌"),
}).strict();
// 3. Define the Tool Callback function
const convertToolCallback = async (args, extra) => {
    console.log('[convertToolCallback] Received args:', JSON.stringify(args, null, 2));
    const { type, input, outputFileName: desiredOutputFileName, options: reqOptions } = args;
    // Generate a unique ID for this conversion for logging and temporary files
    const conversionJobId = crypto.randomBytes(8).toString('hex');
    const progressToken = extra._meta?.progressToken;
    const sendProgress = (status, message, additionalData) => {
        if (progressToken) {
            const progressParams = {
                progressToken: progressToken,
                progress: -1,
                message: message,
                _meta: {
                    conversionJobId,
                    status,
                    timestamp: new Date().toISOString(),
                    ...(additionalData || {}),
                },
            };
            // Actual MCP progress notification sending
            mcpServer.server.notification({ method: 'notifications/progress', params: progressParams })
                .then(() => console.log(`[MCP Progress Sent - ${conversionJobId}] ${status}: ${message}`, additionalData || ''))
                .catch((err) => console.error("[MCP Progress Send Error]", err));
        }
    };
    sendProgress('queued', 'Conversion request accepted and queued.');
    // Determine output path
    // Base output directory - should be configurable or use a tmp dir for npx scenarios
    // For installed packages via npx, __dirname will be in a global cache.
    // We need a reliable way to specify output that the user can access or that is temporary.
    // For now, let's use a 'mcp_output' subdir in the current working directory of the server process.
    const outputBaseDir = path.resolve(process.cwd(), 'mcp_output', conversionJobId);
    await fs.mkdir(outputBaseDir, { recursive: true });
    let actualOutputFileName = desiredOutputFileName || `${type}_${conversionJobId.substring(0, 6)}.png`;
    if (path.dirname(actualOutputFileName) !== '.') {
        console.warn("OutputFileName tried to traverse paths, sanitizing.");
        actualOutputFileName = path.basename(actualOutputFileName);
    }
    const outputPath = path.join(outputBaseDir, actualOutputFileName);
    const converterOptions = {
        ...(reqOptions || {}),
        eventEmitter: null, // Explicitly nullify eventEmitter for MCP server
        conversionId: null, // Explicitly nullify conversionId for MCP server
        fileContext: null, // Explicitly nullify fileContext for MCP server
    };
    const converter = new HtmlToPngConverter(converterOptions);
    let logs = [];
    try {
        sendProgress('processing_started', `Starting conversion for type: ${type}`);
        switch (type) {
            case 'url':
                // 支持分號分隔的多個網址
                const urls = input.split(';').map(u => u.trim()).filter(Boolean);
                var outputPaths = [];
                var fileNames = [];
                for (let i = 0; i < urls.length; i++) {
                    const url = urls[i];
                    const fileName = urls.length === 1
                        ? actualOutputFileName
                        : `${path.basename(actualOutputFileName, '.png')}_${i + 1}.png`;
                    const outPath = path.join(outputBaseDir, fileName);
                    logs.push(`Converting URL: ${url}`);
                    await converter.convertUrl(url, outPath);
                    outputPaths.push(outPath);
                    fileNames.push(fileName);
                }
                sendProgress('processing_complete', `Conversion successful: ${outputPaths.join(', ')}`);
                logs.push(`Conversion successful. Output: ${outputPaths.join(', ')}`);
                return {
                    content: [{ type: 'text', text: `Conversion successful. Output: ${outputPaths.join(', ')}` }],
                    structuredContent: {
                        outputPaths,
                        fileNames,
                        logs,
                    },
                };
            case 'html':
                logs.push(`Converting HTML string (length: ${input.length})`);
                await converter.convertHtmlString(input, outputPath);
                outputPaths = [outputPath];
                fileNames = [actualOutputFileName];
                sendProgress('processing_complete', `Conversion successful: ${outputPath}`);
                logs.push(`Conversion successful. Output: ${outputPath}`);
                return {
                    content: [{ type: 'text', text: `Conversion successful. Output: ${outputPath}` }],
                    structuredContent: {
                        outputPaths,
                        fileNames,
                        logs,
                    },
                };
            case 'base64':
                // 當 `type: 'base64'` 時，將 `input` 解碼寫入臨時檔案，再進行轉換
                const tempFilePath = path.join(outputBaseDir, `temp_${conversionJobId}.base64`);
                await fs.writeFile(tempFilePath, input, 'utf-8');
                logs.push(`Converting base64 content (saved to temp: ${tempFilePath})`);
                await converter.convertFile(tempFilePath, outputPath);
                await fs.unlink(tempFilePath).catch((e) => console.error("Failed to delete temp base64 file:", e));
                outputPaths = [outputPath];
                fileNames = [actualOutputFileName];
                sendProgress('processing_complete', `Conversion successful: ${outputPath}`);
                logs.push(`Conversion successful. Output: ${outputPath}`);
                return {
                    content: [{ type: 'text', text: `Conversion successful. Output: ${outputPath}` }],
                    structuredContent: {
                        outputPaths,
                        fileNames,
                        logs,
                    },
                };
            default:
                sendProgress('error', `Invalid conversion type: ${type}`);
                throw new McpError(ErrorCode.InvalidParams, `Invalid conversion type: ${type}`);
        }
    }
    catch (error) {
        console.error(`[${conversionJobId}] Conversion error:`, error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        sendProgress('error', `Conversion failed: ${errorMessage}`, { error: String(error) });
        logs.push(`Error during conversion: ${errorMessage}`);
        // 準確回傳錯誤到 MCP client
        const errorContent = [{ type: 'text', text: `[ERROR] Conversion failed: ${errorMessage}` }];
        const errorStructuredContent = {
            outputPaths: [],
            fileNames: [],
            logs,
            error: String(error),
        };
        if (error instanceof McpError) {
            // 仍然 throw，但也回傳 errorContent 方便 client 記錄
            throw new McpError(error.code, error.message, { ...errorStructuredContent });
        }
        // Construct a new McpError, including the original error if it was an Error instance
        const errorDetails = error instanceof Error ? { originalError: error.toString() } : {};
        throw new McpError(ErrorCode.InternalError, `Conversion failed: ${errorMessage}`, { ...errorStructuredContent, ...errorDetails });
    }
};
// 4. Initialize McpServer and StdioServerTransport
const mcpServer = new McpServer(serverInfo, {
    // Optional: Define server capabilities if different from default
    capabilities: {
        tools: { listChanged: false }, // Example: if we don't dynamically change tools
        // resources: { ... }
        // prompts: { ... }
    }
});
// 5. Register the tool
mcpServer.registerTool('html2png/convert', {
    description: 'Converts HTML, URL, or base64 file content to a PNG image.\n\n說明：\n- 當 type 為 html 時，input 必須是 HTML 原始碼字串（不能是檔案路徑）。\n- 當 type 為 base64 時，input 必須是 base64 編碼的檔案內容。\n- 當 type 為 url 時，input 為網址（可分號分隔多個網址）。',
    inputSchema: ConvertInputSchema.shape,
    outputSchema: ConvertOutputSchema.shape,
    annotations: { 穩定性: '實驗性' },
}, convertToolCallback);
// 6. Main function to start the server
async function main() {
    try {
        const transport = new StdioServerTransport();
        await mcpServer.connect(transport);
        console.log('MCP Stdio Server connected to stdio and listening for messages.');
        // 防止重複關閉導致遞迴
        let isClosing = false;
        transport.onclose = () => {
            if (isClosing)
                return;
            isClosing = true;
            console.log("Stdio transport closed. Exiting.");
            mcpServer.close().finally(() => process.exit(0));
        };
        transport.onerror = (err) => {
            if (isClosing)
                return;
            isClosing = true;
            console.error("Stdio transport error:", err);
            mcpServer.close().finally(() => process.exit(1));
        };
    }
    catch (error) { // Removed any, allowing type inference or defaulting to unknown
        console.error('Failed to start MCP Stdio Server:', error);
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nSIGINT signal received: closing MCP server');
    mcpServer.close().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
    console.log('\nSIGTERM signal received: closing MCP server');
    mcpServer.close().finally(() => process.exit(0));
});
main();
//# sourceMappingURL=mcp-stdio-server.js.map