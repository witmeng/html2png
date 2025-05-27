#!/usr/bin/env node
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import multer from 'multer';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url'; // For __dirname in ESM
import http from 'http'; // Import http module
// Diagnostic: Long timeout at the very beginning
const veryEarlyTimeout = setTimeout(() => {
    console.log("Very early timeout executed after 20 seconds. If server exited before this, it's very strange.");
}, 20000); // 20 seconds
console.log("Starting server.ts execution...");
// Assuming html-to-png.ts exports these
import { HtmlToPngConverter, processFolderHtml } from './html-to-png.js';
// --- Server Setup ---
const app = express();
const PORT = process.env.PORT || 3000;
// ESM equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Global or application-level instances
const sseEventEmitter = new EventEmitter();
const outputBaseDir = path.join(__dirname, '../output_images'); // Adjusted path: one level up from dist/ to project_root/output_images
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Ensure output directory exists
fs.mkdir(outputBaseDir, { recursive: true })
    .then(() => {
    console.log(`Successfully ensured output directory exists: ${outputBaseDir}`);
})
    .catch(err => {
    console.error(`Error creating output directory ${outputBaseDir}:`, err);
    // Decide if this error is fatal. If so:
    // process.exit(1);
});
// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const tempUploadDir = path.join(__dirname, '../temp_uploads'); // Store temp files one level up from dist/
        await fs.mkdir(tempUploadDir, { recursive: true });
        cb(null, tempUploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});
const htmlFileFilter = (req, file, cb) => {
    if (file.mimetype === 'text/html' || file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
        cb(null, true);
    }
    else {
        cb(new Error('僅允許上傳 HTML 文件 (.html, .htm)'), false); // Temp use `as any` if cb type mismatch, or ensure cb type allows Error
    }
};
const upload = multer({
    storage: storage,
    fileFilter: htmlFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});
