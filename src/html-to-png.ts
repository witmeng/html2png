import puppeteer, { type Page, type Browser, type ScreenshotOptions, type PuppeteerLifeCycleEvent, type Viewport, type LaunchOptions } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import OSS from 'ali-oss';
import { mcpLog } from './log.js';

// --- Interfaces and Types ---

interface FileContext {
  inputPath: string;
  originalFileName: string;
  outputPath: string;
}

export interface ConverterOptions {
  format: string;
  quality: number;
  fullPage: boolean;
  fullPageUserSpecified: boolean;
  omitBackground: boolean;
  waitUntil: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[];
  timeout: number;
  splitSelector: string | null;
  eventEmitter: EventEmitter | null;
  conversionId: string | null;
  fileContext: FileContext | null;
}

interface PageDimensions {
  contentWidth: number;
  contentHeight: number;
  visibleWidth: number;
  visibleHeight: number;
  maxElementWidth?: number; // Only in initialDimensions
  bodyMaxWidth?: number; // Only in finalDimensions
  isBodyCentered?: boolean; // Only in finalDimensions
  fixedWidthElementsInfo?: Array<{ width: number; tagName: string }>; // Only in finalDimensions
  devicePixelRatio: number;
}

interface SplitElementData {
  x: number;
  y: number;
  width: number;
  height: number;
}

// interface CliOptions extends Partial<ConverterOptions> {
//   input: string;
//   output: string; // For folder command, this is outputDir
// }

let ossClient: any = null;
let ossAvailable = true;

// ali-oss 初始化時，檢查並在oss /html2png 目錄


function getOssEndpoint(): string | undefined {
  // 僅當 ALI_OSS_ENDPOINT 未設置時才自動推導
  if (process.env.ALI_OSS_ENDPOINT) {
    mcpLog('info', `[OSS] 使用顯式設置的 endpoint: ${process.env.ALI_OSS_ENDPOINT}`);
    return process.env.ALI_OSS_ENDPOINT;
  }
  let baseUrl = process.env.OSS_EXPECTED_BASE_URL;
  if (baseUrl) {
    if (!/^https?:\/\//.test(baseUrl)) {
      baseUrl = 'https://' + baseUrl;
    }
    try {
      const url = new URL(baseUrl);
      mcpLog('info', `[OSS] 從 OSS_EXPECTED_BASE_URL 自動推導 endpoint: ${url.host}`);
      return url.host;
    } catch (e) {
      mcpLog('error', `[OSS] 解析 OSS_EXPECTED_BASE_URL 失敗: ${e}`);
    }
  }
  return undefined;
}

try {
  ossClient = new OSS({
    region: process.env.ALI_OSS_REGION!,
    accessKeyId: process.env.ALI_OSS_KEY!,
    accessKeySecret: process.env.ALI_OSS_SECRET!,
    bucket: process.env.ALI_OSS_BUCKET!,
    endpoint: getOssEndpoint()!,
  });
  mcpLog('info', '[OSS] ali-oss 初始化成功');
  mcpLog('info', `[OSS ENV] ALI_OSS_REGION: ${process.env.ALI_OSS_REGION}`);
  mcpLog('info', `[OSS ENV] ALI_OSS_KEY: ${process.env.ALI_OSS_KEY}`);
  mcpLog('info', `[OSS ENV] ALI_OSS_SECRET: ${process.env.ALI_OSS_SECRET ? '***' : undefined}`);
  mcpLog('info', `[OSS ENV] ALI_OSS_BUCKET: ${process.env.ALI_OSS_BUCKET}`);
  mcpLog('info', `[OSS ENV] ALI_OSS_ENDPOINT: ${process.env.ALI_OSS_ENDPOINT}`);
  mcpLog('info', `[OSS ENV] OSS_EXPECTED_BASE_URL: ${process.env.OSS_EXPECTED_BASE_URL}`);
  // 初始化 OSS 目錄
  (async () => {
    try {
      await ossClient.put('html2png/', Buffer.from(''));
      mcpLog('info', '[OSS] 已在 OSS 上建立 html2png 目錄');
    } catch (e) {
      mcpLog('error', `[OSS] 建立 html2png 目錄失敗: ${e}`);
    }
  })();
} catch (e: any) {
  ossAvailable = false;
  mcpLog('error', `[OSS] ali-oss 初始化失敗: ${e?.message || e}`);
}
const ossExpectedBaseUrl = process.env.OSS_EXPECTED_BASE_URL;

