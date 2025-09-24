import os, json, re, requests, urllib3, socket
import mysql.connector
from datetime import datetime
from mysql.connector import Error
from file_fulltext_extractor import FileFullTextExtractor

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class FileFullTextProcessor:
  def __init__(self, base_dir, config_file="config.json"):
    self.base_dir = base_dir
    try:
      with open(os.path.join(self.base_dir, config_file), "r", encoding="utf-8") as f:
        config = json.load(f)
    except Error as e:
      print("❌ 連線錯誤：", e)

    self.config_file_url = config.get('file_url', '')
    self.config_host = config.get('host', '')
    self.config_user = config.get('user', '')
    self.config_password = config.get('password', '')
    self.config_projects = config.get('projects', '')

    self.conn = None
    self.cursor = None

  def connect_mysql(self):
    try:
      self.conn = mysql.connector.connect(host= self.config_host, user= self.config_user, password= self.config_password)
      if self.conn.is_connected():
        self.cursor = self.conn.cursor(dictionary=True)
        print(f"✅ 成功連線到 {self.config_host} MySQL 伺服器")
        return True
    except Error as e:
      print(f"❌ {self.config_host} 連線錯誤：", e)
      return False

  def close_mysql(self):
    try:
      if self.cursor:
        self.cursor.close()
      if self.conn and self.conn.is_connected():
        self.conn.close()
        print(f"🔒 {self.config_host} 資料庫連線已關閉")
    except Error as e:
      print("❌ 關閉錯誤：", e)

  def process_missing_texts(self):
    if not self.conn or not self.cursor:
      print("❌ 尚未建立資料庫連線")
      return False

    self.cursor.execute("SHOW DATABASES;")
    all_databases = [row['Database'] for row in self.cursor.fetchall()]
    filtered_databases = []
    for proj in self.config_projects:
      matched_dbs = [db for db in all_databases if db.startswith(proj['projectName'])]
      filtered_databases.extend(matched_dbs)

    for filtered_database in filtered_databases:
      matched_project = next(
        (c for c in self.config_projects if filtered_database.startswith(c["projectName"])),
        None
      )
      if not matched_project:
        continue

      # 確認 table 是否存在
      self.cursor.execute(f"SHOW TABLES FROM {filtered_database} LIKE '{matched_project['tableName']}';")
      if not self.cursor.fetchone():
        continue

      sql = f"""
        SELECT * FROM {filtered_database}.{matched_project['tableName']}
        WHERE {matched_project['fullTextCol']}='' OR {matched_project['fullTextCol']} IS NULL
        ORDER BY RAND()
        LIMIT 1;
      """
      self.cursor.execute(sql)
      row = self.cursor.fetchone()

      if row:
        filename = os.path.basename(row[matched_project['filePathCol']])
        save_path = os.path.join(self.base_dir, "downloads", filename)
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

        try:
          file_url = f"{self.config_file_url}/{matched_project['projectName']}/api/{re.sub(r'\.\/', '', row[matched_project['filePathCol']])}"
          response = requests.get(file_url, stream=True, timeout=30, verify=False)
          response.raise_for_status()

          with open(save_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
              f.write(chunk)
          print(f"✅ [{filtered_database}.{matched_project['tableName']}.{matched_project['idCol']}={row[matched_project['idCol']]}] 檔案下載完成 → {save_path}")

          update_sql = f"""
            UPDATE {filtered_database}.{matched_project['tableName']}
            SET {matched_project['fullTextCol']} = %s
            WHERE {matched_project['idCol']} = %s;
          """
          self.cursor.execute(update_sql, ( f"[file_processing] {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | IP:{socket.gethostbyname(socket.gethostname())}", row[matched_project['idCol']]))
          self.conn.commit()

          extractor = FileFullTextExtractor()
          result = extractor.extract_text(save_path)

          if result['status'] == 'ok':
            text_to_update = result['text'] if result['text'] else f"[file_extract_empty] {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | IP:{socket.gethostbyname(socket.gethostname())}"
            update_sql = f"""
              UPDATE {filtered_database}.{matched_project['tableName']}
              SET {matched_project['fullTextCol']} = %s
              WHERE {matched_project['idCol']} = %s;
            """
            self.cursor.execute(update_sql, (text_to_update, row[matched_project['idCol']]))
            self.conn.commit()

            if result['text']:
              print(f"✅ 資料庫更新成功：{filtered_database}.{matched_project['tableName']}.{matched_project['idCol']} = {row[matched_project['idCol']]}")
            else:
              print("❌ 文本提取為空值")

            return True  # 有處理到一筆

          else:
            print(f"❌ 文本提取失敗：{result.get('error', '未知錯誤')}")

        except Exception as e:
          update_sql = f"""
            UPDATE {filtered_database}.{matched_project['tableName']}
            SET {matched_project['fullTextCol']} = %s
            WHERE {matched_project['idCol']} = %s;
          """
          self.cursor.execute(update_sql, ( f"[file_not_found] {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | IP:{socket.gethostbyname(socket.gethostname())}", row[matched_project['idCol']]))
          self.conn.commit()
          print(f"❌ 檔案下載或處理失敗：{e}")

        finally:
          self.safe_remove(save_path)

    return False  # 沒有缺漏資料

  def safe_remove(self, file_path):
    """
    嘗試刪除檔案，如果失敗則顯示警告訊息，但不中斷程式
    """
    if os.path.exists(file_path):
      try:
        os.remove(file_path)
        # print(f"✅ 已刪除檔案: {file_path}")
      except Exception as e:
        print(f"⚠ 無法刪除檔案 {file_path}，原因: {e}")