//防火牆->輸入規則->新增規則->連接埠->port:3000->允許連線->check all->socket->complete!
const { SocketServer } = require('./socketServer');
const app = require('express')();
const https = require('https');
const { readFileSync } = require('fs');
const { join } = require('path');

// 建立 HTTPS 伺服器
const httpsServer = https.createServer(
  {
    key: readFileSync(join(__dirname, 'ssl', 'server.key')), // 私鑰
    cert: readFileSync(join(__dirname, 'ssl', 'server.crt')), // SSL 憑證
    ca: readFileSync(join(__dirname, 'ssl', 'ca_bundle.crt')), // CA 中繼憑證
  },
  app
);

new SocketServer(httpsServer);
