// 🧩 Node.js 內建模組
const fs = require("fs");
const path = require("path");

// 📦 第三方模組
const Jimp = require("jimp"); // 用來處理圖片（裁切、灰階、轉格式等），常搭配 OCR 前處理使用
const Tesseract = require("tesseract.js"); // 進行圖片 OCR（光學文字辨識），支援多語言（包含繁體中文）
const XLSX = require("xlsx"); // 解析 .xlsx Excel 檔案（純資料）
const { XMLParser } = require("fast-xml-parser"); // 快速解析 XML，可用於解讀某些 Office 檔案內部結構或設定
const mammoth = require("mammoth"); // 專門用來提取 Word .docx 文件的純文字與簡單結構，適合文字抽取使用
const pdf = require("pdf-poppler"); // 需要安裝 Poppler 套件，進行 PDF 渲染、轉圖片等，常用於處理掃描型 PDF
const pdfParse = require("pdf-parse"); // 用來解析文字型 PDF 檔案並擷取內容
const unzipper = require("unzipper"); // 用來解壓縮 zip 檔案（docx、pptx、xlsx 本質是 zip 格式）
const xml2js = require("xml2js"); // 	將 XML 轉為 JavaScript 物件，方便進一步操作

class DocumentTextExtractor {
  constructor(showLog = false, outputFolder = "./output") {
    this.minWidth = 100;
    this.minHeight = 100;
    this.pdfTextLength = 100;
    this.showLog = showLog;
    this.outputFolder = outputFolder;
    this.imageExtensions = [".jpg", ".jpeg", ".png", ".bmp", ".gif"];

    if (!fs.existsSync(this.outputFolder)) {
      fs.mkdirSync(this.outputFolder);
    }
  }

  cleanText(text) {
    return text
      .replace(/\r\n|\r/g, "\n") // 標準化換行符號
      .replace(
        /(TableCell|Standard|TableCellTableRow|Tabletrue|TableRow|TableColumn|string|float)/g,
        ""
      ) // 移除 OCR 表格雜訊字串
      .replace(
        /[^\u4e00-\u9fa5a-zA-Z0-9，。！？；：“”‘’、()\[\]【】《》—\-,.?!;:"' \n]/g,
        ""
      ) // 移除非法字元（保留常用標點符號與空格）
      .replace(/(ce|ro)[0-9]+/g, "") // 移除 ODS 表格雜訊字串
      .replace(/,+/g, "") // 移除多逗號
      .replace(/[ \t]+/g, " ") // 移除多空格
      .replace(/^[0-9]+\n/gm, "") // 移除僅為數字加換行的行（表格 row 編號）
      .replace(/\n{2,}/g, "\n") // 合併多重換行成單一換行
      .replace(/ /g, "") // 移除所有空格
      .trim(); // 去除首尾空白
  }

  async isTextPdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    try {
      const data = await pdfParse(dataBuffer);
      const text = data.text.trim();
      return text.length > this.pdfTextLength;
    } catch (err) {
      return false;
    }
  }

