<?php
// 🚀 將所有非系統資料庫及資料表轉為 utf8mb4_0900_ai_ci 並將 MyISAM 表轉為 InnoDB
header('Content-Type: text/html; charset=utf-8');
set_time_limit(0); // 不限制執行時間
$host = "localhost";
$user = "root";
$pass = ""; // 修改成你的 MySQL 密碼

$mysqli = new mysqli($host, $user, $pass);
if ($mysqli->connect_error) {
  die("連線失敗: " . $mysqli->connect_error);
}

echo "開始轉換所有非系統資料庫...<br />";

// 系統資料庫清單
$systemDbs = ["information_schema", "mysql", "performance_schema", "sys"];

$character = 'utf8mb4';
$collate = $character . '_0900_ai_ci';
$engine_innodb = 'InnoDB';
$engine_myisam = 'MyISAM';

// 找出所有資料庫
$result = $mysqli->query("SHOW DATABASES");
while ($row = $result->fetch_assoc()) {
  $dbName = $row['Database'];
  if (in_array($dbName, $systemDbs)) {
    continue; // 跳過系統資料庫
  }

  echo "⚙️ 處理資料庫: $dbName<br />";

  // 修改資料庫預設 collation
  $sql = "ALTER DATABASE `$dbName` CHARACTER SET $character COLLATE $collate";
  if ($mysqli->query($sql)) {
    echo "  ✅ 資料庫已轉換為 $collate<br />";
  } else {
    echo "  ❌ 資料庫轉換失敗: " . $mysqli->error . "<br />";
  }

  // 取得所有資料表
  $mysqli->select_db($dbName);
  $tables = $mysqli->query("SHOW TABLE STATUS");
  while ($tableRow = $tables->fetch_assoc()) {
    $tableName = $tableRow['Name'];
    $engine = strtoupper($tableRow['Engine']);

    echo "<p>➤ 處理資料表: $dbName.$tableName (引擎: $engine)<br />";

    // 轉換字符集與 collation
    $sql = "ALTER TABLE `$tableName` CONVERT TO CHARACTER SET $character COLLATE $collate";
    if ($mysqli->query($sql)) {
      echo "  ✔️ 字元集已轉換為 $collate<br />";
    } else {
      echo "  ❌ 字元集轉換失敗: " . $mysqli->error . "<br />";
    }

    // 根據引擎做處理
    if ($engine === strtoupper($engine_myisam)) {
      $sql = "ALTER TABLE `$tableName` ENGINE=$engine_innodb";
      if ($mysqli->query($sql)) {
        echo "  ✔️ 引擎已由 $engine_myisam 轉為 $engine_innodb<br />";
      } else {
        echo "  ❌ 引擎轉換失敗: " . $mysqli->error . "<br />";
      }
    } elseif ($engine === strtoupper($engine_innodb)) {
      echo "  ℹ️ 引擎已是 $engine_innodb，無需轉換<br />";
    } else {
      echo "  <span style='color:red'>⚠️ 引擎非 $engine_myisam/ $engine_innodb: $engine</span><br />";
    }
    echo '</p>';
  }
  echo '<hr />';
}

$mysqli->close();
echo "🎉 所有資料庫已處理完成！<br />";