function getOssRemotePath(localPath: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateDir = `${yyyy}${mm}${dd}`;
  return `html2png/${dateDir}/${path.basename(localPath)}`;
}

async function uploadToOss(localPath: string, remotePath?: string): Promise<string> {
  if (!ossAvailable || !ossClient) {
    mcpLog('info', '[OSS] OSS 未初始化，跳過上傳');
    return '';
  }
  // 上傳前檢查檔案存在
  try {
    await fs.access(localPath);
  } catch (e) {
    mcpLog('error', `[OSS] 檔案不存在，無法上傳: ${localPath}`);
    throw new Error(`[OSS] 檔案不存在，無法上傳: ${localPath}`);
  }
  const ossPath = remotePath || getOssRemotePath(localPath);
  const result = await ossClient.put(ossPath, localPath);
  if (ossExpectedBaseUrl) {
    const base = ossExpectedBaseUrl.replace(/\/+$/, '');
    return `${base}/${ossPath}`;
  }
  return result.url;
}

/**
 * HTML 转 PNG 工具类
 */
export class HtmlToPngConverter {
  private options: ConverterOptions;

  constructor(options: Partial<ConverterOptions> = {}) {
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
   * @param eventName - 事件名稱 (例如 'progress', 'error', 'complete')
   * @param data - 事件數據
   */
  private _emitEvent(eventName: string, data: object): void {
    if (this.options.eventEmitter && this.options.conversionId) {
      const eventPayload: { eventName: string, fileContext?: FileContext } & object = { eventName, ...data };
      if (this.options.fileContext) {
        eventPayload.fileContext = this.options.fileContext;
      }
      this.options.eventEmitter.emit(this.options.conversionId, eventPayload);
    }
  }

  /**
   * 将 HTML 文件转换为 PNG
   * @param htmlFilePath - HTML 文件路径
   * @param outputPath - 输出 PNG 文件路径
   */
  async convertFile(htmlFilePath: string, outputPath: string): Promise<{ localPaths: string[], ossUrls: string[] }> {
    const absolutePath = path.resolve(htmlFilePath);
    await this._validateFileExists(absolutePath);
    this._emitEvent('progress', { status: 'launching_browser', message: '正在啟動瀏覽器...' });
    const browser = await this._launchBrowser();
    const localPaths: string[] = [];
    const ossUrls: string[] = [];
    try {
      this._emitEvent('progress', { status: 'opening_page', message: '正在打開新頁面...' });
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 }); // Initial moderate viewport
      this._emitEvent('progress', { status: 'navigating_to_file', message: `正在導航到文件: ${absolutePath}` });
      await page.goto(`file://${absolutePath}`, {
        waitUntil: this.options.waitUntil,
        timeout: this.options.timeout,
      });
      this._emitEvent('progress', { status: 'capturing_screenshot', message: '正在截取屏幕...' });
      await this._captureScreenshot(page, outputPath);
      localPaths.push(outputPath);
      // 新增：如果有分割，localPaths 會有多個檔案
      // 檢查是否有分割檔案
      const ext = path.extname(outputPath);
      const base = outputPath.replace(ext, '');
      let partIndex = 0;
      while (true) {
        const partPath = `${base}_part_${partIndex}${ext}`;
        try {
          await fs.access(partPath);
          if (!localPaths.includes(partPath)) localPaths.push(partPath);
          partIndex++;
        } catch {
          break;
        }
      }
      // 上傳所有 localPaths
      for (const filePath of localPaths) {
        try {
          const ossUrl = await uploadToOss(filePath);
          if (ossUrl) ossUrls.push(ossUrl);
        } catch (e) {
          mcpLog('error', `[OSS] 上傳失敗: ${filePath}，錯誤: ${e}`);
        }
      }
      this._emitEvent('complete', { status: 'success', message: `成功將 ${htmlFilePath} 轉換為 ${outputPath}`, outputPath, ossUrls });
      mcpLog('info', `成功將 ${htmlFilePath} 轉換為 ${outputPath}`);
      return { localPaths, ossUrls };
    } catch (error: any) {
      mcpLog('error', '轉換過程中發生錯誤: ' + error);
      if (error && error.stack) mcpLog('error', error.stack);
      this._emitEvent('error', { status: 'failed', message: '轉換過程中發生錯誤', error: error.message });
      throw error;
    } finally {
      this._emitEvent('progress', { status: 'closing_browser', message: '正在關閉瀏覽器...' });
      await browser.close();
    }
  }

  /**
   * 将 HTML 字符串转换为 PNG
   * @param htmlContent - HTML 内容
   * @param outputPath - 输出 PNG 文件路径
   */
  async convertHtmlString(htmlContent: string, outputPath: string): Promise<{ localPaths: string[], ossUrls: string[] }> {
    this._emitEvent('progress', { status: 'launching_browser', message: '正在啟動瀏覽器...' });
    const browser = await this._launchBrowser();
    const localPaths: string[] = [];
    const ossUrls: string[] = [];
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
      localPaths.push(outputPath);
      // 新增：如果有分割，localPaths 會有多個檔案
      const ext = path.extname(outputPath);
      const base = outputPath.replace(ext, '');
      let partIndex = 0;
      while (true) {
        const partPath = `${base}_part_${partIndex}${ext}`;
        try {
          await fs.access(partPath);
          if (!localPaths.includes(partPath)) localPaths.push(partPath);
          partIndex++;
        } catch {
          break;
        }
      }
      // 上傳所有 localPaths
      for (const filePath of localPaths) {
        try {
          const ossUrl = await uploadToOss(filePath);
          if (ossUrl) ossUrls.push(ossUrl);
        } catch (e) {
          mcpLog('error', `[OSS] 上傳失敗: ${filePath}，錯誤: ${e}`);
        }
      }
      this._emitEvent('complete', { status: 'success', message: `成功將 HTML 內容轉換為 ${outputPath}`, outputPath, ossUrls });
      mcpLog('info', `成功將 HTML 內容轉換為 ${outputPath}`);
      return { localPaths, ossUrls };
    } catch (error: any) {
      mcpLog('error', '轉換過程中發生錯誤: ' + error);
      if (error && error.stack) mcpLog('error', error.stack);
      this._emitEvent('error', { status: 'failed', message: '轉換過程中發生錯誤', error: error.message });
      throw error;
    } finally {
      this._emitEvent('progress', { status: 'closing_browser', message: '正在關閉瀏覽器...' });
      await browser.close();
    }
  }

  /**
   * 转换在线网页为 PNG
   * @param url - 网页 URL
   * @param outputPath - 输出 PNG 文件路径
   */
  async convertUrl(url: string, outputPath: string): Promise<{ localPaths: string[], ossUrls: string[] }> {
    this._emitEvent('progress', { status: 'launching_browser', message: '正在啟動瀏覽器...' });
    const browser = await this._launchBrowser();
    const localPaths: string[] = [];
    const ossUrls: string[] = [];
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
      localPaths.push(outputPath);
      // 新增：如果有分割，localPaths 會有多個檔案
      const ext = path.extname(outputPath);
      const base = outputPath.replace(ext, '');
      let partIndex = 0;
      while (true) {
        const partPath = `${base}_part_${partIndex}${ext}`;
        try {
          await fs.access(partPath);
          if (!localPaths.includes(partPath)) localPaths.push(partPath);
          partIndex++;
        } catch {
          break;
        }
      }
      // 上傳所有 localPaths
      for (const filePath of localPaths) {
        try {
          const ossUrl = await uploadToOss(filePath);
          if (ossUrl) ossUrls.push(ossUrl);
        } catch (e) {
          mcpLog('error', `[OSS] 上傳失敗: ${filePath}，錯誤: ${e}`);
        }
      }
      this._emitEvent('complete', { status: 'success', message: `成功將 ${url} 轉換為 ${outputPath}`, outputPath, ossUrls });
      mcpLog('info', `成功將 ${url} 轉換為 ${outputPath}`);
      return { localPaths, ossUrls };
    } catch (error: any) {
      mcpLog('error', '轉換過程中發生錯誤: ' + error);
      if (error && error.stack) mcpLog('error', error.stack);
      this._emitEvent('error', { status: 'failed', message: '轉換過程中發生錯誤', error: error.message });
      throw error;
    } finally {
      this._emitEvent('progress', { status: 'closing_browser', message: '正在關閉瀏覽器...' });
      await browser.close();
    }
  }

  private async _validateFileExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`文件不存在: ${filePath}`);
    }
  }

  private async _launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      headless: 'new' as any,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  private async _captureScreenshot(page: Page, outputPath: string): Promise<void> {
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    const ext = path.extname(outputPath).toLowerCase();
    const isPng = ext === '.png';
    
    const userSpecifiedFullPage = this.options.fullPageUserSpecified;
    const captureFullPageIntent = this.options.fullPage;

    this._emitEvent('progress', { status: 'evaluating_page_dimensions', message: '正在評估頁面初始尺寸...' });
    
    const initialDimensions = await page.evaluate((): PageDimensions => {
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

    const optimalInitialWidth = Math.min(Math.max(initialDimensions.contentWidth, initialDimensions.maxElementWidth || 0, initialDimensions.visibleWidth, 800), 1920);
    const optimalInitialHeight = Math.max(initialDimensions.contentHeight, initialDimensions.visibleHeight, 600);
    
    mcpLog('info', `初始優化視口計算: width=${optimalInitialWidth}, height=${optimalInitialHeight}`);
    await page.setViewport({
      width: Math.floor(optimalInitialWidth),
      height: Math.floor(optimalInitialHeight),
      deviceScaleFactor: initialDimensions.devicePixelRatio
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    if (initialDimensions.contentHeight > initialDimensions.visibleHeight * 1.5) {
        this._emitEvent('progress', { status: 'scroll_to_load_start', message: '開始滾動以加載完整頁面...' });
        let previousScrollHeight = 0;
        for (let i = 0; i < 10; i++) {
            const currentScrollHeight = await page.evaluate(() => document.body.scrollHeight);
            if (i > 0 && currentScrollHeight === previousScrollHeight) break;
            previousScrollHeight = currentScrollHeight;
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        this._emitEvent('progress', { status: 'scroll_to_load_complete', message: '滾動加載完成。' });
    }
    
    this._emitEvent('progress', { status: 'evaluating_final_dimensions', message: '正在評估最終頁面尺寸...' });
    const finalDimensions = await page.evaluate((): PageDimensions => {
      const body = document.body;
      const html = document.documentElement;
      const contentWidth = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);
      
      const bodyScrollHFinal = document.body.scrollHeight;
      const htmlScrollHFinal = document.documentElement.scrollHeight;
      const htmlClientHFinal = document.documentElement.clientHeight; 
      let finalEvalContentHeight = bodyScrollHFinal;
      if (htmlScrollHFinal > bodyScrollHFinal && htmlScrollHFinal > htmlClientHFinal) {
          finalEvalContentHeight = htmlScrollHFinal;
      }
      finalEvalContentHeight = Math.max(finalEvalContentHeight, document.body.offsetHeight, document.documentElement.offsetHeight);

      const visibleWidth = Math.max(html.clientWidth || 0, window.innerWidth || 0);
      const visibleHeight = Math.max(html.clientHeight || 0, window.innerHeight || 0);
      
      let maxElementWidth = 0; // Re-evaluate maxElementWidth, though not strictly used for final viewport width decision here
      const fixedWidthElementsInfo: Array<{ width: number; tagName: string }> = [];
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
        maxElementWidth: Math.floor(maxElementWidth), // Use evaluated maxElementWidth
        bodyMaxWidth: Math.floor(bodyMaxWidth),
        isBodyCentered,
        fixedWidthElementsInfo,
        devicePixelRatio: window.devicePixelRatio || 1
      };
    });
    mcpLog('info', `最終頁面尺寸評估: contentW=${finalDimensions.contentWidth}, contentH=${finalDimensions.contentHeight}, visibleH=${finalDimensions.visibleHeight}, bodyMaxW=${finalDimensions.bodyMaxWidth}, centered=${finalDimensions.isBodyCentered}`);

    let effectiveContentWidth = finalDimensions.contentWidth;
    if (finalDimensions.bodyMaxWidth && finalDimensions.bodyMaxWidth > 0 && finalDimensions.bodyMaxWidth < effectiveContentWidth) {
        effectiveContentWidth = finalDimensions.bodyMaxWidth;
        mcpLog('info', `使用 body.maxWidth (${finalDimensions.bodyMaxWidth}px) 作為有效內容寬度`);
    } else if (finalDimensions.fixedWidthElementsInfo && finalDimensions.fixedWidthElementsInfo.length > 0) {
        const mainContentElement = finalDimensions.fixedWidthElementsInfo
            .filter(el => el.tagName !== 'html' && el.tagName !== 'body' && el.width > 0 && el.width < finalDimensions.contentWidth * 0.9)
            .sort((a,b) => b.width - a.width)[0];
        if (mainContentElement) {
            effectiveContentWidth = mainContentElement.width;
            mcpLog('info', `使用最寬固定元素 ${mainContentElement.tagName} (${mainContentElement.width}px) 作為有效內容寬度`);
        }
    }
    effectiveContentWidth = Math.max(effectiveContentWidth, 320);
    mcpLog('info', `最終有效內容寬度計算為: ${effectiveContentWidth}px`);
    
    let pageContainersData: SplitElementData[] = [];
    let selectorForSplitting = this.options.splitSelector;
    if (selectorForSplitting === null || selectorForSplitting === undefined) selectorForSplitting = '.page-container';

    const isSplitSelectorProvided = selectorForSplitting && typeof selectorForSplitting === 'string' && selectorForSplitting.trim() !== '';
    
    if (isSplitSelectorProvided) {
        pageContainersData = await page.$$eval(selectorForSplitting, (elements): SplitElementData[] =>
            elements.map(el => {
                const rect = el.getBoundingClientRect();
                return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
            })
        ).catch(() => []); 
        if (pageContainersData.length > 0) {
            mcpLog('info', `找到 ${pageContainersData.length} 個元素用於分割 (選擇器: "${selectorForSplitting}")`);
        } else {
            mcpLog('info', `選擇器 "${selectorForSplitting}" 未找到任何元素，將執行單張截圖。`);
        }
    }
    
    const isSplitModeActive = pageContainersData && pageContainersData.length > 0;

    let finalViewportWidth = Math.max(effectiveContentWidth, finalDimensions.visibleWidth, 800);
    finalViewportWidth = Math.min(finalViewportWidth, 2560);
    
    let finalViewportHeight: number;
    if (isSplitModeActive) {
        finalViewportHeight = finalDimensions.contentHeight;
    } else {
        if (captureFullPageIntent) {
            finalViewportHeight = finalDimensions.contentHeight;
        } else {
            finalViewportHeight = finalDimensions.visibleHeight;
        }
    }
    finalViewportHeight = Math.max(finalViewportHeight, 600);
    
    mcpLog('info', `設置最終截圖視口: width=${Math.floor(finalViewportWidth)}, height=${Math.floor(finalViewportHeight)}`);
    await page.setViewport({
        width: Math.floor(finalViewportWidth),
        height: Math.floor(finalViewportHeight),
        deviceScaleFactor: finalDimensions.devicePixelRatio
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    const screenshotCommonOptions: Partial<ScreenshotOptions> = {
        type: isPng ? 'png' : 'jpeg',
        omitBackground: this.options.omitBackground,
    };
    if (!isPng && screenshotCommonOptions) { // Type guard for quality
        (screenshotCommonOptions as any).quality = this.options.quality; // Cast to any if type issue persists for quality
    }

    if (isSplitModeActive) {
        this._emitEvent('progress', { status: 'split_screenshot_start', count: pageContainersData.length });
        const capturedFilePaths: string[] = [];
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
                } as ScreenshotOptions); // Ensure it's ScreenshotOptions
                capturedFilePaths.push(partPath);
                this._emitEvent('progress', { status: 'part_captured', part: i + 1, totalParts: pageContainersData.length, partPath });
            } catch (e: any) { 
              this._emitEvent('warning', { status: 'split_part_error', message: `分割截圖部分 ${i+1} 時出錯: ${e.message}`, part: i + 1, error: e.message });
            }
        }
        // Placeholder for a final "all_parts_processed" event if needed, or rely on processFolderHtml's events
    } else { 
        this._emitEvent('progress', { status: 'single_screenshot_start' });
        const currentVp = page.viewport() as Viewport; // Type assertion if viewport() can be null
        let clip: ScreenshotOptions['clip'] | null = null;

        const contentDisplayWidth = Math.floor(effectiveContentWidth);
        let clipX = 0;
        let clipWidth = contentDisplayWidth;

        if (contentDisplayWidth < currentVp.width) {
            if (finalDimensions.isBodyCentered && finalDimensions.bodyMaxWidth && finalDimensions.bodyMaxWidth > 0 && contentDisplayWidth <= finalDimensions.bodyMaxWidth) {
                clipX = Math.floor((currentVp.width - contentDisplayWidth) / 2);
            }
        } else {
            clipWidth = currentVp.width;
        }
        
        let clipY = 0;
        let clipHeight: number;

        if (captureFullPageIntent) {
            clipHeight = finalDimensions.contentHeight;
        } else {
            clipHeight = Math.min(currentVp.height, finalDimensions.contentHeight);
        }
        clipHeight = Math.max(clipHeight, 1);

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
            clip.width = Math.min(clip.width, finalDimensions.contentWidth - clip.x);
            clip.height = Math.min(clip.height, finalDimensions.contentHeight - clip.y);

            if (clip.width <=0 || clip.height <=0) {
                this._emitEvent('warning', { status: 'invalid_clip', message: `計算出的Clip尺寸無效 (${clip.width}x${clip.height})，取消Clip。` });
                clip = null;
            } else {
                this._emitEvent('progress', { status: 'applying_clip', clip, message: `應用精確 Clip: x=${clip.x} y=${clip.y} w=${clip.width} h=${clip.height}` });
            }
        }
        
        const finalScreenshotOptions: ScreenshotOptions = {
            ...screenshotCommonOptions,
            path: outputPath,
        } as ScreenshotOptions;

        // 重要：clip 和 fullPage 不能同時使用
        if (clip) {
            finalScreenshotOptions.clip = clip;
            // 當使用 clip 時，確保不設置 fullPage
            finalScreenshotOptions.fullPage = false;
        } else {
            // 只有在沒有 clip 時才設置 fullPage
            finalScreenshotOptions.fullPage = captureFullPageIntent;
        }
        
        this._emitEvent('progress', { 
            status: 'screenshot_options', 
            options: { 
                fullPage: finalScreenshotOptions.fullPage, 
                hasClip: !!finalScreenshotOptions.clip 
            },
            message: `最終截圖選項: fullPage=${finalScreenshotOptions.fullPage}, clip=${JSON.stringify(finalScreenshotOptions.clip)}`
        });

        try {
            await page.screenshot(finalScreenshotOptions);
            this._emitEvent('progress', { status: 'single_screenshot_captured', outputPath, message: `成功截取圖片到 ${outputPath}` });
        } catch (e: any) {
            this._emitEvent('error', { status: 'screenshot_error', error: e.message, message: `截取單張圖片到 ${outputPath} 時出錯: ${e}` });
        }
    }
  }
}

