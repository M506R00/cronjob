/**
 * DatabaseImport
 *
 * 功能：
 * 1. 清理備份目錄中的舊 SQL 檔案
 * 2. 將 .gz 壓縮檔解壓成 .sql
 * 3. 支援分割檔（.part1.gz, .part2.gz ...）自動合併
 * 4. 產生跨平台的匯入指令檔（Windows → .bat, mac/Linux → .sh）
 * 5. 自動執行匯入指令，並更新指定的資料庫內容
 *
 * 特性：
 * - Windows 使用 .bat
 * - macOS/Linux 使用 .sh（並給予執行權限）
 * - 大檔案（>100MB）也能處理，因為解壓是串流處理
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execSync } = require("child_process");
const ConfigManager = require("./ConfigManager");
const mysql = require("mysql2/promise");

class DatabaseImport extends ConfigManager {
  constructor() {
    super();
    this.CONFIG = this.getConfig(); // 讀取系統設定
    this.tempFiles = []; // 記錄所有臨時檔案，最後會刪掉
    this.isWin = process.platform === "win32"; // 判斷平台
    this.options = { stdio: "inherit" }; // 預設執行選項
    if (!this.isWin) {
      this.options.shell = "/bin/bash"; // macOS / Linux 用 bash
    }

    this.cleanOldSQL(); // 清理舊的 SQL 檔案
    this.importDatabases(); // 開始匯入流程
  }

  /**
   * 清除備份目錄內的舊 SQL 檔案
   */
  cleanOldSQL() {
    const files = fs.readdirSync(this.CONFIG.BACKUP_DIRECTORY);
    files.forEach((file) => {
      if (file.endsWith(".sql")) {
        fs.unlinkSync(path.join(this.CONFIG.BACKUP_DIRECTORY, file));
      }
    });
  }

  /**
   * 匯入資料庫流程
   */
  async importDatabases() {
    let connection;
    try {
      // 讀取連線設定
      const { host, user, password } = await this.readConnectionConfig();
      connection = await mysql.createConnection({ host, user, password });

      // 過濾需要處理的檔案
      const files = fs
        .readdirSync(this.CONFIG.BACKUP_DIRECTORY)
        .filter((f) => !process.argv[2] || f.startsWith(process.argv[2]));

      const gzFiles = files.filter((f) => f.endsWith(".gz"));

      if (gzFiles.length === 0) {
        return console.error("找不到任何 .gz 檔案");
      }

      // 初始化匯入腳本內容
      const commandLines = this.isWin ? [] : ["#!/bin/bash", "set -e"];

      // 將檔案分為「單一壓縮檔」與「分割檔群組」
      const partGroups = {};
      const singleGzFiles = [];

      gzFiles.forEach((file) => {
        const match = file.match(/(.*)\.part\d+\.gz$/);
        if (match) {
          const base = match[1];
          if (!partGroups[base]) partGroups[base] = [];
          partGroups[base].push(file);
        } else {
          singleGzFiles.push(file);
        }
      });

      // 處理單一壓縮檔
      for (const file of singleGzFiles) {
        const sqlPath = await this.decompressGz(file);
        commandLines.push(
          this.buildMySQLCommand(sqlPath, host, user, password)
        );
      }

      // 處理分割檔
      for (const base in partGroups) {
        const files = partGroups[base].sort(); // 確保依序合併
        const mergedPath = path.join(
          this.CONFIG.BACKUP_DIRECTORY,
          `${base}.merged.sql`
        );

        const writeStream = fs.createWriteStream(mergedPath, "utf8");

        for (const partFile of files) {
          const partPath = await this.decompressGz(partFile);
          const data = fs.readFileSync(partPath, "utf8");
          writeStream.write(data + "\n");
          this.tempFiles.push(partPath); // 紀錄臨時解壓檔
        }

        writeStream.close();
        this.tempFiles.push(mergedPath); // 紀錄合併檔
        commandLines.push(
          this.buildMySQLCommand(mergedPath, host, user, password)
        );
      }

      // 寫出匯入腳本
      const commandPath = path.join(
        __dirname,
        `import_databases.${this.isWin ? "bat" : "sh"}`
      );
      fs.writeFileSync(
        commandPath,
        commandLines.join(this.isWin ? "\r\n" : "\n"),
        "utf8"
      );

      // macOS/Linux 需給予執行權限
      if (!this.isWin) {
        fs.chmodSync(commandPath, 0o755);
      }

      // 執行匯入腳本
      try {
        execSync(commandPath, this.options);

        // 匯入後更新必要資料
        const queries = [
          `UPDATE cpc_db.userdata_tab SET ud_password = ud_id;`,
          `UPDATE cpc_db.projectmanagement_tab SET pm_link = CONCAT('/', pm_id, '/dist');`,
          `UPDATE cpc_db.projectmanagement_tab SET pm_link = CONCAT('/', pm_id) WHERE pm_id IN ('flange', 'incident');`,
          `UPDATE cpc_db.projectmanagement_tab SET pm_link = '/store_system' WHERE pm_id = 'store';`,
        ];
        await Promise.all(queries.map((q) => connection.execute(q)));

        console.log("✅ 所有資料庫匯入完成");
      } catch (err) {
        console.error("❌ 匯入失敗:", err.message);
      }
    } catch (err) {
      console.error("匯入失敗:", err.message);
    } finally {
      if (connection) await connection.end();
      this.destructor();
    }
  }

  /**
   * 產生 MySQL 匯入指令
   */
  buildMySQLCommand(filePath, host, user, password) {
    return `mysql --default-character-set=utf8mb4 --binary-mode -h ${host} -u ${user} -p"${password}" < "${filePath.replace(
      /\\/g,
      "/"
    )}"`;
  }

  /**
   * 解壓縮 .gz 檔案為 .sql
   */
  decompressGz(file) {
    return new Promise((resolve, reject) => {
      const filePath = path.join(this.CONFIG.BACKUP_DIRECTORY, file);
      const sqlPath = filePath.replace(/\.gz$/, "");
      const input = fs.createReadStream(filePath);
      const output = fs.createWriteStream(sqlPath);
      const gunzip = zlib.createGunzip();

      input
        .pipe(gunzip)
        .pipe(output)
        .on("finish", () => {
          this.tempFiles.push(sqlPath);
          resolve(sqlPath);
        })
        .on("error", reject);
    });
  }

  /**
   * 讀取資料庫連線設定檔
   */
  async readConnectionConfig() {
    return JSON.parse(fs.readFileSync(this.CONFIG.CONNECTION_FILE));
  }

  /**
   * 清除所有臨時檔案
   */
  destructor() {
    this.tempFiles.forEach((file) => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  }
}

// 程式入口
new DatabaseImport();
