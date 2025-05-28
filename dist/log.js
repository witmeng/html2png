import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
export async function logToFile(message) {
    try {
        const logDir = path.resolve(process.cwd(), 'mcp_logs');
        await fsp.mkdir(logDir, { recursive: true });
        const logFile = path.join(logDir, `mcp-server-${new Date().toISOString().slice(0, 10)}.log`);
        await fsp.appendFile(logFile, `${new Date().toISOString()} - ${message}\n`);
    }
    catch (e) {
        // 靜默失敗
    }
}
export function logToFileSync(message) {
    try {
        const logDir = path.resolve(process.cwd(), 'mcp_logs');
        if (!fs.existsSync(logDir))
            fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, `mcp-server-${new Date().toISOString().slice(0, 10)}.log`);
        fs.appendFileSync(logFile, `${new Date().toISOString()} - ${message}\n`);
    }
    catch (e) {
        // 靜默失敗
    }
}
export function mcpLog(level, data) {
    logToFile(`[${level.toUpperCase()}] ${data}`);
}
//# sourceMappingURL=log.js.map