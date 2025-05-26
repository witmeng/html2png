const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

/**
 * HTML 转 PNG 工具类
 */
class HtmlToPngConverter {
  constructor(options = {}) {
    this.options = {
      format: 'A4',
      quality: 100,
      fullPage: false,
      fullPageUserSpecified: false,
      omitBackground: false,
      waitUntil: 'networkidle0',
      timeout: 90000,
      splitSelector: null,
      eventEmitter: null,
      conversionId: null,
      fileContext: null,
      ...options,
    };
  }

  /**
   * 發送進度事件 (如果提供了 eventEmitter)
   * @param {string} eventName - 事件名稱 (例如 'progress', 'error', 'complete')
   * @param {object} data - 事件數據
   */
  _emitEvent(eventName, data) {
    if (this.options.eventEmitter && this.options.conversionId) {
      const eventPayload = { eventName, ...data };
      if (this.options.fileContext) {
        eventPayload.fileContext = this.options.fileContext;
      }
      this.options.eventEmitter.emit(this.options.conversionId, eventPayload);
    }
  }

  /**
   * 将 HTML 文件转换为 PNG
   * @param {string} htmlFilePath - HTML 文件路径
   * @param {string} outputPath - 输出 PNG 文件路径
   */
  async convertFile(htmlFilePath, outputPath) {
    const absolutePath = path.resolve(htmlFilePath);
    await this._validateFileExists(absolutePath);
    
    this._emitEvent('progress', { status: 'launching_browser', message: '正在啟動瀏覽器...' });
    const browser = await this._launchBrowser();
    try {
      this._emitEvent('progress', { status: 'opening_page', message: '正在打開新頁面...' });
      const page = await browser.newPage();
      // 初始設定一個適中的視口大小，頁面加載後會自動調整
      await page.setViewport({ width: 1920, height: 1080 });
      this._emitEvent('progress', { status: 'navigating_to_file', message: `正在導航到文件: ${absolutePath}` });
      await page.goto(`file://${absolutePath}`, {
        waitUntil: this.options.waitUntil,
        timeout: this.options.timeout,
      });
      this._emitEvent('progress', { status: 'capturing_screenshot', message: '正在截取屏幕...' });
      await this._captureScreenshot(page, outputPath);
      this._emitEvent('complete', { status: 'success', message: `成功將 ${htmlFilePath} 轉換為 ${outputPath}`, outputPath });
      console.log(`成功將 ${htmlFilePath} 转换为 ${outputPath}`);
    } catch (error) {
      console.error('转换过程中发生错误:', error);
      this._emitEvent('error', { status: 'failed', message: '轉換過程中發生錯誤', error: error.message });
      throw error;
    } finally {
      this._emitEvent('progress', { status: 'closing_browser', message: '正在關閉瀏覽器...' });
      await browser.close();
    }
  }

  /**
   * 将 HTML 字符串转换为 PNG
   * @param {string} htmlContent - HTML 内容
   * @param {string} outputPath - 输出 PNG 文件路径
   */
  async convertHtmlString(htmlContent, outputPath) {
    this._emitEvent('progress', { status: 'launching_browser', message: '正在啟動瀏覽器...' });
    const browser = await this._launchBrowser();
    try {
      this._emitEvent('progress', { status: 'opening_page', message: '正在打開新頁面...' });
      const page = await browser.newPage();
      // 初始設定一個適中的視口大小，頁面加載後會自動調整
      await page.setViewport({ width: 1920, height: 1080 });
      this._emitEvent('progress', { status: 'setting_content', message: '正在設置 HTML 內容...' });
      await page.setContent(htmlContent, {
        waitUntil: this.options.waitUntil,
        timeout: this.options.timeout,
      });
      this._emitEvent('progress', { status: 'capturing_screenshot', message: '正在截取屏幕...' });
      await this._captureScreenshot(page, outputPath);
      this._emitEvent('complete', { status: 'success', message: `成功將 HTML 內容轉換為 ${outputPath}`, outputPath });
      console.log(`成功将 HTML 内容转换为 ${outputPath}`);
    } catch (error) {
      console.error('转换过程中发生错误:', error);
      this._emitEvent('error', { status: 'failed', message: '轉換過程中發生錯誤', error: error.message });
      throw error;
    } finally {
      this._emitEvent('progress', { status: 'closing_browser', message: '正在關閉瀏覽器...' });
      await browser.close();
    }
  }

