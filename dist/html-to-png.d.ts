import { type PuppeteerLifeCycleEvent } from 'puppeteer';
import { EventEmitter } from 'events';
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
/**
 * HTML 转 PNG 工具类
 */
export declare class HtmlToPngConverter {
    private options;
    constructor(options?: Partial<ConverterOptions>);
    /**
     * 發送進度事件 (如果提供了 eventEmitter)
     * @param eventName - 事件名稱 (例如 'progress', 'error', 'complete')
     * @param data - 事件數據
     */
    private _emitEvent;
    /**
     * 将 HTML 文件转换为 PNG
     * @param htmlFilePath - HTML 文件路径
     * @param outputPath - 输出 PNG 文件路径
     */
    convertFile(htmlFilePath: string, outputPath: string): Promise<void>;
    /**
     * 将 HTML 字符串转换为 PNG
     * @param htmlContent - HTML 内容
     * @param outputPath - 输出 PNG 文件路径
     */
    convertHtmlString(htmlContent: string, outputPath: string): Promise<void>;
    /**
     * 转换在线网页为 PNG
     * @param url - 网页 URL
     * @param outputPath - 输出 PNG 文件路径
     */
    convertUrl(url: string, outputPath: string): Promise<void>;
    private _validateFileExists;
    private _launchBrowser;
    private _captureScreenshot;
}
/**
 * 處理整個目錄中的HTML文件
 */
export declare function processFolderHtml(folderPath: string, outputDir: string, commonConverterOptions?: Partial<ConverterOptions>, folderEventEmitter?: EventEmitter | null, folderConversionId?: string | null): Promise<void>;
export {};
