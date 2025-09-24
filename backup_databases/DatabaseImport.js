const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execSync } = require("child_process");
const ConfigManager = require("./ConfigManager");
const mysql = require("mysql2/promise");

class DatabaseImport extends ConfigManager {
  constructor() {
    super();
    this.CONFIG = this.getConfig();
    this.tempFiles = [];
    this.cleanOldSQL();
    this.importDatabases();
  }

  cleanOldSQL() {
    const files = fs.readdirSync(this.CONFIG.BACKUP_DIRECTORY);
    files.forEach((file) => {
      if (file.endsWith(".sql"))
        fs.unlinkSync(path.join(this.CONFIG.BACKUP_DIRECTORY, file));
    });
  }

  async importDatabases() {
    let connection;
    try {
      const { host, user, password } = await this.readConnectionConfig();
      connection = await mysql.createConnection({ host, user, password });

      const files = fs
        .readdirSync(this.CONFIG.BACKUP_DIRECTORY)
        .filter((f) => !process.argv[2] || f.startsWith(process.argv[2]));

      const gzFiles = files.filter((f) => f.endsWith(".gz"));

      if (gzFiles.length === 0) return console.error("找不到任何 .gz 檔案");

      // 生成批次檔內容
      const batLines = [];

      // 先找出所有分割檔 group
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

      // 處理單一 .gz
      for (const file of singleGzFiles) {
        const sqlPath = await this.decompressGz(file);
        batLines.push(this.buildMySQLCommand(sqlPath, host, user, password));
      }

      // 處理分割檔
      for (const base in partGroups) {
        const files = partGroups[base].sort(); // 確保 part 排序正確
        const mergedPath = path.join(
          this.CONFIG.BACKUP_DIRECTORY,
          `${base}.merged.sql`
        );

        const writeStream = fs.createWriteStream(mergedPath, "utf8");

        for (const partFile of files) {
          const partPath = await this.decompressGz(partFile);
          const data = fs.readFileSync(partPath, "utf8");
          writeStream.write(data + "\n");
          this.tempFiles.push(partPath); // 記錄臨時解壓檔
        }

        writeStream.close();
        this.tempFiles.push(mergedPath); // 記錄合併檔
        batLines.push(this.buildMySQLCommand(mergedPath, host, user, password));
      }

      const batPath = path.join(
        this.CONFIG.BACKUP_DIRECTORY,
        "import_databases.bat"
      );
      fs.writeFileSync(batPath, batLines.join("\r\n"), "utf8");

      // 執行批次檔
      try {
        execSync(batPath, { stdio: "inherit" });
        // 更新資料庫內容
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

  buildMySQLCommand(filePath, host, user, password) {
    return `mysql --default-character-set=utf8mb4 --binary-mode -h ${host} -u ${user} -p"${password}" < "${filePath.replace(
      /\\/g,
      "/"
    )}"`;
  }

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

  async readConnectionConfig() {
    return JSON.parse(fs.readFileSync(this.CONFIG.CONNECTION_FILE));
  }

  destructor() {
    this.tempFiles.forEach((file) => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  }
}

new DatabaseImport();