  /**
   * 转换在线网页为 PNG
   * @param {string} url - 网页 URL
   * @param {string} outputPath - 输出 PNG 文件路径
   */
  async convertUrl(url, outputPath) {
    this._emitEvent('progress', { status: 'launching_browser', message: '正在啟動瀏覽器...' });
    const browser = await this._launchBrowser();
    try {
      this._emitEvent('progress', { status: 'opening_page', message: '正在打開新頁面...' });
      const page = await browser.newPage();
      // 初始設定一個適中的視口大小，頁面加載後會自動調整
      await page.setViewport({ width: 1920, height: 1080 });
      this._emitEvent('progress', { status: 'navigating_to_url', message: `正在導航到 URL: ${url}` });
      await page.goto(url, {
        waitUntil: this.options.waitUntil,
        timeout: this.options.timeout,
      });
      this._emitEvent('progress', { status: 'capturing_screenshot', message: '正在截取屏幕...' });
      await this._captureScreenshot(page, outputPath);
      this._emitEvent('complete', { status: 'success', message: `成功將 ${url} 轉換為 ${outputPath}`, outputPath });
      console.log(`成功将 ${url} 转换为 ${outputPath}`);
    } catch (error) {
      console.error('转换过程中发生错误:', error);
      this._emitEvent('error', { status: 'failed', message: '轉換過程中發生錯誤', error: error.message });
      throw error;
    } finally {
      this._emitEvent('progress', { status: 'closing_browser', message: '正在關閉瀏覽器...' });
      await browser.close();
    }
  }

