#!/usr/bin/env node

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

// 將日誌輸出到文件而不是標準輸出，避免干擾 MCP 協議
const logToFile = async (message: string) => {
  try {
    const logDir = path.resolve(process.cwd(), 'mcp_logs');
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `mcp-server-${new Date().toISOString().slice(0, 10)}.log`);
    await fs.appendFile(logFile, `${new Date().toISOString()} - ${message}\n`);
  } catch (e) {
    // 避免在日誌操作失敗時拋出錯誤
  }
};

console.log = (...args: any[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  logToFile(`INFO: ${message}`);
};

console.error = (...args: any[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
  logToFile(`ERROR: ${message}`);
};

console.warn = (...args: any[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ');
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
  waitUntil: z.union([z.string(), z.array(z.string())]).optional() as z.ZodType<HtmlToPngConverterOptions['waitUntil'] | undefined>,
  timeout: z.number().optional(),
  splitSelector: z.string().nullable().optional(),
}).strict();

const ConvertInputSchema = z.object({
  type: z.enum(['url', 'html', 'file_content']), // 'file' is changed to 'file_content'
  input: z.string(), // URL string or HTML content string or File content string (as base64 or plain text)
  // For file_content, client should specify if input is base64 and its original extension for correct processing if needed.
  // We might add 'encoding' (e.g., 'base64') and 'originalFileName' fields later if 'file_content' needs more metadata.
  outputFileName: z.string().optional().describe("Desired output file name, e.g., 'page.png'. If not provided, a name will be generated."),
  options: ConvertInputOptionsSchema.optional(),
}).strict();

type ConvertInput = z.infer<typeof ConvertInputSchema>;

const ConvertOutputSchema = z.object({
  outputPath: z.string().describe("The path on the server where the PNG was saved."),
  // Consider adding imageData: z.string().optional().describe("Base64 encoded PNG data if direct return is desired.")
  // For now, we'll stick to outputPath as the primary result.
  fileName: z.string().describe("The actual name of the file created."),
  logs: z.array(z.string()).optional().describe("Conversion logs or messages."),
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
        logs.push(`Converting URL: ${input}`);
        await converter.convertUrl(input, outputPath);
        break;
      case 'html':
        logs.push(`Converting HTML string (length: ${input.length})`);
        await converter.convertHtmlString(input, outputPath);
        break;
      case 'file_content':
        // For file_content, we assume 'input' is the HTML string itself.
        // If it were base64, client would need to decode or server would decode here.
        // For simplicity, assuming plain text HTML content.
        // A temporary file might be needed if convertFile expects a path.
        const tempHtmlPath = path.join(outputBaseDir, `temp_${conversionJobId}.html`);
        await fs.writeFile(tempHtmlPath, input, 'utf-8');
        logs.push(`Converting file content (saved to temp: ${tempHtmlPath})`);
        await converter.convertFile(tempHtmlPath, outputPath);
        await fs.unlink(tempHtmlPath).catch((e: Error) => console.error("Failed to delete temp HTML file:", e));
        break;
      default:
        // This case should ideally be prevented by Zod validation if enum is exhaustive
        sendProgress('error', `Invalid conversion type: ${type as any}`);
        // Ensure McpError is thrown, not just a generic Error.
        throw new McpError(ErrorCode.InvalidParams, `Invalid conversion type: ${type as any}`);
    }

    sendProgress('processing_complete', `Conversion successful: ${outputPath}`);
    logs.push(`Conversion successful. Output: ${outputPath}`);
    
    return {
      content: [{ type: 'text', text: `Conversion successful. Output: ${outputPath}` }],
      structuredContent: {
        outputPath,
        fileName: actualOutputFileName,
        logs,
      },
    };
  } catch (error: unknown) {
    console.error(`[${conversionJobId}] Conversion error:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    sendProgress('error', `Conversion failed: ${errorMessage}`, { error: String(error) });
    logs.push(`Error during conversion: ${errorMessage}`);
    
    if (error instanceof McpError) {
      throw error;
    }
    // Construct a new McpError, including the original error if it was an Error instance
    const errorDetails = error instanceof Error ? { originalError: error.toString() } : {};
    throw new McpError(ErrorCode.InternalError, `Conversion failed: ${errorMessage}`, { logs, ...errorDetails });
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
  description: 'Converts HTML, URL, or HTML file content to a PNG image.',
  inputSchema: ConvertInputSchema.shape,
  outputSchema: ConvertOutputSchema.shape,
  annotations: {稳定性: '實驗性'},
}, convertToolCallback);


// 6. Main function to start the server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.log('MCP Stdio Server connected to stdio and listening for messages.');
    
    // Keep the process alive until the transport is closed (e.g., by client disconnecting stdin)
    // transport.onclose will be called by StdioServerTransport when stdin ends.
    transport.onclose = () => {
        console.log("Stdio transport closed. Exiting.");
        mcpServer.close().finally(() => process.exit(0));
    };
    transport.onerror = (err: Error) => { // Typed err as Error
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