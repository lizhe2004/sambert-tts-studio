'use strict';

// GET /api/config
// 只告诉前端服务端环境变量是否已配置，绝不回显 Key 内容。
module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    const payload = JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: '只支持 GET 请求' } });
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(payload);
  }

  const payload = JSON.stringify({
    apiKeyConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
    workspaceConfigured: Boolean(process.env.DASHSCOPE_WORKSPACE_ID),
  });
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};
