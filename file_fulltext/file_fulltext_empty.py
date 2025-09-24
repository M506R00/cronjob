import os, shutil, json
import mysql.connector
from mysql.connector import Error

base_dir = os.path.dirname(os.path.abspath(__file__))

class FileFullEmpty:
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

  def remove_folder(self, folder_path):
    if os.path.exists(folder_path) and os.path.isdir(folder_path):
      try:
        shutil.rmtree(folder_path)
        print(f"✅ 已刪除資料夾及內容：{folder_path}")
      except Exception as e:
        print(f"❌ 刪除資料夾失敗：{folder_path}，原因：{e}")
    else:
      print(f"❌ 資料夾不存在或不是資料夾：{folder_path}")

  def empty_fulltext(self):
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

      try:
        update_sql = f"""
          UPDATE {filtered_database}.{matched_project['tableName']} SET {matched_project['fullTextCol']}='' WHERE {matched_project['fullTextCol']} LIKE '[file_%';
        """
        self.cursor.execute(update_sql)
        self.conn.commit()
        print(f"✅ 已清空：{filtered_database}.{matched_project['tableName']}.{matched_project['fullTextCol']}")
      except Exception as e:
        print(f"❌ 更新失敗：{filtered_database}.{matched_project['tableName']}，原因：{e}")

    self.close_mysql()

if __name__ == "__main__":
  empty = FileFullEmpty(base_dir)
  if empty.connect_mysql():
    empty.remove_folder(os.path.join(base_dir, 'downloads'))
    empty.empty_fulltext()
