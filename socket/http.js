//防火牆->輸入規則->新增規則->連接埠->port:3000->允許連線->check all->socket->complete!
const { SocketServer } = require('./socketServer');
const app = require('express')();
const http = require('http');

// 建立 HTTP 伺服器
const httpServer = http.createServer(app);

new SocketServer(httpServer);