/**
 * 處理整個目錄中的HTML文件
 */
export async function processFolderHtml(
    folderPath: string, 
    outputDir: string, 
    commonConverterOptions: Partial<ConverterOptions> = {}, 
    folderEventEmitter: EventEmitter | null = null, 
    folderConversionId: string | null = null
): Promise<void> {
  
  const emitFolderEvent = (eventName: string, data: object) => {
    if (folderEventEmitter && folderConversionId) {
      folderEventEmitter.emit(folderConversionId, { eventName, ...data });
    }
  };

  try {
    emitFolderEvent('progress', { status: 'folder_processing_started', message: `開始處理文件夾: ${folderPath}`, inputFolderPath: folderPath, outputDir });
    await fs.access(folderPath);
    
    const files = await fs.readdir(folderPath);
    const htmlFiles = files.filter(file => 
      file.endsWith('.html') || file.endsWith('.htm')
    );
    
    if (htmlFiles.length === 0) {
      emitFolderEvent('error', { status: 'no_html_files_found', message: `在 ${folderPath} 中未找到 HTML 文件` });
      return;
    }
    
    emitFolderEvent('progress', { status: 'folder_scan_complete', message: `在 ${folderPath} 中找到 ${htmlFiles.length} 個 HTML 文件。`, count: htmlFiles.length });
    
    await fs.mkdir(outputDir, { recursive: true });
    
    for (let i = 0; i < htmlFiles.length; i++) {
      const file = htmlFiles[i];
      const inputPath = path.join(folderPath, file);
      const fileContext: FileContext = { inputPath, originalFileName: file, outputPath: '' }; // outputPath will be set next

      const fileName = path.basename(file, path.extname(file));
      const outputPath = path.join(outputDir, `${fileName}.png`);
      fileContext.outputPath = outputPath;
      
      emitFolderEvent('progress', {
        status: 'processing_file_start',
        message: `[${i + 1}/${htmlFiles.length}] 開始處理: ${file} -> ${outputPath}`,
        currentFile: file,
        currentIndex: i + 1,
        totalFiles: htmlFiles.length,
        fileContext 
      });
      
      try {
        const converter = new HtmlToPngConverter({
          ...commonConverterOptions,
          eventEmitter: folderEventEmitter,
          conversionId: folderConversionId,
          fileContext
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
      } catch (error: any) {
        emitFolderEvent('error', { 
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
    
    emitFolderEvent('complete', { status: 'folder_processing_complete', message: `文件夾 ${folderPath} 處理完成，共處理 ${htmlFiles.length} 個文件。`, inputFolderPath: folderPath, outputDir, totalFilesProcessed: htmlFiles.length });

  } catch (error: any) {
    emitFolderEvent('error', { status: 'folder_processing_error', message: `處理文件夾 ${folderPath} 時發生嚴重錯誤: ${error.message}`, inputFolderPath: folderPath, error: error.message });
    throw error; // Re-throw for server.ts or calling code to potentially handle
  }
}

// --- CLI Specific Functions ---
// These are kept for now but might be refactored into a separate cli.ts if desired

function parseCommandLineArgs(args: string[]): any { // : CliOptions {
  /*
  const options: CliOptions = {
    input: '',
    output: 'output.png', // Default for file/url/html; for folder, it's outputDir
    format: 'A4',
    quality: 100,
    fullPage: false,
    fullPageUserSpecified: false,
    omitBackground: false,
    waitUntil: 'networkidle0',
    timeout: 30000, // Shorter timeout for CLI by default
    splitSelector: '.page-container', // Default CLI split selector
  };

  let currentCommand: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (['file', 'url', 'html', 'folder'].includes(arg)) {
      currentCommand = arg;
      if (args[i + 1]) {
        options.input = args[i + 1];
        i++;
      } else {
        console.error(`錯誤: 命令 ${arg} 缺少輸入參數。`);
        // printUsage(); // printUsage is commented out
        if (typeof process !== 'undefined' && process.exit) process.exit(1);
      }
    } else if (arg === '-o' || arg === '--output') {
      if (args[i + 1]) {
        options.output = args[i + 1];
        i++;
      } else {
         console.error(`錯誤: 選項 ${arg} 缺少輸出路徑。`);
        // printUsage(); // printUsage is commented out
        if (typeof process !== 'undefined' && process.exit) process.exit(1);
      }
    } else if (arg === '-f' || arg === '--format') {
      options.format = args[++i];
    } else if (arg === '-q' || arg === '--quality') {
      options.quality = parseInt(args[++i], 10);
    } else if (arg === '--full-page') {
      options.fullPage = true;
      options.fullPageUserSpecified = true;
    } else if (arg === '--omit-background') {
      options.omitBackground = true;
    } else if (arg === '-s' || arg === '--split-selector') { // Added long form for split-selector
        if (args[i + 1]) {
            options.splitSelector = args[i + 1];
            i++;
        } else {
            console.error(`錯誤: 選項 ${arg} 缺少 CSS 選擇器。`);
            // printUsage(); // printUsage is commented out
            if (typeof process !== 'undefined' && process.exit) process.exit(1);
        }
    } else if (arg === '-h' || arg === '--help') {
      // printUsage(); // printUsage is commented out
      if (typeof process !== 'undefined' && process.exit) process.exit(0);
    }
  }

  if (!options.input && !['file', 'url', 'html', 'folder'].includes(args[0])) {
      if(args.length > 0) { 
        console.error('錯誤: 缺少輸入參數或無效命令。');
        // printUsage(); // printUsage is commented out
        if (typeof process !== 'undefined' && process.exit) process.exit(1);
      }
  } else if (!options.input && ['file', 'url', 'html', 'folder'].includes(args[0])) {
      console.error(`錯誤: 命令 ${args[0]} 缺少輸入。`);
      // printUsage(); // printUsage is commented out
      if (typeof process !== 'undefined' && process.exit) process.exit(1);
  }
  
  if (currentCommand === 'folder' && options.output === 'output.png') {
    options.output = 'output_images'; // Default output directory for folder command
  }

  return options;
  */
  console.warn('parseCommandLineArgs is currently disabled for server mode.');
  return {};
}

function printUsage(): void {
  /*
  console.log(`
HTML 转 PNG 工具

用法:
  node <script.js> file <input.html> [选项]
  node <script.js> url <网页URL> [选项]
  node <script.js> html <包含HTML的文件> [选项]
  node <script.js> folder <目錄路徑> [选项]

选项:
  -o, --output <路径>        輸出路徑:
                            - 對於 file/url/html 命令: 輸出PNG文件路徑 (默認: output.png)
                            - 對於 folder 命令: 輸出目錄路徑 (默認: output_images)
  -f, --format <格式>        頁面格式 (如: A4, Letter等) (Puppeteer PDF Option, less relevant for PNG)
  -q, --quality <质量>       圖片質量 (0-100, 適用於 JPEG)
      --full-page            捕獲整個頁面
      --omit-background      不包含背景 (PNG透明背景)
  -s, --split-selector <CSS選擇器> 用於將截圖分割成多個文件的CSS選擇器 (默認: '.page-container')
  -h, --help                 顯示此幫助信息

示例:
  # 轉換單個HTML文件
  node <script.js> file page.html -o result.png
  
  # 轉換遠程URL為JPEG
  node <script.js> url https://example.com -o website.jpeg -q 85
  
  # 處理整個資料夾中的HTML文件 (保持原文件名，但改為PNG格式)
  node <script.js> folder ./html_files -o ./output_images
`);
  */
  console.warn('printUsage is currently disabled for server mode.');
}

async function runCli() {
  /*
  // process.argv an array: ['/path/to/node', '/path/to/script.js', ...args]
  const args = process.argv.slice(2); 
  if (args.length === 0) {
    // printUsage(); // printUsage is commented out
    if (typeof process !== 'undefined' && process.exit) process.exit(0);
  }
  // const options = parseCommandLineArgs(args); // parseCommandLineArgs is commented out
  const command = args[0]; // Command should be the first argument

  // Converter instance is created inside commands if needed, or inside processFolderHtml
  // const converter = new HtmlToPngConverter(options as Partial<ConverterOptions>);

  try {
    switch (command) {
      case 'file':
        {
          // const converter = new HtmlToPngConverter(options as Partial<ConverterOptions>);
          // await converter.convertFile(options.input, options.output);
        }
        break;
      case 'url':
        {
          // const converter = new HtmlToPngConverter(options as Partial<ConverterOptions>);
          // await converter.convertUrl(options.input, options.output);
        }
        break;
      case 'html':
        {
          // const htmlContent = await fs.readFile(options.input, 'utf-8');
          // const converter = new HtmlToPngConverter(options as Partial<ConverterOptions>);
          // await converter.convertHtmlString(htmlContent, options.output);
        }
        break;
      case 'folder':
        // await processFolderHtml(options.input, options.output, options as Partial<ConverterOptions>);
        break;
      default:
        // printUsage(); // printUsage is commented out
        // if(!options.input && command !== '--help' && command !== '-h' && typeof process !== 'undefined' && process.exit) process.exit(1); // Exit if invalid command and not help
    }
  } catch (error: any) {
    console.error('程序执行失败:', error.message);
    if (typeof process !== 'undefined' && process.exit) process.exit(1);
  }
  */
  console.warn('runCli is currently disabled for server mode.');
}

// Comment out the following lines as they are CLI specific and were causing issues with ESM module loading
// // 檢查是否通過CLI直接運行。
// ... (rest of the comments at the end of the file)
// // export { HtmlToPngConverter, processFolderHtml, runCli }; // 可以選擇性導出 runCli

 