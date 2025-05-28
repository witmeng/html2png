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

import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  ProgressTokenSchema,
  ImplementationSchema,
  ServerCapabilitiesSchema,
  ToolSchema,
  McpError,
  ErrorCode,
  ProgressNotificationSchema,
  JSONRPCRequestSchema,
  CallToolResult,
  ServerRequest,
  ServerNotification
} from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { HtmlToPngConverter, type ConverterOptions as HtmlToPngConverterOptions } from './html-to-png.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { logToFile, logToFileSync, mcpLog } from './log.js';

// 啟動時同步寫入一條日誌
logToFileSync('MCP Stdio Server for html2png starting (sync log)...');

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
  waitUntil: z.union([z.string(), z.array(z.string())]).optional() as z.ZodType<HtmlToPngConverterOptions['waitUntil'] | undefined>,
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

type ConvertInput = z.infer<typeof ConvertInputSchema>;

const ConvertOutputSchema = z.object({
  outputPaths: z.array(z.string()).describe("所有生成的 PNG 路徑"),
  fileNames: z.array(z.string()).describe("所有生成的檔名"),
  ossUrls: z.array(z.string()).describe("所有上傳到 OSS 的圖片網址"),
  logs: z.array(z.string()).optional().describe("轉換日誌"),
}).strict();

