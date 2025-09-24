const fs = require("fs");
const fsp = require("fs").promises;
const { join } = require("path");

class BackupFiles {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.logsPath = join(baseDir, "logs.json");
    this.dirsPath = join(baseDir, "dirs.json");
  }

  async init() {
    // 確保 logs.json 存在
    try {
      await fsp.stat(this.logsPath);
    } catch {
      await fsp.writeFile(this.logsPath, JSON.stringify([]));
    }

    // 確保 dirs.json 存在
    try {
      await fsp.stat(this.dirsPath);
    } catch {
      await fsp.writeFile(
        this.dirsPath,
        JSON.stringify([
          { src: "D:\\wamp64\\www\\src", dist: "D:\\wamp64\\www\\dist" },
          { src: "/wamp64/www/src", dist: "/wamp64/www/dist" },
        ])
      );
    }
  }

  async copyFile(src, dist) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(src);
      const writeStream = fs.createWriteStream(dist);

      readStream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("close", resolve);

      readStream.pipe(writeStream);
    });
  }

  async copyDir(src, dist) {
    try {
      await fsp.mkdir(dist, { recursive: true });
      const paths = await fsp.readdir(src);

      for (const name of paths) {
        const _src = join(src, name);
        const _dist = join(dist, name);
        const stat = await fsp.stat(_src);

        if (stat.isFile()) {
          try {
            await fsp.stat(_dist); // 已存在就跳過
          } catch {
            await this.copyFile(_src, _dist);

            // 寫入 logs.json
            const logs = JSON.parse(await fsp.readFile(this.logsPath));
            logs.push({
              src: _src,
              dist: _dist,
              datetime: new Date().toISOString(),
            });
            await fsp.writeFile(this.logsPath, JSON.stringify(logs, null, 2));

            console.log("✅ Copied:", _src);
          }
        } else if (stat.isDirectory()) {
          await this.copyDir(_src, _dist); // 遞迴
        }
      }
    } catch (err) {
      console.error("❌ copyDir error:", err);
    }
  }

  async run() {
    console.log("🚀 Start to backup files...");
    await this.init();

    const dirs = JSON.parse(await fsp.readFile(this.dirsPath));
    for (const dir of dirs) {
      console.log(`📂 Backup: ${dir.src} → ${dir.dist}`);
      await this.copyDir(dir.src, dir.dist);
    }

    console.log("🎉 Backup finished!");
  }
}

// ---- 主程式 ----
(async () => {
  const backup = new BackupFiles(__dirname);
  await backup.run();
})();
