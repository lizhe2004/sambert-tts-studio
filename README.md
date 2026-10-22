# 声音字模 · Sambert 语音合成试听坊

一个可直接部署到 [Vercel](https://vercel.com) 的 Node.js 小应用：网页上挑选阿里云百炼 [Sambert](https://help.aliyun.com/zh/model-studio/sambert-websocket-api) 音色、输入文字、调语速/音调/音量，在线试听并下载合成音频（mp3 / wav / pcm）。

- 凭据支持两种来源：部署时配置环境变量；环境变量缺失时，也可以在网页“服务设置”里填写 API Key，由接口透传给阿里云（只存浏览器 localStorage，服务端不落盘）。
- 服务端是一个 Vercel Node Function：浏览器走普通 HTTPS 请求，函数作为 WebSocket 客户端连接 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`（或业务空间专属域名），收齐音频后一次性返回。
- 内置 43 个 Sambert 音色（中文 / 英文 / 西语 / 意语 / 印尼语 / 法语 / 德语 / 泰语），含特色、场景、默认采样率与免费额度标注。

## 本地运行

```bash
npm install
cp .env.example .env   # 填入 DASHSCOPE_API_KEY（也可以不填，在网页里配置）
npm run dev            # http://localhost:5173
```

开发服务器零额外依赖（`scripts/dev-server.js`），自动读取项目根目录 `.env`，行为模拟 Vercel Node Runtime。

## 部署到 Vercel

方式一：把目录推到 Git 仓库，在 Vercel 控制台 **Add New → Project** 导入，零配置识别 `api/` 函数和 `public/` 静态目录。

方式二：使用 CLI

```bash
npm i -g vercel
vercel            # 预览部署
vercel env add DASHSCOPE_API_KEY   # 生产环境变量
vercel --prod
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | 二选一 | 阿里云百炼 API Key。不配置则必须由网页设置透传。 |
| `DASHSCOPE_WORKSPACE_ID` | 否 | 业务空间 ID。填写后走专属域名 `wss://<WorkspaceId>.cn-beijing.maas.aliyuncs.com`；留空使用通用域名 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`。 |
| `DASHSCOPE_WS_URL` | 否 | 直接指定完整 WebSocket 地址，优先级最高。 |

> Sambert 仅支持北京地域。函数超时在 `vercel.json` 中配置为 30 秒。

### 常见问题

**填了 Workspace ID 反而报“没有免费配额”，只填 Key 却正常？**

免费额度按业务空间发放，API Key 也只在创建它的那个业务空间内有效。留空 Workspace ID 时走通用域名，阿里云按 Key 自动路由到其所属空间（通常是默认业务空间）；填错空间 ID 会被专属域名强制路由到没有额度/未授权模型的空间。不确定就留空；确需使用专属域名，请在百炼控制台「业务空间管理」确认空间 ID 与 Key 所属空间一致，并在该空间内完成模型授权与额度分配。

## 接口

### `GET /api/config`

返回服务端环境变量配置状态（不回显 Key 内容）：

```json
{ "apiKeyConfigured": true, "workspaceConfigured": false }
```

### `POST /api/tts`

```json
{
  "text": "要合成的文字",
  "model": "sambert-zhichu-v1",
  "format": "mp3",
  "sample_rate": 48000,
  "volume": 50,
  "rate": 1,
  "pitch": 1,
  "credentials": { "apiKey": "sk-...", "workspaceId": "" }
}
```

- `credentials` 可选；缺省时使用服务端环境变量。
- 成功：返回音频二进制（`audio/mpeg` / `audio/wav` / `audio/L16`），响应头 `X-Billed-Characters` 为计费字符数。
- 失败：`{ "error": { "code": "...", "message": "..." } }`，常见：`NO_API_KEY`（400）、`INVALID_API_KEY`（401）、`INVALID_TEXT` / `INVALID_MODEL`（400）、`TASK_FAILED` / `UPSTREAM_TIMEOUT`（502/504）。

参数范围：文本 1–10000 字；采样率 8000 / 16000 / 22050 / 24000 / 48000；音量 0–100；语速、音调 0.5–2。

## 安全说明

- 配置了服务端环境变量后，任何能访问该站点的人都可以用你的 Key 发起合成（会产生计费）。私有使用建议开启 Vercel 的 [Deployment Protection](https://vercel.com/docs/security/deployment-protection)，或不要公开部署地址。
- 网页透传模式下，Key 经过本站函数转发到阿里云，函数不记录、不持久化 Key；但站点运营者在技术上仍可见请求内容，请只在自己信任的部署上填写。

## 目录结构

```
api/
  config.js          # GET /api/config
  tts.js             # POST /api/tts，WebSocket 连 Sambert 并聚合音频
lib/
  options.js         # 入参白名单与校验
public/
  index.html         # 试听坊页面
  styles.css
  app.js
  voices.js          # Sambert 音色表
scripts/
  dev-server.js      # 本地零依赖开发服务器
vercel.json
```