  /**
   * 验证文件是否存在
   * @param {string} filePath - 文件路径
   */
  async _validateFileExists(filePath) {
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`文件不存在: ${filePath}`);
    }
  }

  /**
   * 启动浏览器实例
   */
  async _launchBrowser() {
    return puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  /**
   * 截取屏幕并保存为 PNG
   * @param {puppeteer.Page} page - 页面实例
   * @param {string} outputPath - 输出路径
   */
  async _captureScreenshot(page, outputPath) {
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    const ext = path.extname(outputPath).toLowerCase();
    const isPng = ext === '.png';
    
    const userSpecifiedFullPage = this.options.fullPageUserSpecified; // True if --full-page was passed
    const captureFullPageIntent = this.options.fullPage; // True if --full-page was passed, else false

    this._emitEvent('progress', { status: 'evaluating_page_dimensions', message: '正在評估頁面初始尺寸...' });
    
    // 1. 獲取頁面的初始實際尺寸 (用於設定優化視口)
    const initialDimensions = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const contentWidth = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
      
      const bodyScrollH = document.body.scrollHeight;
      const htmlScrollH = document.documentElement.scrollHeight;
      const htmlClientH = document.documentElement.clientHeight;
      let initialEvalContentH = bodyScrollH;
      if (htmlScrollH > bodyScrollH && htmlScrollH > htmlClientH) {
          initialEvalContentH = htmlScrollH;
      }
      initialEvalContentH = Math.max(initialEvalContentH, document.body.offsetHeight, document.documentElement.offsetHeight);

      const visibleWidth = Math.max(html.clientWidth || 0, window.innerWidth || 0);
      const visibleHeight = Math.max(html.clientHeight || 0, window.innerHeight || 0);
      let maxElementWidth = 0;
      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > maxElementWidth) maxElementWidth = rect.width;
      });
      return { contentWidth, contentHeight: initialEvalContentH, visibleWidth, visibleHeight, maxElementWidth, devicePixelRatio: window.devicePixelRatio || 1 };
    });

    // 2. 計算並設置初始優化視口
    const optimalInitialWidth = Math.min(Math.max(initialDimensions.contentWidth, initialDimensions.maxElementWidth, initialDimensions.visibleWidth, 800), 1920);
    const optimalInitialHeight = Math.max(initialDimensions.contentHeight, initialDimensions.visibleHeight, 600);
    
    console.log(`初始優化視口計算: width=${optimalInitialWidth}, height=${optimalInitialHeight}`);
    await page.setViewport({
      width: Math.floor(optimalInitialWidth),
      height: Math.floor(optimalInitialHeight),
      deviceScaleFactor: initialDimensions.devicePixelRatio
    });
    await new Promise(resolve => setTimeout(resolve, 200)); // 短暫等待渲染

    // 3. 執行滾動加載 (如果頁面很高)
    if (initialDimensions.contentHeight > initialDimensions.visibleHeight * 1.5) { // 僅當內容遠超一屏時滾動
        this._emitEvent('progress', { status: 'scroll_to_load_start', message: '開始滾動以加載完整頁面...' });
        let previousScrollHeight = 0;
        for (let i = 0; i < 10; i++) { // 減少滾動次數，加快速度
            const currentScrollHeight = await page.evaluate(() => document.body.scrollHeight);
            if (i > 0 && currentScrollHeight === previousScrollHeight) break;
            previousScrollHeight = currentScrollHeight;
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await new Promise(resolve => setTimeout(resolve, 300)); // 減少等待時間
        }
        this._emitEvent('progress', { status: 'scroll_to_load_complete', message: '滾動加載完成。' });
    }
    
    // 4. 獲取最終的、更詳細的頁面尺寸信息
    this._emitEvent('progress', { status: 'evaluating_final_dimensions', message: '正在評估最終頁面尺寸...' });
    const finalDimensions = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const contentWidth = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
      
      const bodyScrollHFinal = document.body.scrollHeight;
      const htmlScrollHFinal = document.documentElement.scrollHeight;
      const htmlClientHFinal = document.documentElement.clientHeight; // 當前視口高度
      let finalEvalContentHeight = bodyScrollHFinal;
      if (htmlScrollHFinal > bodyScrollHFinal && htmlScrollHFinal > htmlClientHFinal) {
          finalEvalContentHeight = htmlScrollHFinal;
      }
      finalEvalContentHeight = Math.max(finalEvalContentHeight, document.body.offsetHeight, document.documentElement.offsetHeight);

      const visibleWidth = Math.max(html.clientWidth || 0, window.innerWidth || 0);
      const visibleHeight = Math.max(html.clientHeight || 0, window.innerHeight || 0);
      
      let maxElementWidth = 0;
      let fixedWidthElementsInfo = [];
      document.querySelectorAll('*').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width > maxElementWidth) maxElementWidth = rect.width;
        const styles = window.getComputedStyle(el);
        const elWidthStyle = styles.width;
        const elMaxWidthStyle = styles.maxWidth;
        if ((elMaxWidthStyle && elMaxWidthStyle !== 'none' && !elMaxWidthStyle.includes('%') && !elMaxWidthStyle.includes('auto')) ||
            (elWidthStyle && !elWidthStyle.includes('%') && !elWidthStyle.includes('auto'))) {
          fixedWidthElementsInfo.push({ width: rect.width, tagName: el.tagName.toLowerCase() });
        }
      });
      
      const bodyStyles = window.getComputedStyle(body);
      const bodyMaxWidth = (bodyStyles.maxWidth && bodyStyles.maxWidth !== 'none' && bodyStyles.maxWidth !== '0px') ? parseInt(bodyStyles.maxWidth) : 0;
      const isBodyCentered = bodyStyles.marginLeft === bodyStyles.marginRight && bodyStyles.marginLeft === 'auto';
      
      return {
        contentWidth: Math.floor(contentWidth),
        contentHeight: Math.floor(finalEvalContentHeight),
        visibleWidth: Math.floor(visibleWidth),
        visibleHeight: Math.floor(visibleHeight),
        maxElementWidth: Math.floor(maxElementWidth),
        bodyMaxWidth: Math.floor(bodyMaxWidth),
        isBodyCentered,
        fixedWidthElementsInfo, // [{width, tagName}]
        devicePixelRatio: window.devicePixelRatio || 1
      };
    });
    console.log(`最終頁面尺寸評估: contentW=${finalDimensions.contentWidth}, contentH=${finalDimensions.contentHeight}, visibleH=${finalDimensions.visibleHeight}, bodyMaxW=${finalDimensions.bodyMaxWidth}, centered=${finalDimensions.isBodyCentered}`);

    // 5. 計算用於截圖的有效內容寬度 (更精確)
    let effectiveContentWidth = finalDimensions.contentWidth;
    if (finalDimensions.bodyMaxWidth > 0 && finalDimensions.bodyMaxWidth < effectiveContentWidth) {
        effectiveContentWidth = finalDimensions.bodyMaxWidth;
        console.log(`使用 body.maxWidth (${finalDimensions.bodyMaxWidth}px) 作為有效內容寬度`);
    } else if (finalDimensions.fixedWidthElementsInfo.length > 0) {
        const mainContentElement = finalDimensions.fixedWidthElementsInfo
            .filter(el => el.tagName !== 'html' && el.tagName !== 'body' && el.width > 0 && el.width < finalDimensions.contentWidth * 0.9)
            .sort((a,b) => b.width - a.width)[0];
        if (mainContentElement) {
            effectiveContentWidth = mainContentElement.width;
            console.log(`使用最寬固定元素 ${mainContentElement.tagName} (${mainContentElement.width}px) 作為有效內容寬度`);
        }
    }
    effectiveContentWidth = Math.max(effectiveContentWidth, 320); // 確保一個最小寬度
    console.log(`最終有效內容寬度計算為: ${effectiveContentWidth}px`);
    
    // 6. 準備分割截圖或單張截圖
    let pageContainersData = [];
    let selectorForSplitting = this.options.splitSelector;
    if (selectorForSplitting === null || selectorForSplitting === undefined) selectorForSplitting = '.page-container'; // CLI default

    const isSplitSelectorProvided = selectorForSplitting && typeof selectorForSplitting === 'string' && selectorForSplitting.trim() !== '';
    
    if (isSplitSelectorProvided) {
        pageContainersData = await page.$$eval(selectorForSplitting, elements =>
            elements.map(el => {
                const rect = el.getBoundingClientRect();
                return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
            })
        ).catch(() => []); // Return empty on error
        if (pageContainersData.length > 0) {
            console.log(`找到 ${pageContainersData.length} 個元素用於分割 (選擇器: "${selectorForSplitting}")`);
        } else {
            console.log(`選擇器 "${selectorForSplitting}" 未找到任何元素，將執行單張截圖。`);
        }
    }
    
    const isSplitModeActive = pageContainersData && pageContainersData.length > 0;

    // 7. 設置最終用於截圖的視口
    // 對於分割模式，視口需要足夠大以包含所有元素；對於單張模式，視口根據截圖意圖調整。
    let finalViewportWidth = Math.max(effectiveContentWidth, finalDimensions.visibleWidth, 800); // 確保視口至少是有效內容寬或可見寬
    finalViewportWidth = Math.min(finalViewportWidth, 2560); // 限制一個實際的最大值
    
    let finalViewportHeight;
    if (isSplitModeActive) {
        finalViewportHeight = finalDimensions.contentHeight; // 需要能看到所有分割元素
    } else {
        if (captureFullPageIntent) { // --full-page
            finalViewportHeight = finalDimensions.contentHeight;
        } else { // 首屏
            finalViewportHeight = finalDimensions.visibleHeight;
        }
    }
    finalViewportHeight = Math.max(finalViewportHeight, 600); // 最小高度
    
    console.log(`設置最終截圖視口: width=${Math.floor(finalViewportWidth)}, height=${Math.floor(finalViewportHeight)}`);
    await page.setViewport({
        width: Math.floor(finalViewportWidth),
        height: Math.floor(finalViewportHeight),
        deviceScaleFactor: finalDimensions.devicePixelRatio
    });
    await new Promise(resolve => setTimeout(resolve, 300)); // 等待渲染

    // 8. 執行截圖
    const screenshotCommonOptions = {
        type: isPng ? 'png' : 'jpeg',
        omitBackground: this.options.omitBackground,
    };
    if (!isPng) screenshotCommonOptions.quality = this.options.quality;

    if (isSplitModeActive) {
        this._emitEvent('progress', { status: 'split_screenshot_start', count: pageContainersData.length });
        const capturedFilePaths = [];
        for (let i = 0; i < pageContainersData.length; i++) {
            const container = pageContainersData[i];
            if (container.width <= 0 || container.height <= 0) continue;

            const partPath = outputPath.replace(ext, `_part_${i}${ext}`);
            try {
                await page.screenshot({
                    ...screenshotCommonOptions,
                    path: partPath,
                    clip: {
                        x: Math.floor(container.x),
                        y: Math.floor(container.y),
                        width: Math.floor(container.width),
                        height: Math.floor(container.height)
                    }
                });
                capturedFilePaths.push(partPath);
                this._emitEvent('progress', { status: 'part_captured', part: i + 1, totalParts: pageContainersData.length, partPath });
            } catch (e) { /* ... error handling ... */ }
        }
        // ... (完成事件)
    } else { // 單張截圖模式
        this._emitEvent('progress', { status: 'single_screenshot_start' });
        const currentVp = page.viewport(); // 獲取剛設定的最終視口
        let clip = null;

        // 寬度裁剪邏輯
        const contentDisplayWidth = Math.floor(effectiveContentWidth); // 我們認為的內容應該顯示的寬度
        let clipX = 0;
        let clipWidth = contentDisplayWidth;

        if (contentDisplayWidth < currentVp.width) {
            if (finalDimensions.isBodyCentered && finalDimensions.bodyMaxWidth > 0 && contentDisplayWidth <= finalDimensions.bodyMaxWidth) {
                clipX = Math.floor((currentVp.width - contentDisplayWidth) / 2);
            }
            // 如果 clipWidth 已經是 effectiveContentWidth，它就是我們要的內容寬度
        } else {
             // 內容不比視口窄，則截取整個視口寬度
            clipWidth = currentVp.width;
        }
        
        // 高度裁剪邏輯
        let clipY = 0;
        let clipHeight;

        if (captureFullPageIntent) { // --full-page
            clipHeight = finalDimensions.contentHeight; // 全高
        } else { // 首屏
            // 截取當前視口的高度，但如果內容實際更短，則用內容高度
            clipHeight = Math.min(currentVp.height, finalDimensions.contentHeight);
        }
        clipHeight = Math.max(clipHeight, 1); // 確保高度至少為1

        // 判斷是否真的需要 clip
        // 如果目標截圖區域與當前視口完全一樣，則不使用 clip，讓 fullPage 選項決定行為
        const needsClip = 
            Math.floor(clipX) !== 0 || 
            Math.floor(clipWidth) < currentVp.width ||
            (!captureFullPageIntent && Math.floor(clipHeight) < currentVp.height);

        if (needsClip) {
            clip = {
                x: Math.floor(clipX),
                y: Math.floor(clipY),
                width: Math.floor(clipWidth),
                height: Math.floor(clipHeight)
            };
            // 確保 clip 不超出頁面邊界 (雖然 x,y 通常是0)
            clip.width = Math.min(clip.width, finalDimensions.contentWidth - clip.x);
            clip.height = Math.min(clip.height, finalDimensions.contentHeight - clip.y);

            if (clip.width <=0 || clip.height <=0) {
                console.log(`計算出的Clip尺寸無效 (${clip.width}x${clip.height})，取消Clip。`);
                clip = null;
            } else {
                 console.log(`應用精確 Clip: x=${clip.x} y=${clip.y} w=${clip.width} h=${clip.height}`);
            }
        }
        
        const finalScreenshotOptions = {
            ...screenshotCommonOptions,
            path: outputPath,
            fullPage: captureFullPageIntent // 讓 fullPage 意圖先設定
        };

        if (clip) {
            finalScreenshotOptions.clip = clip;
            // 當 clip 被提供時，fullPage 選項通常被忽略或應設為 false。
            // 但如果我們的 clip 高度是 contentHeight，我們其實是想在指定寬度下截全長。
            // Puppeteer 文檔："When clip is provided, the fullPage option is ignored."
            // 這意味著，如果我們提供了 clip，無論 fullPage 是 true 還是 false，行為都由 clip 控制。
            // 如果 clip.height 是 contentHeight，它就會截取那個區域的全部高度。
            // 如果 clip.height 是 visibleHeight，它就會截取那個區域的特定高度。
            // 所以，fullPage: captureFullPageIntent 放在這裡可以，clip 會優先。
        }
        
        console.log(`最終截圖選項: fullPage=${finalScreenshotOptions.fullPage}, clip=${JSON.stringify(finalScreenshotOptions.clip)}`);

        try {
            await page.screenshot(finalScreenshotOptions);
            this._emitEvent('progress', { status: 'single_screenshot_captured', outputPath });
            console.log(`成功截取圖片到 ${outputPath}`);
        } catch (e) {
            console.error(`截取單張圖片到 ${outputPath} 時出錯:`, e);
            this._emitEvent('warning', { status: 'single_screenshot_error', error: e.message });
        }
    }
  }
}

