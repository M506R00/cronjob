const os = require("os");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const mysql = require("mysql2/promise");
const { execSync } = require("child_process");
const ConfigManager = require("./ConfigManager");

class DatabaseExport extends ConfigManager {
  constructor() {
    super(); // 呼叫父類別的建構子以初始化配置
    this.CONFIG = this.getConfig(); // 獲取配置
    this.chunkSize = 50 * 1024 * 1024; // 50MB
    this.execGit = true;
    this.exportDatabases();
  }

  // 取得本機的 IPv4 地址
  getLocalIPAddress() {
    const networkInterfaces = os.networkInterfaces();
    for (const iface of Object.values(networkInterfaces)) {
      for (const details of iface) {
        if (details.family === "IPv4" && !details.internal) {
          return details.address;
        }
      }
    }
    return "127.0.0.1"; // 無法取得時回傳 localhost
  }

  // 讀取資料庫連線資訊
  async readConnectionConfig() {
    const CONFIG = JSON.parse(fs.readFileSync(this.CONFIG.CONNECTION_FILE));
    return CONFIG;
  }

  // 確保備份資料夾存在
  ensureDirectoryExists() {
    if (!fs.existsSync(this.CONFIG.BACKUP_DIRECTORY)) {
      fs.mkdirSync(this.CONFIG.BACKUP_DIRECTORY, { recursive: true });
      fs.writeFileSync(path.join(this.CONFIG.BACKUP_DIRECTORY, ".gitkeep"), "");
    }
  }

  // 執行指令
  executeCommands(commands) {
    commands.forEach((cmd) => {
      console.log(cmd);
      execSync(cmd, { cwd: this.CONFIG.BACKUP_DIRECTORY, stdio: "inherit" });
    });
  }

  // 將大 SQL 檔案按行切割
  splitSQLFileByLine(sqlFilePath) {
    const content = fs.readFileSync(sqlFilePath, "utf8");
    const lines = content.split(/\r?\n/);

    const splitFiles = [];
    let temp = [];
    let size = 0;
    let index = 0;

    for (const line of lines) {
      size += Buffer.byteLength(line + "\n");
      temp.push(line);

      if (size >= this.chunkSize) {
        const partFile = `${sqlFilePath}.part${String(index).padStart(3, "0")}`;
        fs.writeFileSync(partFile, temp.join("\n"), "utf8");
        splitFiles.push(partFile);
        temp = [];
        size = 0;
        index++;
      }
    }

    if (temp.length > 0) {
      const partFile = `${sqlFilePath}.part${String(index).padStart(3, "0")}`;
      fs.writeFileSync(partFile, temp.join("\n"), "utf8");
      splitFiles.push(partFile);
    }

    return splitFiles;
  }

  // 修改 dumpAndCompress 方法
  async dumpAndCompress(database, host, user, password) {
    const sqlFilePath = path.join(
      this.CONFIG.BACKUP_DIRECTORY,
      `${database}.sql`
    );

    // 匯出 SQL
    const dumpCmd = `mysqldump --no-defaults -h ${host} -u ${user} -p"${password}" --databases ${database} --add-drop-database > "${sqlFilePath}"`;
    console.log(dumpCmd);
    execSync(dumpCmd, { stdio: "inherit" });

    // 檢查檔案大小，決定是否切割
    const stats = fs.statSync(sqlFilePath);
    let sqlFilesToCompress = [sqlFilePath];

    if (stats.size > this.chunkSize) {
      sqlFilesToCompress = this.splitSQLFileByLine(sqlFilePath);
      fs.unlinkSync(sqlFilePath); // 刪掉原始大檔
    }

    // 壓縮每個檔案
    const gzFiles = [];
    for (const file of sqlFilesToCompress) {
      const gzFilePath = `${file}.gz`;
      const input = fs.createReadStream(file);
      const output = fs.createWriteStream(gzFilePath);
      const gzip = zlib.createGzip();

      await new Promise((resolve, reject) => {
        input
          .pipe(gzip)
          .pipe(output)
          .on("finish", () => {
            fs.unlinkSync(file); // 壓縮完成刪掉原始 SQL
            console.log(`✅ ${file} 壓縮完成`);
            gzFiles.push(gzFilePath);
            resolve();
          })
          .on("error", reject);
      });
    }

    console.log(`✅ ${database} 匯出並壓縮完成`);
    return gzFiles; // ✅ 回傳壓縮檔清單
  }

  // 主程序，執行資料庫備份
  async exportDatabases() {
    let connection;
    try {
      const { host, user, password } = await this.readConnectionConfig();
      connection = await mysql.createConnection({ host, user, password });

      const localIPAddress = this.getLocalIPAddress();

      const [sendServers] = await connection.execute(
        "SELECT ss_value FROM cpc_db.systemsettings_tab WHERE ss_id='send_servers'"
      );

      if (
        sendServers.length !== 1 ||
        !sendServers[0].ss_value.split(",").includes(localIPAddress)
      ) {
        console.error(`${localIPAddress} 並不在 send_servers 的清單中!`);
        return;
      }

      let [databases] = await connection.execute(`
        SELECT SCHEMA_NAME FROM information_schema.schemata
        WHERE SCHEMA_NAME NOT IN ('phpmyadmin', 'mysql', 'information_schema', 'performance_schema', 'sys')
      `);

      databases = databases
        .map(({ SCHEMA_NAME }) => SCHEMA_NAME)
        .filter(
          (database) => !process.argv[2] || database.startsWith(process.argv[2])
        );

      if (databases.length === 0) {
        console.error("沒有可備份的資料庫!");
        return;
      }

      this.ensureDirectoryExists();

      if (this.execGit) this.executeCommands(["git checkout .", "git pull"]);

      // 匯出並壓縮每個 DB
      const gzFiles = [];
      for (const database of databases) {
        const gzFile = await this.dumpAndCompress(
          database,
          host,
          user,
          password
        );
        gzFiles.push(...gzFile);
      }

      if (this.execGit) {
        this.executeCommands(gzFiles.map((gzFile) => `git add "${gzFile}"`));
        this.executeCommands([
          `git commit -m "database backup"`,
          "git push",
          "git gc",
        ]);
      }

      console.log(`所有資料庫(${databases.length})皆備份完成!`);
    } catch (err) {
      console.error("發生錯誤:", err.message);
    } finally {
      if (connection) await connection.end();
    }
  }
}

new DatabaseExport();
