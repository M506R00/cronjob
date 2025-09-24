# 防火牆->輸入規則->新增規則->連接埠->port:3306->允許連線->check all->Mysql->complete!
# 安裝 Python，執行指令「py -V」確認是否安裝成功
# py -m pip install openpyxl pandas requests SnowNLP mysql-connector-python odfpy openpyxl pytesseract PyMuPDF pdfplumber python-docx python-pptx ezdxf opencv-python
# 將 Tesseract-OCR 放置 D:\Tesseract-OCR
# 將 Tesseract-OCR 的安裝路徑加入系統環境變數 Path > D:\Tesseract-OCR
# 重啟電腦後，執行指令「tesseract --version」確認是否安裝成功
# 確認 config.json 的設定正確
import os
from file_fulltext_processor import FileFullTextProcessor

base_dir = os.path.dirname(os.path.abspath(__file__))

# import sys
# from file_fulltext_extractor import FileFullTextExtractor
# extractor = FileFullTextExtractor()
# result = extractor.extract_text(f'{base_dir}/memo109170.pdf')
# print(result)
# sys.exit()

if __name__ == "__main__":
  processor = FileFullTextProcessor(base_dir)
  if processor.connect_mysql():
    while True:
      has_processed = processor.process_missing_texts()
      if not has_processed:
        print("沒有更多資料，程式結束!")
        break
    processor.close_mysql()
