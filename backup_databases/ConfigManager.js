const fs = require("fs");
const path = require("path");

class ConfigManager {
  constructor() {
    this.CONFIG = {
      EXTENSIONS: [".sql", ".gz"], // 設定檔案的副檔名
      CONNECTION_FILE: path.join(__dirname, "connect.json"),
      BACKUP_DIRECTORY: path.join(__dirname, "databases"),
    };

    this.ensureConnectionFile();
  }

  ensureConnectionFile() {
    if (!fs.existsSync(this.CONFIG.CONNECTION_FILE)) {
      fs.writeFileSync(
        this.CONFIG.CONNECTION_FILE,
        JSON.stringify(
          { host: "localhost", user: "root", password: "" }, // 預設資料庫連線資訊
          null,
          2
        )
      );
    }
  }

  getConfig() {
    return this.CONFIG;
  }
}

module.exports = ConfigManager;
