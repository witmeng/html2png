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
      omitBackground: false,
      waitUntil: 'networkidle0',
      timeout: 90000,
      splitSelector: null,
      eventEmitter: null,
      conversionId: null,
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
      this.options.eventEmitter.emit(this.options.conversionId, { eventName, ...data });
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
      await page.setViewport({ width: 1080, height: 10800 });
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
    await fs.mkdir(outputDir, { recursive: true }); // Ensure dir exists

    const ext = path.extname(outputPath).toLowerCase();
    const isPng = ext === '.png';
    const originalFullPageOptionFromUser = this.options.fullPage;

    this._emitEvent('progress', { status: 'scroll_to_load_start', message: '開始滾動以加載完整頁面...' });
    // --- Scroll-to-load logic ---
    const initialViewportWidth = page.viewport().width;
    let previousScrollHeight = 0;
    console.log("開始滾動加載以確保所有頁面內容均已渲染...");
    for (let i = 0; i < 30; i++) {
        const currentScrollHeight = await page.evaluate(() => document.body.scrollHeight);
        if (i > 0 && currentScrollHeight === previousScrollHeight) {
            console.log("滾動高度已穩定。假定所有內容已加載完畢。");
            break;
        }
        previousScrollHeight = currentScrollHeight;
        await page.setViewport({
            width: initialViewportWidth,
            height: Math.max(currentScrollHeight, page.viewport()?.height || 0, 1080)
        });
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (i === 29) {
            console.log("已達到最大滾動迭代次數。");
        }
    }
    const finalScrollHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({
        width: initialViewportWidth,
        height: Math.max(finalScrollHeight, page.viewport()?.height || 0, 1080)
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    this._emitEvent('progress', { status: 'scroll_to_load_complete', message: `滾動加載完成。最終視口高度: ${page.viewport()?.height}` });
    console.log(`滾動加載完成。最終視口高度: ${page.viewport()?.height}`);
    // --- End of scroll-to-load logic ---

    let pageContainersData = [];
    let selectorForSplitting = this.options.splitSelector;

    // 強制確保在 selectorForSplitting 為 null 或 undefined 時，使用 '.page-container' 作為 CLI 的後備默認值
    if (selectorForSplitting === null || selectorForSplitting === undefined) {
        console.log("[修正] 分割選擇器為 null/undefined，將嘗試使用默認的 '.page-container'。");
        selectorForSplitting = '.page-container';
    }

    if (selectorForSplitting && typeof selectorForSplitting === 'string' && selectorForSplitting.trim() !== '') {
        console.log(`嘗試使用選擇器 "${selectorForSplitting}" 查找用於分割的元素...`);
        this._emitEvent('progress', { status: 'evaluating_split_selector', message: `正在評估分割選擇器: ${selectorForSplitting}` });
        pageContainersData = await page.$$eval(selectorForSplitting, (elements) =>
            elements.map(el => {
                const rect = el.getBoundingClientRect();
                return {
                    x: rect.x + window.scrollX,
                    y: rect.y + window.scrollY,
                    width: rect.width,
                    height: rect.height,
                };
            })
        ).catch(err => {
            console.error(`使用選擇器 "${selectorForSplitting}" 查找元素時出錯:`, err);
            this._emitEvent('warning', { status: 'split_selector_error', message: `使用選擇器 "${selectorForSplitting}" 查找元素時出錯`, error: err.message });
            return []; // On error, return empty array, fallback to single screenshot
        });
    } else {
        console.log("未提供用於分割的選擇器，或選擇器為空。");
        this._emitEvent('progress', { status: 'no_split_selector', message: '未提供分割選擇器，將進行單張截圖。' });
    }

    if (pageContainersData && pageContainersData.length > 0) {
        console.log(`找到 ${pageContainersData.length} 個元素 (基於 "${selectorForSplitting}")。將分別進行截圖。`);
        this._emitEvent('progress', { status: 'split_screenshot_start', message: `找到 ${pageContainersData.length} 個元素，開始分割截圖。`, count: pageContainersData.length });
        const capturedFilePaths = [];
        for (let i = 0; i < pageContainersData.length; i++) {
            const containerClip = pageContainersData[i];
            
            if (containerClip.width <= 0 || containerClip.height <= 0) {
                console.warn(`跳過 .page-container 部分 ${i}，因為其尺寸無效: width=${containerClip.width}, height=${containerClip.height}, x=${containerClip.x}, y=${containerClip.y}`);
                continue;
            }

            const partPath = outputPath.replace(ext, `_part_${i}${ext}`);
            const screenshotOptions = {
                path: partPath,
                type: isPng ? 'png' : 'jpeg',
                clip: { // These are document-relative coordinates
                    x: Math.max(0, containerClip.x), // Ensure x,y are not negative
                    y: Math.max(0, containerClip.y),
                    width: containerClip.width,
                    height: containerClip.height,
                },
                omitBackground: this.options.omitBackground, // User option
            };
            if (!isPng) {
                screenshotOptions.quality = this.options.quality; // User option
            }

            try {
                this._emitEvent('progress', { status: 'capturing_part', message: `正在截取部分 ${i + 1}/${pageContainersData.length}...`, part: i, totalParts: pageContainersData.length, partPath });
                await page.screenshot(screenshotOptions);
                console.log(`成功截取部分 ${i} 到 ${partPath}`);
                this._emitEvent('progress', { status: 'part_captured', message: `成功截取部分 ${i + 1} 到 ${partPath}`, part: i, totalParts: pageContainersData.length, partPath });
                capturedFilePaths.push(partPath);
            } catch (clipError) {
                console.error(`截取 .page-container 部分 ${i} 到 ${partPath} 時出錯:`, clipError);
                console.error(`裁剪區域詳情: x=${screenshotOptions.clip.x}, y=${screenshotOptions.clip.y}, width=${screenshotOptions.clip.width}, height=${screenshotOptions.clip.height}`);
                this._emitEvent('warning', { status: 'part_capture_error', message: `截取部分 ${i + 1} 失敗: ${partPath}`, error: clipError.message, part: i, partPath });
            }
        }
        if (capturedFilePaths.length > 0) {
             this._emitEvent('progress', { status: 'all_parts_processed', message: '所有部分截圖處理完成。', filePaths: capturedFilePaths});
        } else if (pageContainersData.length > 0 && capturedFilePaths.length === 0) {
             this._emitEvent('warning', { status: 'no_parts_captured', message: '已指定分割截圖，但沒有任何部分被成功截取。'});
        }

    } else {
        console.log("未找到 .page-container 元素或查找過程中出錯。將執行單個截圖操作。");
        this._emitEvent('progress', { status: 'single_screenshot_start', message: '開始單張截圖。' });
        // Fallback to original single screenshot logic
        const screenshotOptions = {
            path: outputPath,
            type: isPng ? 'png' : 'jpeg',
            fullPage: originalFullPageOptionFromUser, // Use the user's original fullPage setting
            omitBackground: this.options.omitBackground,
        };
        // Apply original clip if it was specified and not doing fullPage
        if (this.options.clip && !originalFullPageOptionFromUser) {
            screenshotOptions.clip = this.options.clip;
        }
        if (!isPng) {
            screenshotOptions.quality = this.options.quality;
        }

        try {
            await page.screenshot(screenshotOptions);
            console.log(`成功截取單個圖片到 ${outputPath}`);
            this._emitEvent('progress', { status: 'single_screenshot_captured', message: `成功截取單張圖片到 ${outputPath}`, outputPath });
        } catch (singleScreenshotError) {
            console.error(`截取單個圖片到 ${outputPath} 時出錯:`, singleScreenshotError);
            this._emitEvent('warning', { status: 'single_screenshot_error', message: `截取單張圖片失敗: ${outputPath}`, error: singleScreenshotError.message });
        }
    }
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
    omitBackground: false,
    waitUntil: 'networkidle0',
    timeout: 30000,
    splitSelector: '.page-container',
  };

  let currentCommand = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === 'file' || arg === 'url' || arg === 'html') {
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

选项:
  -o, --output <路径>        输出PNG文件路径 (默认: output.png)
  -f, --format <格式>        页面格式 (如: A4, Letter等)
  -q, --quality <质量>       图片质量 (0-100)
      --full-page            捕获整个页面
      --omit-background      不包含背景
  -s <CSS選擇器>           用於將截圖分割成多個文件的CSS選擇器 (默認: '.page-container')
  -h, --help                 显示此帮助信息
`);
}

// 如果作为脚本直接运行，则执行命令行工具
if (require.main === module) {
  cli();
}

// 导出模块供其他程序使用
module.exports = {
  HtmlToPngConverter,
};    