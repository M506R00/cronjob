const fs = require("fs");
const { join, parse } = require("path");

class SocketServer {
  constructor(server) {
    this.CONFIG = {
      PORT: process.env.PORT || 3000,
      ORIGINS_FILE: join(__dirname, "origins.json"),
      SOCKET_DIR: join(__dirname, "session"),
    };
    this.showError = true;
    this.screenShotQueueSockets = new Set();
    this.setupDirectories();

    this.io = require("socket.io")(server, {
      allowEIO3: true,
      cors: {
        credentials: true,
        origin: JSON.parse(fs.readFileSync(this.CONFIG.ORIGINS_FILE)),
      },
      maxHttpBufferSize: 1e7, // 10MB
    });
    this.socketEvents = {
      loginRequest: (event, socket, userData) => {
        this.showLog(
          event,
          socket.id,
          `User: ${userData.ud_name}(${userData.ud_id})`
        );
        socket.broadcast.emit("loginAccept", userData);
        socket.broadcast.emit("toastAccept", {
          message: `${userData.ud_name}(${userData.ud_id}) 上線了。`,
          options: {
            title: userData.ud_department,
            variant: "primary",
          },
        });
        this.saveUserData(socket.id, userData);
        this.getOnlineUsers();
      },
      logoutRequest: (event, socket, userData) => {
        this.showLog(
          event,
          socket.id,
          `${this.getUserInfoBySocketId(socket.id)} => ${userData.ud_name}(${
            userData.ud_id
          })`
        );
        this.io.emit("logoutAccept", userData);
        this.io.emit("toastAccept", {
          message: `${userData.ud_name}(${userData.ud_id}) 下線了。`,
          options: {
            title: userData.ud_department,
            variant: "secondary",
          },
        });

        fs.readdirSync(this.CONFIG.SOCKET_DIR).forEach((file) => {
          const logoutUserData = JSON.parse(
            fs.readFileSync(join(this.CONFIG.SOCKET_DIR, file))
          );
          if (logoutUserData.ud_id === userData.ud_id) {
            logoutUserData.ud_id = null;
            this.saveUserData(parse(file).name, logoutUserData);
          }
        });
        this.getOnlineUsers();
      },
      updateTimestampRequest: (event, socket, lastActivityTime) => {
        this.showLog(
          event,
          socket.id,
          `User: ${this.getUserInfoBySocketId(socket.id)}`
        );
        const filePath = join(this.CONFIG.SOCKET_DIR, `${socket.id}.json`);
        try {
          const userData = JSON.parse(fs.readFileSync(filePath));
          userData.lastActivityTime =
            this.defaultLastActivityTime(lastActivityTime);
          this.saveUserData(socket.id, userData);
          this.getOnlineUsers();
        } catch (err) {
          if (this.showError)
            console.error(`Error processing ${filePath}:`, err.message);
        }
      },
      whoRequest: (event, socket, userData) => {
        this.showLog(
          event,
          socket.id,
          `User: ${userData.ud_name}(${userData.ud_id})`
        );
        this.saveUserData(socket.id, userData, false);
        this.getOnlineUsers();
      },
      onlineRequest: (event, socket) => {
        this.showLog(
          event,
          socket.id,
          `User: ${this.getUserInfoBySocketId(socket.id)}`
        );
        this.getOnlineUsers();
      },
      screenshotRequest: (
        event,
        socket,
        { clientSocketId, socketScreenId }
      ) => {
        if (!this.screenShotQueueSockets.has(clientSocketId)) {
          this.showLog(
            event,
            socket.id,
            `${this.getUserInfoBySocketId(
              socket.id
            )}.${socketScreenId} => ${this.getUserInfoBySocketId(
              clientSocketId
            )}`
          );
          this.screenShotQueueSockets.add(clientSocketId);
          this.io.to(clientSocketId).emit("screenshotAccept", {
            serverSocketId: socket.id,
            socketScreenId,
          });
        }
      },
      screenshotFeedbackRequest: (
        event,
        socket,
        { serverSocketId, socketScreenId, socketDataURL }
      ) => {
        this.showLog(
          event,
          socket.id,
          `${this.getUserInfoBySocketId(
            socket.id
          )} => ${this.getUserInfoBySocketId(serverSocketId)}.${socketScreenId}`
        );
        this.io.to(serverSocketId).emit("feedbackScreenshotAccept", {
          socketScreenId,
          socketDataURL,
        });
        this.screenShotQueueSockets.delete(socket.id);
      },
      evalRequest: (
        event,
        socket,
        { clientSocketId, socketScreenId, socketScript }
      ) => {
        this.showLog(event, socket.id, [
          `From: ${this.getUserInfoBySocketId(socket.id)}`,
          `To: ${this.getUserInfoBySocketId(clientSocketId)}`,
          `SocketScript: ${socketScript}`,
        ]);
        this.io.to(clientSocketId).emit("evalAccept", {
          serverSocketId: socket.id,
          socketScreenId,
          socketScript,
        });
      },
      evalFeedbackRequest: (
        event,
        socket,
        { serverSocketId, socketScreenId, socketMsg, status }
      ) => {
        this.showLog(event, socket.id, [
          `From: ${this.getUserInfoBySocketId(socket.id)}`,
          `To: ${this.getUserInfoBySocketId(serverSocketId)}`,
          `socketMsg: ${socketMsg}`,
          `status: ${status}`,
        ]);
        this.io.to(serverSocketId).emit("evalFeedbackAccept", {
          socketScreenId,
          socketMsg,
          status,
        });
      },
      disconnect: (event, socket) => {
        this.showLog(
          "disconnect",
          socket.id,
          `User: ${this.getUserInfoBySocketId(socket.id)}`
        );
        this.safeDeleteFile(join(this.CONFIG.SOCKET_DIR, `${socket.id}.json`));
        this.getOnlineUsers();
      },
    };

    this.initEvents();

    server.listen(this.CONFIG.PORT, () =>
      console.log(`Listening on *:${this.CONFIG.PORT}`)
    );
  }
  initEvents() {
    this.io.on("connection", (socket) => {
      this.showLog("connection", socket.id);

      // 3 秒後詢問對方身分
      setTimeout(() => socket.emit("whoAccept", socket.id), 3000);

      Object.entries(this.socketEvents).forEach(([event, func]) => {
        socket.on(event, (...args) => func(event, socket, ...args));
      });

      this.getOnlineUsers();
    });
  }
  getUserInfoBySocketId(socket_id) {
    const filePath = join(this.CONFIG.SOCKET_DIR, `${socket_id}.json`);
    try {
      const userData = JSON.parse(fs.readFileSync(filePath));
      return `${userData.ud_name}(${userData.ud_id})`;
    } catch (err) {
      if (this.showError)
        console.error(`Error processing ${filePath}:`, err.message);
      return "Unknown";
    }
  }
  showLog(event, socket_id, msg) {
    console.log(`[${this.getCurrentTime()}] [${event}]`);
    console.log(`Session: ${socket_id}`);
    if (msg) {
      console.log(Array.isArray(msg) ? msg.join("\r\n") : msg);
    }
    console.log("-".repeat(30));
  }
  saveUserData(socket_id, userData, delFile = true) {
    if (delFile)
      this.safeDeleteFile(join(this.CONFIG.SOCKET_DIR, `${socket_id}.json`));
    userData.lastActivityTime = this.defaultLastActivityTime(
      userData.lastActivityTime
    );
    this.ensureFileExists(
      join(this.CONFIG.SOCKET_DIR, `${socket_id}.json`),
      JSON.stringify(userData, null, 2)
    );
  }
  getCurrentTime() {
    const now = new Date();
    return `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  }
  // 初始化環境
  setupDirectories() {
    this.ensureFileExists(
      this.CONFIG.ORIGINS_FILE,
      JSON.stringify(["http://localhost", "http://localhost:8080"], null, 2)
    );
    this.ensureDirExists(this.CONFIG.SOCKET_DIR);

    // 確保 `session` 目錄存在後才清空
    try {
      fs.readdirSync(this.CONFIG.SOCKET_DIR).forEach((file) =>
        this.safeDeleteFile(join(this.CONFIG.SOCKET_DIR, file))
      );
    } catch (err) {
      if (this.showError)
        console.error(`Error clearing session directory:`, err.message);
    }
  }
  // 檢查並創建檔案或目錄
  ensureFileExists(filePath, defaultContent) {
    try {
      fs.statSync(filePath);
    } catch {
      fs.writeFileSync(filePath, defaultContent);
    }
  }
  ensureDirExists(dirPath) {
    try {
      fs.accessSync(dirPath);
    } catch {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  // 安全刪除檔案
  safeDeleteFile(filePath) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (this.showError)
          console.error(`Failed to delete ${filePath}:`, err.message);
      }
    }
  }

  // 取得 `session` 內的線上使用者
  getOnlineUsers() {
    const sockets = fs
      .readdirSync(this.CONFIG.SOCKET_DIR)
      .map((file) => {
        const filePath = join(this.CONFIG.SOCKET_DIR, file);
        try {
          const fileContent = fs.readFileSync(filePath, "utf8");
          const userData = JSON.parse(fileContent);
          return { ...userData, socket_id: parse(file).name };
        } catch (err) {
          if (this.showError)
            console.error(`Error reading ${filePath}:`, err.message);
          return null;
        }
      })
      .filter(Boolean);
    this.io.emit("onlineAccept", sockets);
  }
  defaultLastActivityTime(lastActivityTime) {
    return /^\d+$/.test(lastActivityTime) ? lastActivityTime : Date.now();
  }

  // 移除特定使用者的所有檔案
  removeUserFiles(ud_id) {
    fs.readdirSync(this.CONFIG.SOCKET_DIR).forEach((file) => {
      const filePath = join(this.CONFIG.SOCKET_DIR, file);
      try {
        const userData = JSON.parse(fs.readFileSync(filePath));
        if (userData.ud_id === ud_id) this.safeDeleteFile(filePath);
      } catch (err) {
        if (this.showError)
          console.error(`Error processing ${filePath}:`, err.message);
      }
    });
  }
}

module.exports = { SocketServer };