/**
 * 處理整個目錄中的HTML文件
 * @param {string} folderPath - 目錄路徑
 * @param {string} outputDir - 輸出目錄路徑
 * @param {object} commonConverterOptions - 通用的轉換選項 (會傳遞給每個文件的轉換器)
 * @param {EventEmitter} [folderEventEmitter=null] - 用於發送文件夾級別進度事件的 EventEmitter
 * @param {string} [folderConversionId=null] - 用於文件夾級別事件的轉換 ID
 */
async function processFolderHtml(folderPath, outputDir, commonConverterOptions = {}, folderEventEmitter = null, folderConversionId = null) {
  
  const emitFolderEvent = (eventName, data) => {
    if (folderEventEmitter && folderConversionId) {
      folderEventEmitter.emit(folderConversionId, { eventName, ...data });
    }
  };

  try {
    emitFolderEvent('progress', { status: 'folder_processing_started', message: `開始處理文件夾: ${folderPath}`, inputFolderPath: folderPath, outputDir });
    // 檢查目錄是否存在
    await fs.access(folderPath);
    
    // 讀取目錄中的所有文件
    const files = await fs.readdir(folderPath);
    const htmlFiles = files.filter(file => 
      file.endsWith('.html') || file.endsWith('.htm')
    );
    
    if (htmlFiles.length === 0) {
      console.error(`錯誤: 在 ${folderPath} 中未找到 HTML 文件`);
      return;
    }
    
    console.log(`找到 ${htmlFiles.length} 個 HTML 文件，開始處理...`);
    emitFolderEvent('progress', { status: 'folder_scan_complete', message: `在 ${folderPath} 中找到 ${htmlFiles.length} 個 HTML 文件。`, count: htmlFiles.length });
    
    // 確保輸出目錄存在
    await fs.mkdir(outputDir, { recursive: true });
    
    // 處理每個HTML文件
    for (let i = 0; i < htmlFiles.length; i++) {
      const file = htmlFiles[i];
      const inputPath = path.join(folderPath, file);
      const fileContext = { inputPath, originalFileName: file };

      // 從文件名生成輸出路徑 (保持原始檔案名，但改變擴展名為.png)
      const fileName = path.basename(file, path.extname(file));
      const outputPath = path.join(outputDir, `${fileName}.png`);
      fileContext.outputPath = outputPath; // Add outputPath to context
      
      console.log(`[${i + 1}/${htmlFiles.length}] 處理: ${file} -> ${outputPath}`);
      emitFolderEvent('progress', {
        status: 'processing_file_start',
        message: `[${i + 1}/${htmlFiles.length}] 開始處理: ${file} -> ${outputPath}`,
        currentFile: file,
        currentIndex: i + 1,
        totalFiles: htmlFiles.length,
        fileContext 
      });
      
      try {
        // 為每個文件創建一個新的轉換器實例
        // 這樣可以將文件特定的上下文（如 inputPath, outputPath）傳遞給事件
        const converter = new HtmlToPngConverter({
          ...commonConverterOptions, // 通用選項
          eventEmitter: folderEventEmitter, // 使用文件夾的事件發射器
          conversionId: folderConversionId, // 使用文件夾的轉換ID
          fileContext // 包含當前文件信息的上下文
        });
        await converter.convertFile(inputPath, outputPath);
        emitFolderEvent('progress', {
          status: 'processing_file_complete',
          message: `[${i + 1}/${htmlFiles.length}] 完成處理: ${file}`,
          currentFile: file,
          currentIndex: i + 1,
          totalFiles: htmlFiles.length,
          fileContext,
          result: 'success'
        });
      } catch (error) {
        console.error(`轉換 ${file} 時出錯:`, error.message);
        emitFolderEvent('error', { // Note: this is an 'error' event for the folder conversion itself
          status: 'file_conversion_failed',
          message: `轉換 ${file} 時出錯: ${error.message}`,
          currentFile: file,
          currentIndex: i + 1,
          totalFiles: htmlFiles.length,
          fileContext,
          error: error.message,
          result: 'failed'
        });
      }
    }
    
    console.log(`目錄處理完成. 共處理了 ${htmlFiles.length} 個文件.`);
    emitFolderEvent('complete', { status: 'folder_processing_complete', message: `文件夾 ${folderPath} 處理完成，共處理 ${htmlFiles.length} 個文件。`, inputFolderPath: folderPath, outputDir, totalFilesProcessed: htmlFiles.length });

  } catch (error) {
    console.error(`處理目錄時出錯:`, error.message);
    emitFolderEvent('error', { status: 'folder_processing_error', message: `處理文件夾 ${folderPath} 時發生嚴重錯誤: ${error.message}`, inputFolderPath: folderPath, error: error.message });
    throw error;
  }
}

