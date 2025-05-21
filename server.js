const express = require('express');
const { HtmlToPngConverter } = require('./html-to-png'); // 假設 html-to-png.js 在同一目錄
const EventEmitter = require('events');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer'); // 引入 multer

const app = express();
const port = process.env.PORT || 3000;

// Multer 配置: 暫存上傳的文件到內存
const storage = multer.memoryStorage(); // 將文件存儲在內存中，作為 Buffer
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 例如限制文件大小為 10MB
    fileFilter: (req, file, cb) => {
        // 只接受 HTML 文件
        if (file.mimetype === 'text/html' || file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
            cb(null, true);
        } else {
            cb(new Error('不支援的文件類型，請上傳 HTML 文件。'), false);
        }
    }
});

app.use(express.json()); // 用於解析 application/json
// multipart/form-data 請求會由 multer 處理，所以不需要 express.urlencoded

// 用於存儲活躍的 SSE 連接 (response streams)
const activeConnections = {};
// 用於存儲每個轉換任務的事件發射器
const conversionEventEmitters = {};

// 確保 output_images 文件夾存在
const outputDir = path.join(__dirname, 'output_images');
fs.mkdir(outputDir, { recursive: true }).catch(console.error);

// SSE 端點
app.get('/events/:conversionId', (req, res) => {
    const { conversionId } = req.params;

    if (!conversionEventEmitters[conversionId]) {
        return res.status(404).json({ success: false, message: '無效的轉換ID或任務已完成/未找到。' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush the headers to establish the connection

    activeConnections[conversionId] = res;

    const eventEmitter = conversionEventEmitters[conversionId];

    const eventHandler = (eventData) => {
        res.write(`id: ${new Date().getTime()}\n`);
        res.write(`event: ${eventData.eventName}\n`); // 使用從轉換器傳來的 eventName
        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        res.flush(); // 确保数据立即发送
    };

    eventEmitter.on(conversionId, eventHandler);

    // 當客戶端關閉連接時
    req.on('close', () => {
        if (activeConnections[conversionId]) {
            delete activeConnections[conversionId];
        }
        eventEmitter.removeListener(conversionId, eventHandler);
        // 可選擇在此處清理 conversionEventEmitters[conversionId] 如果任務已完成或超時
        // 但通常在轉換完成或失敗後清理更合適
        console.log(`SSE connection closed for conversionId: ${conversionId}`);
    });

    // 發送一個初始事件確認連接
    res.write(`id: ${new Date().getTime()}\n`);
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ message: 'SSE 連接已建立', conversionId })}\n\n`);
    res.flush();
});

// 轉換端點
// 使用 upload.single('htmlFile') 中間件來處理名為 'htmlFile' 的文件上傳字段
// 注意：如果 type 是 'file'，客戶端必須發送 multipart/form-data
app.post('/convert', upload.single('htmlFile'), async (req, res) => {
    // 如果是 multipart/form-data，req.body 需要特殊處理，因為 express.json() 可能不會解析它
    // multer 會處理文件部分，其他字段可能在 req.body 中
    // 我們需要確保能正確獲取 type, outputFileName, options
    
    let type, input, outputFileName, optionsString;
    if (req.is('multipart/form-data')) {
        // 從 multipart 表單數據中獲取字段
        type = req.body.type;
        outputFileName = req.body.outputFileName;
        optionsString = req.body.options; // options 可能作為 JSON 字符串傳遞
    } else if (req.is('application/json')) {
        // 從 JSON 請求體中獲取字段 (用於 'url' 和 'html' 類型)
        type = req.body.type;
        input = req.body.input;
        outputFileName = req.body.outputFileName;
        optionsString = req.body.options; // options 可能是對象或字符串
    } else {
        return res.status(415).json({ success: false, message: '不支援的 Content-Type。請使用 application/json 或 multipart/form-data。'});
    }

    let options = {};
    if (typeof optionsString === 'string') {
        try {
            options = JSON.parse(optionsString);
        } catch (e) {
            return res.status(400).json({ success: false, message: 'options 字段必須是有效的 JSON 字符串。' });
        }
    } else if (typeof optionsString === 'object' && optionsString !== null) {
        options = optionsString; // 如果已經是對象
    }

    if (type === 'file') {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "當 type 為 'file' 時，必須上傳一個名為 'htmlFile' 的 HTML 文件。"
            });
        }
        // input 將是上傳文件的內容
        input = req.file.buffer.toString('utf-8');
        if (!outputFileName) outputFileName = req.file.originalname.replace(/(\.html?)$/i, '.png') || 'uploaded_file.png';

    } else if (type === 'html' || type === 'url') {
        if (!input) {
             return res.status(400).json({
                success: false,
                message: `當 type 為 '${type}' 時，請求體中缺少 'input' 字段。`
            });
        }
    } else {
        return res.status(400).json({ success: false, message: "type 字段無效，必須是 'file', 'html', 或 'url'。" });
    }

    if (!outputFileName) {
         return res.status(400).json({
            success: false,
            message: "請求中缺少 'outputFileName' 字段。"
        });
    }

    const conversionId = crypto.randomBytes(16).toString('hex');
    const eventEmitter = new EventEmitter();
    conversionEventEmitters[conversionId] = eventEmitter;

    res.status(202).json({
        success: true,
        message: '轉換請求已接受，正在處理中。請使用提供的 conversionId 監聽事件。',
        conversionId: conversionId,
        eventsUrl: `/events/${conversionId}`
    });

    (async () => {
        const converterOptions = {
            ...(options || {}), //確保 options 存在
            eventEmitter,
            conversionId
        };
        const converter = new HtmlToPngConverter(converterOptions);
        const baseOutputName = path.basename(outputFileName, path.extname(outputFileName));
        const outputExtension = path.extname(outputFileName) || '.png';
        
        try {
            eventEmitter.emit(conversionId, { eventName: 'progress', status: 'conversion_started', message: '轉換任務已啟動', conversionId });

            let actualOutputPath;
            if (options.splitSelector) {
                actualOutputPath = path.join(outputDir, `${baseOutputName}${outputExtension}`);
            } else {
                actualOutputPath = path.join(outputDir, outputFileName);
            }

            if (type === 'file') { // 對於上傳的文件，始終使用 convertHtmlString
                await converter.convertHtmlString(input, actualOutputPath);
            } else if (type === 'html') {
                await converter.convertHtmlString(input, actualOutputPath);
            } else if (type === 'url') {
                await converter.convertUrl(input, actualOutputPath);
            }

        } catch (error) {
            console.error(`[Server /convert] Conversion ID ${conversionId} failed:`, error);
        } finally {
            setTimeout(() => {
                if (conversionEventEmitters[conversionId]) {
                    conversionEventEmitters[conversionId].removeAllListeners();
                    delete conversionEventEmitters[conversionId];
                }
                console.log(`Cleaned up resources for conversionId: ${conversionId}`);
            }, 5000);
        }
    })();
});

// Multer 錯誤處理中間件
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // Multer 自身的錯誤 (例如文件過大)
        return res.status(400).json({ success: false, message: `文件上傳錯誤: ${err.message}` });
    } else if (err) {
        // 其他錯誤 (例如 fileFilter 中的錯誤)
        return res.status(400).json({ success: false, message: err.message || '文件上傳失敗' });
    }
    next();
});

app.listen(port, () => {
    console.log(`HTML to PNG service with SSE listening on port ${port}`);
    console.log(`Output directory: ${outputDir}`);
});