// 3. Define the Tool Callback function
const convertToolCallback: ToolCallback<typeof ConvertInputSchema.shape> = async (
  args: ConvertInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> => {
  console.log('[convertToolCallback] Received args:', JSON.stringify(args, null, 2));
  const { type, input, outputFileName: desiredOutputFileName, options: reqOptions } = args;

  // Generate a unique ID for this conversion for logging and temporary files
  const conversionJobId = crypto.randomBytes(8).toString('hex');
  const progressToken = extra._meta?.progressToken as z.infer<typeof ProgressTokenSchema> | undefined;

  const sendProgress = (status: string, message: string, additionalData?: object) => {
    if (progressToken) {
      const progressParams: z.infer<typeof ProgressNotificationSchema>['params'] = {
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
        .catch((err: Error) => console.error("[MCP Progress Send Error]", err));
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

  let actualOutputFileName = desiredOutputFileName || `${type}_${conversionJobId.substring(0,6)}.png`;
  if (path.dirname(actualOutputFileName) !== '.') {
     console.warn("OutputFileName tried to traverse paths, sanitizing.");
     actualOutputFileName = path.basename(actualOutputFileName);
  }
  const outputPath = path.join(outputBaseDir, actualOutputFileName);

  const converterOptions: Partial<HtmlToPngConverterOptions> = {
    ...(reqOptions || {}),
    eventEmitter: null, // Explicitly nullify eventEmitter for MCP server
    conversionId: null, // Explicitly nullify conversionId for MCP server
    fileContext: null, // Explicitly nullify fileContext for MCP server
  };
  
  const converter = new HtmlToPngConverter(converterOptions);
  let logs: string[] = [];

  try {
    sendProgress('processing_started', `Starting conversion for type: ${type}`);
    
    switch (type) {
      case 'url':
        // 支持分號分隔的多個網址
        const urls = input.split(';').map(u => u.trim()).filter(Boolean);
        var outputPaths: string[] = [];
        var fileNames: string[] = [];
        var ossUrls: string[] = [];
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          const fileName = urls.length === 1
            ? actualOutputFileName
            : `${path.basename(actualOutputFileName, '.png')}_${i + 1}.png`;
          const outPath = path.join(outputBaseDir, fileName);
          logs.push(`Converting URL: ${url}`);
          const { localPaths, ossUrls: singleOssUrls } = await converter.convertUrl(url, outPath);
          outputPaths.push(...localPaths);
          fileNames.push(...localPaths.map(p => path.basename(p)));
          ossUrls.push(...singleOssUrls);
        }
        sendProgress('processing_complete', `Conversion successful: ${outputPaths.join(', ')}`);
        logs.push(`Conversion successful. Output: ${outputPaths.join(', ')}`);
        return {
          content: [{ type: 'text', text: `Conversion successful. Output: ${outputPaths.join(', ')}; OSS: ${ossUrls.join(', ')}` }],
          structuredContent: {
            outputPaths,
            fileNames,
            ossUrls,
            logs,
          },
        };
      case 'html':
        logs.push(`Converting HTML string (length: ${input.length})`);
        const { localPaths: htmlPaths, ossUrls: htmlOssUrls } = await converter.convertHtmlString(input, outputPath);
        outputPaths = htmlPaths;
        fileNames = htmlPaths.map(p => path.basename(p));
        ossUrls = htmlOssUrls;
        sendProgress('processing_complete', `Conversion successful: ${outputPaths.join(', ')}`);
        logs.push(`Conversion successful. Output: ${outputPaths.join(', ')}`);
        return {
          content: [{ type: 'text', text: `Conversion successful. Output: ${outputPaths.join(', ')}; OSS: ${ossUrls.join(', ')}` }],
          structuredContent: {
            outputPaths,
            fileNames,
            ossUrls,
            logs,
          },
        };
      case 'base64':
        // 當 `type: 'base64'` 時，將 `input` 解碼寫入臨時檔案，再進行轉換
        const tempFilePath = path.join(outputBaseDir, `temp_${conversionJobId}.base64`);
        await fs.writeFile(tempFilePath, input, 'base64');
        logs.push(`Converting base64 content (saved to temp: ${tempFilePath})`);
        const { localPaths: base64Paths, ossUrls: base64OssUrls } = await converter.convertFile(tempFilePath, outputPath);
        await fs.unlink(tempFilePath).catch((e: Error) => console.error("Failed to delete temp base64 file:", e));
        outputPaths = base64Paths;
        fileNames = base64Paths.map(p => path.basename(p));
        ossUrls = base64OssUrls;
        sendProgress('processing_complete', `Conversion successful: ${outputPaths.join(', ')}`);
        logs.push(`Conversion successful. Output: ${outputPaths.join(', ')}`);
        return {
          content: [{ type: 'text', text: `Conversion successful. Output: ${outputPaths.join(', ')}; OSS: ${ossUrls.join(', ')}` }],
          structuredContent: {
            outputPaths,
            fileNames,
            ossUrls,
            logs,
          },
        };
      default:
        sendProgress('error', `Invalid conversion type: ${type as any}`);
        throw new McpError(ErrorCode.InvalidParams, `Invalid conversion type: ${type as any}`);
    }
  } catch (error: unknown) {
    console.error(`[${conversionJobId}] Conversion error:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    sendProgress('error', `Conversion failed: ${errorMessage}`, { error: String(error) });
    logs.push(`Error during conversion: ${errorMessage}`);
    // 準確回傳錯誤到 MCP client
    const errorContent = [{ type: 'text', text: `[ERROR] Conversion failed: ${errorMessage}` }];
    const errorStructuredContent = {
      outputPaths: [],
      fileNames: [],
      ossUrls: [],
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
  description: 'Converts HTML, URL, or base64 file content to a PNG image.\n\n說明：\n- 當 type 為 html 時，input必須是HTML字符串（不能是檔案路徑）。\n- 當 type 為 base64 時，input 必須是 base64 編碼的檔案內容。\n- 當 type 為 url 時，input 為網址（可分號分隔多個網址）。',
  inputSchema: ConvertInputSchema.shape,
  outputSchema: ConvertOutputSchema.shape,
  annotations: {穩定性: '實驗性'},
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
        if (isClosing) return;
        isClosing = true;
        console.log("Stdio transport closed. Exiting.");
        mcpServer.close().finally(() => process.exit(0));
    };
    transport.onerror = (err: Error) => { // Typed err as Error
        if (isClosing) return;
        isClosing = true;
        console.error("Stdio transport error:", err);
        mcpServer.close().finally(() => process.exit(1));
    };

  } catch (error) { // Removed any, allowing type inference or defaulting to unknown
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