// --- SSE Endpoint ---
app.get('/events/:conversionId', (req, res) => {
    const { conversionId } = req.params;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // CORS headers if your client is on a different origin
        'Access-Control-Allow-Origin': '*',
    });
    res.write('\n'); // Send an initial newline
    const listener = (data) => {
        res.write(`id: ${new Date().getTime()}\n`);
        res.write(`event: ${data.eventName || 'message'}\n`); // Use eventName from data or default to 'message'
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    sseEventEmitter.on(conversionId, listener);
    // Send a connection established message
    sseEventEmitter.emit(conversionId, { eventName: 'connected', message: 'SSE 連接已建立', conversionId });
    req.on('close', () => {
        sseEventEmitter.off(conversionId, listener);
        console.log(`SSE connection closed for ${conversionId}`);
    });
});
// --- Conversion Endpoints ---
app.post('/convert', upload.single('htmlFile'), async (req, res) => {
    const body = req.body;
    const type = body.type;
    const input = body.input;
    const optionsFromReq = body.options || {};
    let outputFileName = body.outputFileName;
    if (!type) {
        return res.status(400).json({ success: false, message: '錯誤：缺少 type 參數。' });
    }
    const conversionId = crypto.randomBytes(16).toString('hex');
    const eventsUrl = `/events/${conversionId}`;
    let defaultOutputName = 'output.png';
    if (type === 'file' && req.file) {
        defaultOutputName = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.png`;
    }
    else if (type === 'url' && input) {
        try {
            const urlObj = new URL(input);
            defaultOutputName = `${urlObj.hostname.replace(/www./, '') || 'url'}.png`;
        }
        catch {
            defaultOutputName = 'url_page.png';
        }
    }
    else if (type === 'html') {
        defaultOutputName = 'html_content.png';
    }
    outputFileName = outputFileName || defaultOutputName;
    const outputPath = path.join(outputBaseDir, outputFileName);
    // Ensure outputFileName does not try to traverse paths
    if (path.dirname(outputFileName) !== '.') {
        return res.status(400).json({ success: false, message: '錯誤：輸出文件名格式無效。' });
    }
    res.status(202).json({
        success: true,
        message: '轉換請求已接受，正在處理中。',
        conversionId,
        eventsUrl,
        outputPathOnServer: outputPath // For info
    });
    // Asynchronous processing
    (async () => {
        const converter = new HtmlToPngConverter({
            ...optionsFromReq,
            eventEmitter: sseEventEmitter,
            conversionId,
            // fullPageUserSpecified needs to be explicitly passed if it's part of optionsFromReq and true
            fullPageUserSpecified: optionsFromReq.fullPage === true ? true : false,
        });
        try {
            sseEventEmitter.emit(conversionId, { eventName: 'progress', status: 'conversion_started', message: '轉換任務開始' });
            switch (type) {
                case 'url':
                    if (!input)
                        throw new Error('URL 輸入為空');
                    await converter.convertUrl(input, outputPath);
                    break;
                case 'html':
                    if (!input)
                        throw new Error('HTML 內容為空');
                    await converter.convertHtmlString(input, outputPath);
                    break;
                case 'file':
                    if (!req.file)
                        throw new Error('未上傳 HTML 文件');
                    const uploadedFilePath = req.file.path;
                    await converter.convertFile(uploadedFilePath, outputPath);
                    // Clean up uploaded file
                    await fs.unlink(uploadedFilePath).catch(err => console.error('清理上傳文件失敗:', err));
                    break;
                default:
                    // This case should ideally not be reached if type is validated
                    throw new Error('無效的轉換類型');
            }
            // Note: converter.convertFile/Url/HtmlString itself emits 'complete' or 'error' for that specific conversion.
        }
        catch (error) {
            console.error(`[${conversionId}] 轉換錯誤:`, error);
            sseEventEmitter.emit(conversionId, {
                eventName: 'error',
                status: 'failed',
                message: error.message || '轉換失敗',
                error: error.toString(),
            });
        }
    })();
});
app.post('/convert-folder', async (req, res) => {
    const { inputFolderPath, outputFolderName, options: commonConverterOptions = {} } = req.body;
    if (!inputFolderPath) {
        return res.status(400).json({ success: false, message: '錯誤：缺少 inputFolderPath 參數。' });
    }
    // --- Security Validation ---
    // IMPORTANT: Implement robust path validation for production!
    const normalizedInputPath = path.resolve(inputFolderPath); // Resolve to absolute path
    // Example: const safeBaseHtmlDir = path.resolve(__dirname, '../allowed_html_sources');
    // if (!normalizedInputPath.startsWith(safeBaseHtmlDir)) { ... error ... }
    try {
        const stats = await fs.stat(normalizedInputPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ success: false, message: `錯誤：提供的 inputFolderPath 不是一個有效的目錄: ${inputFolderPath}` });
        }
    }
    catch (error) {
        console.error(`錯誤：無法訪問 inputFolderPath "${normalizedInputPath}":`, error);
        return res.status(400).json({ success: false, message: `錯誤：無法訪問 inputFolderPath: ${inputFolderPath}` });
    }
    const sanitizedOutputFolderName = outputFolderName ? path.basename(outputFolderName) : `folder_conversion_${Date.now()}`;
    const targetOutputDir = path.join(outputBaseDir, sanitizedOutputFolderName);
    // --- End Security Validation ---
    const conversionId = crypto.randomBytes(16).toString('hex');
    const eventsUrl = `/events/${conversionId}`;
    res.status(202).json({
        success: true,
        message: '文件夾轉換請求已接受，正在處理中。',
        conversionId,
        eventsUrl,
        inputFolderPath: normalizedInputPath,
        targetOutputDir
    });
    (async () => {
        try {
            console.log(`[${conversionId}] 開始處理文件夾: ${normalizedInputPath} -> ${targetOutputDir}`);
            sseEventEmitter.emit(conversionId, {
                eventName: 'progress',
                status: 'folder_conversion_queued',
                message: '文件夾轉換請求已進入隊列，準備開始處理。',
                conversionId,
                inputFolderPath: normalizedInputPath,
                targetOutputDir
            });
            await fs.mkdir(targetOutputDir, { recursive: true });
            await processFolderHtml(normalizedInputPath, targetOutputDir, commonConverterOptions, sseEventEmitter, conversionId);
        }
        catch (error) {
            console.error(`[${conversionId}] 異步處理文件夾 ${normalizedInputPath} 時發生錯誤:`, error);
            sseEventEmitter.emit(conversionId, {
                eventName: 'error',
                status: 'critical_folder_processing_error',
                message: `處理文件夾 ${normalizedInputPath} 時發生嚴重錯誤: ${error.message || '未知服務器錯誤'}`,
                conversionId,
                inputFolderPath: normalizedInputPath,
                error: error.message || '未知服務器錯誤'
            });
        }
    })();
});
// --- Error Handling Middleware (optional but good practice) ---
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    if (!res.headersSent) {
        res.status(500).json({ success: false, message: '服務器內部錯誤', error: err.message });
    }
});
// --- Start Server ---
const server = http.createServer(app);
let currentPort = Number(PORT); // Initialize currentPort with the initial PORT value
const MAX_RETRIES = 10; // Maximum number of port retries
function startServer(port, retries = 0) {
    if (retries >= MAX_RETRIES) {
        console.error(`Failed to start server after ${MAX_RETRIES} retries. All attempted ports were in use.`);
        process.exit(1);
        return; // Ensure no further execution
    }
    server.listen(port, () => {
        currentPort = port; // Update currentPort when listen is successful
        console.log(`HTML to PNG (MCP Server) is listening on port ${currentPort}`);
        console.log(`Output directory: ${outputBaseDir}`);
        console.log(`To test SSE, open: http://localhost:${currentPort}/events/test`);
        console.log(`Send POST to http://localhost:${currentPort}/convert or http://localhost:${currentPort}/convert-folder`);
        console.log("Server setup complete and is now listening for requests.");
        clearTimeout(veryEarlyTimeout); // Clear timeout if listen is successful
    });
    // server.on('error', ...) is handled outside for the single server instance
}
server.on('error', (error) => {
    if (error.syscall !== 'listen') {
        throw error;
    }
    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(`Port ${currentPort} requires elevated privileges`);
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.warn(`Port ${currentPort} is already in use. Trying port ${currentPort + 1}...`);
            // Find the startServer call and remove it if it exists. We will call it directly.
            // We don't remove the server.listen call as it's now inside startServer.
            // The server.on('error') handler is attached once to the server instance.
            // When EADDRINUSE occurs, we simply try to listen on a new port.
            // To do this correctly, we should call startServer with an incremented port.
            // We need to ensure that 'currentPort' is updated appropriately.
            // The original server.listen was replaced by startServer(currentPort)
            // So, when an error occurs, we call startServer with currentPort + 1.
            // It's crucial that the server instance itself is not re-created,
            // only the listen attempt is retried on a new port.
            // The 'error' handler is on the 'server' instance.
            // When 'listen' fails with EADDRINUSE, this handler is triggered.
            // We then call 'startServer' again with an incremented port.
            // The 'startServer' function itself now contains 'server.listen()'.
            // 'currentPort' should be the port we are *trying*.
            // Let's adjust logic to pass the *next* port to try.
            const previousPort = currentPort; // The port that failed
            const nextPort = previousPort + 1;
            const retries = server.__retries || 0; // Keep track of retries
            if (retries >= MAX_RETRIES) {
                console.error(`Failed to start server on port ${previousPort} after ${MAX_RETRIES} attempts. Giving up.`);
                process.exit(1);
            }
            else {
                server.__retries = retries + 1;
                // Update currentPort before the next attempt for logging inside startServer
                currentPort = nextPort;
                console.log(`Retrying on port ${nextPort}... (Attempt ${server.__retries})`);
                // No need to remove and re-add listener, just call listen again on the same server instance
                // The original listen call is now wrapped in startServer.
                // We should call startServer to attempt listening on the new port.
                // However, the startServer function as designed would also re-attach the 'error' listener
                // or might have issues if called multiple times.
                // The server.listen should be directly called here or startServer refactored.
                // Refined approach: The startServer function is called once initially.
                // The error handler on the server instance will then manage retries.
                server.close(() => {
                    console.log(`Server closed on port ${previousPort} before retrying.`);
                    startServer(nextPort, server.__retries); // Pass retries count
                });
            }
            break;
        default:
            throw error;
    }
});
// Initial attempt to start the server
startServer(currentPort, 0);
process.on('SIGINT', () => {
    console.log('\nSIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    console.log('\nSIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
//# sourceMappingURL=server.js.map