// 命令行工具实现
async function cli() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = parseCommandLineArgs(args);

  const converter = new HtmlToPngConverter(options);

  try {
    switch (command) {
      case 'file':
        await converter.convertFile(options.input, options.output);
        break;
      case 'url':
        await converter.convertUrl(options.input, options.output);
        break;
      case 'html':
        const htmlContent = await fs.readFile(options.input, 'utf-8');
        await converter.convertHtmlString(htmlContent, options.output);
        break;
      case 'folder':
        // 對於 folder 命令，options.output 代表輸出目錄
        await processFolderHtml(options.input, options.output, options);
        break;
      default:
        printUsage();
    }
  } catch (error) {
    console.error('程序执行失败:', error.message);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 * @param {string[]} args - 命令行参数
 */
function parseCommandLineArgs(args) {
  const options = {
    input: '',
    output: 'output.png',
    format: 'A4',
    quality: 100,
    fullPage: false,
    fullPageUserSpecified: false,
    omitBackground: false,
    waitUntil: 'networkidle0',
    timeout: 30000,
    splitSelector: '.page-container',
  };

  let currentCommand = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === 'file' || arg === 'url' || arg === 'html' || arg === 'folder') {
      currentCommand = arg;
      options.input = args[i + 1];
      i++;
    } else if (arg === '-o' || arg === '--output') {
      options.output = args[i + 1];
      i++;
    } else if (arg === '-f' || arg === '--format') {
      options.format = args[i + 1];
      i++;
    } else if (arg === '-q' || arg === '--quality') {
      options.quality = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--full-page') {
      options.fullPage = true;
      options.fullPageUserSpecified = true;
    } else if (arg === '--omit-background') {
      options.omitBackground = true;
    } else if (arg === '-s') {
      options.splitSelector = args[i + 1];
      i++;
    } else if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    }
  }

  if (!options.input) {
    console.error('错误: 缺少输入参数');
    printUsage();
    process.exit(1);
  }
  
  // 對於folder命令，如果沒有指定輸出，使用默認的output_images目錄
  if (currentCommand === 'folder' && options.output === 'output.png') {
    options.output = 'output_images';
  }

  return options;
}

