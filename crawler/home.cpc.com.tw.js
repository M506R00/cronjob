// https://home.cpc.com.tw/eis/pr/pr_asp/prm_div.asp
class CPCDataCrawler {
  constructor(username = "", password = "") {
    this.username = username;
    this.password = password;
    this.homeUrlCPC = "https://home.cpc.com.tw/";
    this.apiUrlCPC = "http://localhost/cpc/api/";
    this.types = [
      1, // 派用人員
      3, // 僱用人員
      5, // 約聘人員
      7, // 定期契約人員
    ];
    this.init();
  }
  async init() {
    await this.crawl();
  }
  trim(txt) {
    return String(txt)
      .trim()
      .replace(/[\s　]/g, "");
  }
  getTitle(cells, type) {
    const col4 = this.trim(cells[4].innerText);
    if (col4 === "M505080") {
      return "專案";
    }

    const col5 = this.trim(cells[5].innerText);
    if (col5) {
      return col5 === "場長" ? `工${col5}` : col5;
    }

    return type === 1 ? "工程師" : "";
  }
  getGender(txt) {
    return { 男: "M", 女: "F" }[txt] || "";
  }
  async fetch(url, params, col = "text") {
    try {
      const res = await fetch(url, params);
      return await res[col]();
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      return null;
    }
  }
  async fetchProfitLoss(chieseYear, month) {
    const arrayBuffer = await this.fetch(
      `${this.homeUrlCPC}a0400web/source/income/income${chieseYear}.htm`,
      {},
      "arrayBuffer"
    );
    if (!arrayBuffer) return;

    const decoder = new TextDecoder("big5"); // 使用 Big5 編碼解碼
    const HTML = decoder.decode(arrayBuffer);

    const parser = new DOMParser();
    const doc = parser.parseFromString(HTML, "text/html");

    let current = Array.from(doc.querySelectorAll("p")).find(
      (p) => this.trim(p.innerText) === `${chieseYear}年${month}月份損益簡表`
    );
    let table;

    while (current && !table) {
      current = current.nextElementSibling;
      if (current) {
        table = current.querySelector?.("table");
      }
    }

    if (table) {
      const tr = table.querySelector("tr:nth-child(9)");
      if (tr) {
        const value = this.trim(tr.querySelector("td:nth-child(2)").innerText);
        const pl_target = this.trim(
          tr.querySelector("td:nth-child(8)").innerText
        ).replace(/,/g, "");
        this.replaceProfitLoss(chieseYear, month, value, pl_target);
      }
    }
  }
  async replaceProfitLoss(chieseYear, month, value, pl_target) {
    try {
      const data = new URLSearchParams();
      const pl_year = chieseYear + 1911;
      data.append("pl_year", pl_year);
      data.append("col", `pl_${month}`);
      data.append("value", value);
      data.append("pl_target", pl_target);

      const json = await this.fetch(
        `${this.apiUrlCPC}?p=replaceProfitLoss`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: data,
        },
        "json"
      );
      console.log(...arguments, json);
    } catch (error) {
      console.error(`Failed to replace profitloss for :`, ...arguments, error);
    }
  }
  async fetchRetired(chieseYear, month) {
    const arrayBuffer = await this.fetch(
      `${this.homeUrlCPC}a0500web/prm/人事處一組/全公司${chieseYear}年${month}月份人數異動表.htm`,
      {},
      "arrayBuffer"
    );
    if (!arrayBuffer) return;

    const decoder = new TextDecoder("big5"); // 使用 Big5 編碼解碼
    const HTML = decoder.decode(arrayBuffer);

    const parser = new DOMParser();
    const doc = parser.parseFromString(HTML, "text/html");

    const date = Number(`${chieseYear}${String(month).padStart(2, "0")}`);
    const userretireds = Array.from(doc.querySelectorAll(".MsoNormalTable tr"))
      .filter((tr, i) => {
        let idx = 0;
        if (date >= 10102 && date <= 10201) {
          idx = 10;
        } else if (date === 10208) {
          idx = 9;
        } else {
          idx = 8;
        }
        return i > 0 && this.trim(tr.cells[idx].innerText) === "離退";
      })
      .map((tr) => {
        let [ur_id, ur_name, ur_us_id, ur_us_name, ur_date] = [
          "",
          "",
          "",
          "",
          "",
        ];
        if (date >= 10102 && date <= 10201) {
          ur_id = this.trim(tr.cells[1].innerText);
          ur_name = this.trim(tr.cells[2].innerText);
          ur_us_id = `${this.trim(tr.cells[3].innerText)}${this.trim(
            tr.cells[4].innerText
          )}`;
          ur_us_name = this.trim(tr.cells[5].innerText);
          ur_date =
            ur_id === "012149" ? "1010201" : this.trim(tr.cells[9].innerText);
        } else {
          ur_id = this.trim(tr.cells[1].innerText);
          ur_name = this.trim(tr.cells[2].innerText);
          ur_us_id = this.trim(tr.cells[3].innerText).replace(" ", "");
          ur_us_name = this.trim(tr.cells[4].innerText);
          ur_date = this.trim(tr.cells[7].innerText);
        }
        ur_date = ur_date.replace(
          /(\d{3})(\d{2})(\d{2})/,
          (match, p1, p2, p3, offset, string) =>
            `${Number(p1) + 1911}-${p2}-${p3}`
        );
        return {
          ur_id,
          ur_name,
          ur_us_id,
          ur_us_name,
          ur_date,
        };
      });
    if (userretireds.length > 0) {
      await this.replaceUserRetireds(userretireds);
    }
  }
  async replaceUserRetireds(userretireds) {
    try {
      const data = new URLSearchParams();
      data.append("userretireds", JSON.stringify(userretireds));

      const json = await this.fetch(
        `${this.apiUrlCPC}?p=replaceUserRetireds`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: data,
        },
        "json"
      );
      console.log(new Date(), json);
    } catch (error) {
      console.error(`Failed to replace user retireds`, error);
    }
  }
  async fetchPrmDisp() {
    const HTML = await this.fetch(
      `${this.homeUrlCPC}eis/pr/pr_asp/prm_disp.asp?uauth=999`
    );
    if (!HTML) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(HTML, "text/html");

    const options = Array.from(
      doc.querySelectorAll('select[name="dept_area"] > option')
    ).filter((option) => option.value.length > 0 && option.value !== "%");
    for (const option of options) {
      const dept = option.value;
      await Promise.all(
        this.types.map((type) => this.fetchUserDatas(dept, type))
      );
    }
  }
  async fetchUserDatas(dept, type) {
    const data = new URLSearchParams({
      dept,
      type,
      emrate1: "01",
      emrate2: "20",
    });

    const HTML = await this.fetch(
      `${this.homeUrlCPC}eis/pr/pr_asp/prm_q0.asp?dept=${dept}&type=${type}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: data,
      }
    );
    if (!HTML) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(HTML, "text/html");

    const rows = Array.from(
      doc.querySelectorAll(
        "font > center > form:nth-child(2) > table > tbody > tr"
      )
    );
    const userdatas = rows
      .filter(
        ({ cells }) => cells.length === 8 && cells[0].innerText !== "姓名"
      )
      .map(({ cells }) => ({
        ud_id: this.trim(cells[1].innerText),
        ud_name: this.trim(cells[0].innerText),
        ud_type: String(type),
        ud_title: this.getTitle(cells, type),
        ud_gender: this.getGender(this.trim(cells[6].innerText)),
        ud_grade: this.trim(cells[7].innerText),
        ud_us_id: this.trim(cells[4].innerText),
        ud_us_name: `${this.trim(cells[2].innerText)}${this.trim(
          cells[3].innerText
        )}`,
      }));

    if (userdatas.length > 0) await this.updateUserDatas(userdatas, dept, type);
  }
  async updateUserDatas(userdatas, dept, type) {
    try {
      const data = new URLSearchParams();
      data.append("userdatas", JSON.stringify(userdatas));

      const json = await this.fetch(
        `${this.apiUrlCPC}?p=updateUserDatas&dept=${dept}&type=${type}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: data,
        },
        "json"
      );
      console.log(new Date(), dept, type, userdatas.length, json);
    } catch (error) {
      console.error(
        `Failed to update user data for dept=${dept}, type=${type}:`,
        error
      );
    }
  }
  async resetNonADUsers() {
    try {
      const data = new URLSearchParams();
      data.append("username", this.username);
      data.append("password", this.password);
      const json = await this.fetch(
        `${this.apiUrlCPC}?p=resetNonADUsers`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: data,
        },
        "json"
      );
      console.log(new Date(), json);
    } catch (error) {
      console.error(`Failed to reset non AD users`, error);
    }
  }
  async crawl() {
    const [chieseYear, month] = [
      new Date().getFullYear() - 1911,
      new Date().getMonth() + 1,
    ];
    await this.fetchProfitLoss(chieseYear, month - 1); // 上個月的損益簡表
    await this.fetchRetired(chieseYear, month); // 本月的離退人數異動表
    await this.fetchPrmDisp();
    await this.resetNonADUsers();
  }
}

// 定時執行爬取任務
const scheduleTimes = ["23:55"]; // 預定的執行時間 (小時:分鐘)
setInterval(() => {
  const date = new Date();
  const now = `${date.getHours()}:${String(date.getMinutes()).padStart(
    2,
    "0"
  )}`;

  if (scheduleTimes.includes(now)) {
    new CPCDataCrawler();
  }
}, 60 * 1000); // 每分鐘檢查一次
