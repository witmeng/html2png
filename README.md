# html2png-mcp

> GitHub: [https://github.com/witmeng/html2png](https://github.com/witmeng/html2png)  
> npm: `npm i html2png-mcp`

## 项目简介

`html2png-mcp` 是一个基于 MCP (Model Context Protocol) 协议的服务端工具，支持将 HTML 页面、URL 或 base64 文件内容批量渲染为 PNG 图片。支持分页面截取、命令行批量处理，适用于 LLM 应用、自动化测试、内容归档等场景。

---

## 主要特性

- **MCP Server 标准**：可作为 MCP Stdio Server 启动，支持 AI Agent、LLM 等上下游对接。
- **多种输入类型**：支持 URL、HTML 字符串、base64 文件内容。
- **分页面截屏**：支持通过 CSS 选择器自动将一个 HTML 页面分割为多张图片。
- **批量处理**：支持批量转换多个页面或文件。
- **详细日志与进度通知**。

---

## 安装与启动

1. 安装依赖

   ```bash
   npm install
   ```

2. 构建项目

   ```bash
   npm run build
   ```

3. 启动 MCP Server

   ```bash
   npm start
   ```
   或直接运行
   ```bash
   node dist/mcp-stdio-server.js
   ```

   > **注意**：本服务默认以 MCP Stdio Server 方式运行，适合与支持 MCP 协议的客户端对接。

---

## 作为 MCP Server 的用法

- **协议说明**：本服务基于 [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) 实现，支持 MCP 工具调用。
- **MCP服務器配置**（JSON）示例：
    ```json
    "html2png": {
      "command": "npx",
      "args": ["-y", "html2png-mcp@latest"],
      "env": {
        "ALI_OSS_REGION": "oss-cn-hongkong",
        "ALI_OSS_KEY": "******",
        "ALI_OSS_SECRET": "********",
        "ALI_OSS_BUCKET": "****",
        "ALI_OSS_ENDPOINT": "oss-cn-hongkong.aliyuncs.com",
        "ALI_OSS_EXPECTED_BASE_URL": "********"
      }
    }   
    ```
- **输入参数**（JSON）示例：

  ```json
  {
    "type": "html",
    "input": "<html>...</html>",
    "outputFileName": "result.png",
    "options": {
      "splitSelector": ".page-container"
    }
  }
  ```

- **主要参数说明**：
  - `type`：输入类型，支持 `url`、`html`、`base64`
  - `input`：HTML 字符串、URL 或 base64 内容
  - `outputFileName`：输出文件名（可选）
  - `options`：高级参数（如分割、图片质量等）

---

## 分页面截屏说明

### 一页 HTML 自动分割为多张图片

- **场景**：当一个 HTML 页面内有多个「页面容器」时（如电子书、PPT、长文档），可自动识别并分别截图。
- **用法**：
  - 在 HTML 中为每个页面部分加上统一的 CSS 类（如 `.page-container`）：
    ```html
    <div class="page-container">第一页内容</div>
    <div class="page-container">第二页内容</div>
    ```
  - 调用时指定 `splitSelector` 参数：
    ```json
    {
      "type": "html",
      "input": "<html>...</html>",
      "outputFileName": "result.png",
      "options": {
        "splitSelector": ".page-container"
      }
    }
    ```
  - 结果：会输出 `result_part_0.png`、`result_part_1.png` 等多张图片，每张对应一个页面容器。

- **默认行为**：如果未指定 `splitSelector`，默认会查找 `.page-container`。如页面结构不同，可自定义选择器。

---

## OSS 云存储自动上传

> 当前版本仅支持阿里云 OSS（Aliyun Object Storage Service）。

本工具支持**自动将生成的 PNG 图片上传到阿里云 OSS**，并返回 OSS 图片访问链接。

### OSS 配置方法

请在运行前设置以下环境变量：

- `ALI_OSS_REGION`：OSS 区域（如 `oss-cn-shanghai`）
- `ALI_OSS_KEY`：OSS AccessKeyId
- `ALI_OSS_SECRET`：OSS AccessKeySecret
- `ALI_OSS_BUCKET`：OSS 存储桶名称
- `ALI_OSS_ENDPOINT`：OSS Endpoint（可选，自动推导时可省略）
- `OSS_EXPECTED_BASE_URL`：图片公网访问前缀（如 `https://your-bucket.oss-cn-shanghai.aliyuncs.com`，可选）

### 返回结果

每次转换后，返回内容中会包含 `ossUrls` 字段，列出所有上传到 OSS 的图片公网地址。例如：

```json
{
  "outputPaths": ["output_images/result_part_0.png", "output_images/result_part_1.png"],
  "ossUrls": [
    "https://your-bucket.oss-cn-shanghai.aliyuncs.com/html2png/20240528/result_part_0.png",
    "https://your-bucket.oss-cn-shanghai.aliyuncs.com/html2png/20240528/result_part_1.png"
  ]
}
```

### 注意事项

- 若未配置 OSS 环境变量，则仅生成本地图片，不上传 OSS。
- 上传失败时会有详细日志输出到 `mcp_logs/`。

---

## 命令行批量转换（开发/调试用）

```bash
node dist/html-to-png.js file test_html/index.html -o output_images/index.png -s .page-container
```

- `-s` 或 `--split-selector`：指定分割用的 CSS 选择器

---

## 目录结构

```
.
├── dist/              # 编译后 JS 文件
├── src/               # TypeScript 源码
├── output_images/     # PNG 输出目录
├── test_html/         # 测试用 HTML
├── mcp_logs/          # 日志
├── package.json
└── README.md
```

---

## 常见问题

- **如何自定义分割？**  
  修改 `splitSelector`，如 `.slide`、`.page` 等，确保 HTML 结构中有对应的元素。

- **MCP Server 如何对接？**  
  参考 [typescript-sdk/README.md](./typescript-sdk/README.md) 或 MCP 官方文档，使用支持 MCP 协议的客户端连接本服务。

---

## 许可证

MIT License

---

如需更详细的 API 或集成说明，请查阅源码注释或联系开发者。

---

**支持/商务合作：myspsp@gmail.com**

---