/**
 * 打印使用帮助
 */
function printUsage() {
  console.log(`
HTML 转 PNG 工具

用法:
  node html-to-png.js file <input.html> [选项]
  node html-to-png.js url <网页URL> [选项]
  node html-to-png.js html <包含HTML的文件> [选项]
  node html-to-png.js folder <目錄路徑> [选项]

选项:
  -o, --output <路径>        輸出路徑:
                            - 對於 file/url/html 命令: 輸出PNG文件路徑 (默認: output.png)
                            - 對於 folder 命令: 輸出目錄路徑 (默認: output_images)
  -f, --format <格式>        頁面格式 (如: A4, Letter等)
  -q, --quality <质量>       圖片質量 (0-100)
      --full-page            捕獲整個頁面
      --omit-background      不包含背景
  -s <CSS選擇器>           用於將截圖分割成多個文件的CSS選擇器 (默認: '.page-container')
  -h, --help                 顯示此幫助信息

示例:
  # 轉換單個HTML文件
  node html-to-png.js file page.html -o result.png
  
  # 轉換遠程URL為JPEG
  node html-to-png.js url https://example.com -o website.jpeg -q 85
  
  # 處理整個資料夾中的HTML文件 (保持原文件名，但改為PNG格式)
  node html-to-png.js folder ./html_files -o ./output_images
  # 上面命令的輸出文件將是: ./output_images/file1.png, ./output_images/file2.png 等
`);
}

// 如果作为脚本直接运行，则执行命令行工具
if (require.main === module) {
  cli();
}

// 导出模块供其他程序使用
module.exports = {
  HtmlToPngConverter,
  processFolderHtml,
};    