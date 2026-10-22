'use strict';

const WebSocket = require('ws');
const { randomUUID } = require('crypto');
const { normalizeTtsBody, httpError } = require('../lib/options');

const DEFAULT_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const HANDSHAKE_TIMEOUT_MS = 10000;
const TASK_TIMEOUT_MS = 30000;

const AUDIO_CONTENT_TYPE = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pcm: 'audio/L16',
};

/**
 * POST /api/tts
 * 请求体见 lib/options.js 校验规则；credentials 缺省时读取服务端环境变量。
 * 函数作为 WebSocket 客户端连接阿里云 Sambert，收齐音频后一次性返回。
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '只支持 POST 请求');
  }

  let input;
  try {
    const body = await readJsonBody(req);
    input = normalizeTtsBody(body);
  } catch (err) {
    return sendError(res, err.httpStatus || 400, err.code || 'BAD_REQUEST', err.message);
  }

  // 网页透传的凭据优先，其次服务端环境变量。Key 不落日志、不落盘。
  const apiKey = (input.credentials.apiKey || process.env.DASHSCOPE_API_KEY || '').trim();
  const workspaceId = (
    input.credentials.workspaceId ??
    process.env.DASHSCOPE_WORKSPACE_ID ??
    ''
  ).trim();

  if (!apiKey) {
    return sendError(
      res,
      400,
      'NO_API_KEY',
      '服务端未配置 DASHSCOPE_API_KEY，请在网页“服务设置”中填写 API Key'
    );
  }

  let wsUrl = process.env.DASHSCOPE_WS_URL;
  if (!wsUrl) {
    wsUrl = workspaceId
      ? `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`
      : DEFAULT_WS_URL;
  }

  const runTask = {
    header: { action: 'run-task', task_id: randomUUID(), streaming: 'out' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: input.model,
      input: { text: input.text },
      parameters: {
        text_type: 'PlainText',
        format: input.format,
        sample_rate: input.sampleRate,
        volume: input.volume,
        rate: input.rate,
        pitch: input.pitch,
        word_timestamp_enabled: false,
        phoneme_timestamp_enabled: false,
      },
    },
  };

  const chunks = [];
  let billedCharacters = 0;
  let ws;

  try {
    await new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      });

      let settled = false;
      const timer = setTimeout(() => {
        fail(httpError(504, 'UPSTREAM_TIMEOUT', 'Sambert 服务响应超时（30 秒）'));
        try {
          ws.terminate();
        } catch {}
      }, TASK_TIMEOUT_MS);

      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };

      ws.on('open', () => ws.send(JSON.stringify(runTask)));

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          chunks.push(Buffer.from(data));
          return;
        }
        let msg;
        try {
          msg = JSON.parse(data.toString('utf8'));
        } catch {
          return;
        }
        const event = msg && msg.header && msg.header.event;
        if (event === 'task-finished') {
          billedCharacters = (msg.payload && msg.payload.usage && msg.payload.usage.characters) || 0;
          done();
        } else if (event === 'task-failed') {
          fail(
            httpError(
              502,
              (msg.header.error_code || 'TASK_FAILED').slice(0, 64),
              msg.header.error_message || 'Sambert 合成任务失败'
            )
          );
        }
      });

      // API Key 无效时握手阶段返回 401/403
      ws.on('unexpected-response', (_request, upstream) => {
        upstream.resume();
        const status = upstream.statusCode;
        if (status === 401 || status === 403) {
          fail(httpError(401, 'INVALID_API_KEY', `API Key 鉴权失败（HTTP ${status}），请检查 Key 是否正确`));
        } else {
          fail(httpError(502, 'UPSTREAM_HANDSHAKE_FAILED', `连接 Sambert 失败（HTTP ${status}）`));
        }
      });

      ws.on('error', (err) => {
        if (err.httpStatus) return fail(err);
        fail(httpError(502, 'UPSTREAM_CONNECTION_ERROR', `无法连接 Sambert 服务：${err.message}`));
      });

      ws.on('close', () => {
        // 没有收到 task-finished 连接就断了
        fail(httpError(502, 'UPSTREAM_CLOSED', 'Sambert 提前关闭了连接，请重试'));
      });
    });
  } catch (err) {
    try {
      ws.terminate();
    } catch {}
    return sendError(
      res,
      err.httpStatus || 502,
      err.code || 'UPSTREAM_ERROR',
      err.message || '调用 Sambert 失败'
    );
  }

  try {
    ws.close();
  } catch {}

  const audio = Buffer.concat(chunks);
  if (audio.length === 0) {
    return sendError(res, 502, 'EMPTY_AUDIO', 'Sambert 未返回音频数据');
  }

  res.writeHead(200, {
    'Content-Type': AUDIO_CONTENT_TYPE[input.format] || 'application/octet-stream',
    'Content-Length': audio.length,
    'X-Billed-Characters': String(billedCharacters),
    'Cache-Control': 'no-store',
  });
  res.end(audio);
};

function readJsonBody(req) {
  // Vercel 的 Node Runtime 会自动解析 JSON 并挂到 req.body
  if (req.body !== undefined && req.body !== null) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4 * 1024 * 1024) {
        reject(httpError(413, 'BODY_TOO_LARGE', '请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, 'INVALID_JSON', '请求体不是合法的 JSON'));
      }
    });
    req.on('error', () => reject(httpError(400, 'INVALID_BODY', '读取请求体失败')));
  });
}

function sendError(res, status, code, message) {
  const payload = JSON.stringify({ error: { code, message } });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}
