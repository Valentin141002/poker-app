const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3101);
const CORE_TARGET = new URL(process.env.CORE_TARGET || 'http://127.0.0.1:3000');
const ADMIN_SCOPE = String(process.env.ADMIN_SCOPE || '').trim().toLowerCase();
const ADMIN_GATEWAY_TOKEN = String(process.env.ADMIN_GATEWAY_TOKEN || '').trim();

if (!ADMIN_SCOPE) {
  throw new Error('ADMIN_SCOPE is required (ex: q1, q2, t1).');
}
if (!ADMIN_GATEWAY_TOKEN) {
  throw new Error('ADMIN_GATEWAY_TOKEN is required.');
}

const isHttpsTarget = CORE_TARGET.protocol === 'https:';
const httpLib = isHttpsTarget ? https : http;

function buildForwardHeaders(incomingHeaders) {
  const headers = { ...incomingHeaders };
  headers.host = CORE_TARGET.host;
  headers['x-admin-gateway-token'] = ADMIN_GATEWAY_TOKEN;
  headers['x-admin-gateway-scope'] = ADMIN_SCOPE;
  headers['x-forwarded-host'] = incomingHeaders.host || '';
  headers['x-forwarded-proto'] = incomingHeaders['x-forwarded-proto'] || 'https';
  return headers;
}

function createRequestOptions(req) {
  return {
    protocol: CORE_TARGET.protocol,
    hostname: CORE_TARGET.hostname,
    port: CORE_TARGET.port || (isHttpsTarget ? 443 : 80),
    method: req.method,
    path: req.url,
    headers: buildForwardHeaders(req.headers)
  };
}

function proxyHttpRequest(req, res) {
  const proxyReq = httpLib.request(createRequestOptions(req), (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end(`Gateway error: ${err.message}`);
  });

  req.pipe(proxyReq);
}

function writeUpgradeResponse(clientSocket, proxyRes) {
  const statusCode = proxyRes.statusCode || 101;
  const statusMessage = proxyRes.statusMessage || 'Switching Protocols';
  const lines = [`HTTP/1.1 ${statusCode} ${statusMessage}`];
  for (const [key, value] of Object.entries(proxyRes.headers || {})) {
    if (Array.isArray(value)) {
      value.forEach(v => lines.push(`${key}: ${v}`));
    } else if (value !== undefined) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('', '');
  clientSocket.write(lines.join('\r\n'));
}

function proxyUpgrade(req, clientSocket, head) {
  const proxyReq = httpLib.request(createRequestOptions(req));

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    writeUpgradeResponse(clientSocket, proxyRes);

    if (head && head.length) proxySocket.write(head);
    if (proxyHead && proxyHead.length) clientSocket.write(proxyHead);

    proxySocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => proxySocket.destroy());

    clientSocket.pipe(proxySocket).pipe(clientSocket);
  });

  proxyReq.on('response', (proxyRes) => {
    // Fallback if target did not upgrade.
    const bodyChunks = [];
    proxyRes.on('data', (c) => bodyChunks.push(c));
    proxyRes.on('end', () => {
      const body = Buffer.concat(bodyChunks);
      const statusCode = proxyRes.statusCode || 502;
      const statusMessage = proxyRes.statusMessage || 'Bad Gateway';
      const lines = [`HTTP/1.1 ${statusCode} ${statusMessage}`];
      for (const [key, value] of Object.entries(proxyRes.headers || {})) {
        if (Array.isArray(value)) value.forEach(v => lines.push(`${key}: ${v}`));
        else if (value !== undefined) lines.push(`${key}: ${value}`);
      }
      lines.push('', '');
      clientSocket.write(lines.join('\r\n'));
      if (body.length) clientSocket.write(body);
      clientSocket.end();
    });
  });

  proxyReq.on('error', () => {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    clientSocket.destroy();
  });

  proxyReq.end();
}

const server = http.createServer(proxyHttpRequest);
server.on('upgrade', proxyUpgrade);

server.listen(PORT, () => {
  console.log(`[admin-gateway] listening on :${PORT} -> ${CORE_TARGET.origin} (scope=${ADMIN_SCOPE})`);
});