  async extractTextFromTextPdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return this.cleanText(data.text);
  }

  async convertPdfToImages(filePath, outputBaseDir, baseName) {
    const options = {
      format: "png",
      out_dir: outputBaseDir,
      out_prefix: baseName,
      page: null,
      dpi: 400,
    };

    try {
      await pdf.convert(filePath, options);
      if (this.showLog) console.log(`✅ PDF轉圖片成功：${filePath}`);
    } catch (error) {
      console.error(`❌ PDF轉圖片失敗：${filePath}`, error);
      throw error;
    }
  }

  async ocrImageWithRotation(imagePath) {
    const angles = [0, 90, 180, 270];
    const image = await Jimp.read(imagePath);
    let allText = "";

    for (const angle of angles) {
      try {
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        if (width >= this.minWidth && height >= this.minHeight) {
          // 對符合大小的圖片進行處理
          const rotatedImage = image.clone().rotate(angle);
          const rotatedBuffer = await rotatedImage.getBufferAsync(
            Jimp.MIME_PNG
          );
          // node_modules\tesseract.js\src\createWorker.js:217:15 // 將 throw Error(data); 改為 console.warn(data);
          const {
            data: { text },
          } = await Tesseract.recognize(rotatedBuffer, "chi_tra+eng", {
            tessedit_pageseg_mode: 6,
            logger: (m) =>
              this.showLog
                ? console.log(
                    `  [OCR] ${path.basename(imagePath)} @ ${angle}°: ${
                      m.status
                    }`
                  )
                : null,
          });
          const cleaned = this.cleanText(text);
          if (this.showLog)
            console.log(`[OCR] ${path.basename(imagePath)} text: ${cleaned}`);
          allText += cleaned;
        } else {
          console.log(`圖片太小，不處理 (${width}x${height})`);
        }
      } catch (err) {
        console.warn(`[WARN] OCR failed @ ${angle}°:`, err.message);
      }
    }

    return allText;
  }

  async processPdfFile(filePath) {
    const baseName = path.basename(filePath, ".pdf");
    const outputBaseDir = path.join(this.outputFolder, baseName);

    let fullText = "";

    const isText = await this.isTextPdf(filePath);
    if (isText) {
      if (this.showLog)
        console.log(`📄 [${filePath}] 為文字型 PDF，直接擷取文字`);
      fullText = await this.extractTextFromTextPdf(filePath);
      if (fullText.length > this.pdfTextLength) return fullText;
    }

    if (!fs.existsSync(outputBaseDir)) fs.mkdirSync(outputBaseDir);
    if (this.showLog)
      console.log(`🖼️ [${filePath}] 為掃描型 PDF，進行圖片轉換與 OCR`);
    await this.convertPdfToImages(filePath, outputBaseDir, baseName);
    const imageFiles = fs
      .readdirSync(outputBaseDir)
      .filter((f) => f.startsWith(baseName) && f.endsWith(".png"))
      .sort();

    for (const img of imageFiles) {
      const imagePath = path.join(outputBaseDir, img);
      if (this.showLog) console.log(`🔍 OCR 辨識：${img}`);
      const text = await this.ocrImageWithRotation(imagePath);
      // fullText += `\n\n--- [${img}] ---\n\n`;
      fullText += text;

      try {
        fs.unlinkSync(imagePath);
        if (this.showLog) console.log(`🗑️ 刪除圖片：${img}`);
      } catch (err) {
        console.warn(`⚠️ 刪除圖片失敗：${img}`, err);
      }
    }

    try {
      fs.rmSync(outputBaseDir, { recursive: true, force: true });
      if (this.showLog) console.log(`🗑️ 刪除資料夾：${outputBaseDir}`);
    } catch (err) {
      console.warn(`⚠️ 刪除資料夾失敗：${outputBaseDir}`, err);
    }
    if (this.showLog) console.log(`✅ 完成文字輸出：${filePath}`);

    return fullText;
  }

  async processImageFile(filePath) {
    const imagePath = filePath;
    if (this.showLog) console.log(`🖼️ 圖片OCR處理：${filePath}`);
    return await this.ocrImageWithRotation(imagePath);
  }

  async processTxtFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      if (this.showLog) console.log(`📄 TXT 處理完成：${filePath}`);

      return this.cleanText(content);
    } catch (error) {
      console.error(`❌ 處理 TXT 失敗：${filePath}`, error);
    }
  }

  async processDocxFile(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    if (this.showLog) console.log(`📄 Word 處理完成：${filePath}`);

    return this.cleanText(result.value);
  }

  async processExcelFile(filePath) {
    const workbook = XLSX.readFile(filePath);

    let fullText = "";
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_csv(sheet);
      // fullText += `\n\n--- [${sheetName}] ---\n\n`;
      fullText += data;
    });
    fullText = this.cleanText(fullText);
    if (this.showLog) console.log(`📊 Excel 處理完成：${filePath}`);

    return fullText;
  }

  async processPptxFile(filePath) {
    // 遞迴擷取文字
    function extractTexts(node) {
      let texts = [];

      if (!node || typeof node !== "object") return texts;

      if ("a:t" in node) {
        const t = node["a:t"];
        if (Array.isArray(t)) {
          texts.push(
            ...t.map((el) => (typeof el === "string" ? el : el._ || ""))
          );
        } else {
          texts.push(typeof t === "string" ? t : t._ || "");
        }
      }

      for (const key in node) {
        const val = node[key];
        if (Array.isArray(val)) {
          val.forEach((child) => {
            texts.push(...extractTexts(child));
          });
        } else if (typeof val === "object") {
          texts.push(...extractTexts(val));
        }
      }

      return texts;
    }

    try {
      // 解壓 pptx
      const directory = await unzipper.Open.file(filePath);

      // 找出所有 slide xml 檔案
      const slideFiles = directory.files.filter(
        (f) => f.path.startsWith("ppt/slides/slide") && f.path.endsWith(".xml")
      );

      let fullText = "";

      for (let i = 0; i < slideFiles.length; i++) {
        const slideFile = slideFiles[i];
        const content = await slideFile.buffer();
        const slideXml = content.toString("utf8");
        const parsedXml = await xml2js.parseStringPromise(slideXml);

        const slideTexts = extractTexts(parsedXml);
        // fullText += `--- Slide ${i + 1} ---\n`;
        fullText += slideTexts.join("\n") + "\n\n";
      }

      if (this.showLog) console.log(`🖼️ PowerPoint 處理完成：${filePath}`);

      return this.cleanText(fullText);
    } catch (error) {
      console.error(`❌ 處理 PowerPoint 失敗：${filePath}`, error);
    }
  }

  async processOpenDocumentFile(filePath) {
    const baseName = path.basename(filePath, path.extname(filePath));
    const outputFile = path.join(this.outputFolder, baseName);

    try {
      // 解壓 content.xml 到字串
      const directory = await unzipper.Open.file(filePath);
      const contentFile = directory.files.find((d) => d.path === "content.xml");
      if (!contentFile) {
        throw new Error("content.xml not found in the OpenDocument file");
      }
      const contentXml = await contentFile.buffer();

      // XML 解析器設定
      const parser = new XMLParser({
        ignoreAttributes: false,
        ignoreDeclaration: true,
        textNodeName: "#text",
        trimValues: true,
      });

      const jsonObj = parser.parse(contentXml.toString());

      // 針對.odt/.ods/.odp，大多文字都在 office:body -> office:text (odt) 或 office:spreadsheet (ods) / office:presentation (odp)
      // 這邊先嘗試抽取 office:body.office:text 下的純文字（適用.odt）
      // 如要支援其他格式，可再擴充解析邏輯
      let extractedText = "";

      function extractTextFromNode(node) {
        if (typeof node === "string") {
          extractedText += node + "\n";
        } else if (typeof node === "object" && node !== null) {
          for (const key in node) {
            if (key === "#text") {
              extractedText += node[key] + "\n";
            } else {
              extractTextFromNode(node[key]);
            }
          }
        }
      }

      // 根據不同格式，嘗試定位文字節點
      if (jsonObj["office:document-content"]) {
        const officeBody = jsonObj["office:document-content"]["office:body"];
        if (officeBody) {
          // .odt 典型結構
          if (officeBody["office:text"]) {
            extractTextFromNode(officeBody["office:text"]);
          }
          // .ods 通常是 office:spreadsheet
          else if (officeBody["office:spreadsheet"]) {
            extractTextFromNode(officeBody["office:spreadsheet"]);
          }
          // .odp 通常是 office:presentation
          else if (officeBody["office:presentation"]) {
            extractTextFromNode(officeBody["office:presentation"]);
          }
        }
      }

      if (this.showLog)
        console.log(`✅ OpenDocument 文字擷取完成：${outputFile}`);

      return this.cleanText(extractedText);
    } catch (error) {
      console.error(`❌ 處理 OpenDocument 失敗：${filePath}`, error);
    }
  }

  async extract(filePath) {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return "";
    }

    const ext = path.extname(filePath).toLowerCase();
    let fullText = "";
    try {
      if (ext === ".pdf") {
        fullText = await this.processPdfFile(filePath);
      } else if (ext === ".txt") {
        fullText = await this.processTxtFile(filePath);
      } else if (ext === ".docx") {
        fullText = await this.processDocxFile(filePath);
      } else if (ext === ".xlsx") {
        fullText = await this.processExcelFile(filePath);
      } else if (ext === ".pptx") {
        fullText = await this.processPptxFile(filePath);
      } else if ([".odt", ".ods", ".odp"].includes(ext)) {
        fullText = await this.processOpenDocumentFile(filePath);
      } else if (this.imageExtensions.includes(ext)) {
        fullText = await this.processImageFile(filePath);
      } else {
        if (this.showLog) console.log(`🚫 忽略不支援檔案：${filePath}`);
      }
      return fullText;
    } catch (error) {
      console.error(`❌ 處理失敗：${filePath}`, error);
      return "";
    }
  }
}
module.exports = DocumentTextExtractor;
