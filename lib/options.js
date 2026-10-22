'use strict';

// 服务端入参白名单与校验，防止网页透传时把任意内容转发给阿里云。
const FORMATS = new Set(['mp3', 'wav', 'pcm']);
const SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 48000]);

const MODEL_RE = /^sambert-[a-z0-9-]+$/i;
const TEXT_MAX = 10000;

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 校验并归一化合成请求参数。
 * 抛错带 httpStatus / code / message，由 api/tts.js 转成响应。
 */
function normalizeTtsBody(body) {
  if (!body || typeof body !== 'object') {
    throw httpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    throw httpError(400, 'INVALID_TEXT', '待合成文本不能为空');
  }
  if (text.length > TEXT_MAX) {
    throw httpError(400, 'INVALID_TEXT', `文本不能超过 ${TEXT_MAX} 字，当前 ${text.length} 字`);
  }

  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!MODEL_RE.test(model)) {
    throw httpError(400, 'INVALID_MODEL', '模型名不合法，应以 sambert- 开头');
  }

  const format = typeof body.format === 'string' ? body.format.toLowerCase() : 'mp3';
  if (!FORMATS.has(format)) {
    throw httpError(400, 'INVALID_FORMAT', '音频格式只支持 mp3、wav、pcm');
  }

  const sampleRate = Number(body.sample_rate ?? 16000);
  if (!SAMPLE_RATES.has(sampleRate)) {
    throw httpError(400, 'INVALID_SAMPLE_RATE', '采样率只支持 8000、16000、22050、24000、48000');
  }

  const volume = Math.round(clampNum(body.volume, 0, 100, 50));
  const rate = clampNum(body.rate, 0.5, 2, 1);
  const pitch = clampNum(body.pitch, 0.5, 2, 1);

  const creds = body.credentials && typeof body.credentials === 'object' ? body.credentials : {};
  const apiKey = typeof creds.apiKey === 'string' ? creds.apiKey.trim() : '';
  const workspaceId =
    typeof creds.workspaceId === 'string' ? creds.workspaceId.trim() : '';

  if (workspaceId && !/^[a-zA-Z0-9-]+$/.test(workspaceId)) {
    throw httpError(400, 'INVALID_WORKSPACE', 'Workspace ID 只允许字母、数字和连字符');
  }

  return {
    text,
    model,
    format,
    sampleRate,
    volume,
    rate,
    pitch,
    credentials: { apiKey, workspaceId },
  };
}

function httpError(status, code, message) {
  const err = new Error(message);
  err.httpStatus = status;
  err.code = code;
  return err;
}

module.exports = { normalizeTtsBody, httpError, TEXT_MAX };
