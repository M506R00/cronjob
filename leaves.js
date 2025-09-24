// 人事差勤》紀錄查詢》群組年度差假統計
function parseLeaveToHours(str) {
  const dayMatch = str.match(/(\d+)日/);
  const hourMatch = str.match(/(\d+)時/);
  const minMatch = str.match(/(\d+)分/);
  const days = dayMatch ? parseInt(dayMatch[1], 10) : 0;
  const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
  const mins = minMatch ? parseInt(minMatch[1], 10) : 0;
  return days * 8 + hours + mins / 60;
}

function formatHoursToLeave(totalHours) {
  const days = Math.floor(totalHours / 8);
  const totalMinutes = Math.round(totalHours * 60);
  const remainderMinutes = totalMinutes % (8 * 60);
  const hours = Math.floor(remainderMinutes / 60);
  const mins = remainderMinutes % 60;
  return `${days}日${hours}時${mins}分`;
}

function extractLeaveData() {
  return Array.from(
    document
      .getElementById("print_body_div")
      .querySelectorAll(".table-responsive")
  ).map((tableResponsive) => {
    const title = tableResponsive
      .querySelector("p > span:last-child")
      .innerText.trim();

    const leaves = Array.from(tableResponsive.querySelectorAll("tbody tr"))
      .filter((tr) =>
        ["休假", "家庭照顧假", "事假", "病假"].includes(
          tr.children[0].innerText.trim()
        )
      )
      .map((tr) => ({
        type: tr.children[0].innerText.trim(),
        value: tr.children[tr.children.length - 1].innerText.trim(),
      }));

    return { title, leaves };
  });
}

(function main() {
  const rawData = extractLeaveData();

  const dataForTable = rawData.map(({ title, leaves }) => {
    const vacationLeave =
      leaves.find((l) => l.type === "休假")?.value || "0日0時0分";
    const familyCareLeave =
      leaves.find((l) => l.type === "家庭照顧假")?.value || "0日0時0分";
    const personalLeave =
      leaves.find((l) => l.type === "事假")?.value || "0日0時0分";
    const sickLeave =
      leaves.find((l) => l.type === "病假")?.value || "0日0時0分";

    const totalHours =
      parseLeaveToHours(sickLeave) + parseLeaveToHours(personalLeave);
    const totalLeave = formatHoursToLeave(totalHours);

    return {
      姓名: title,
      休假: vacationLeave,
      家庭照顧假: familyCareLeave,
      事假: personalLeave,
      病假: sickLeave,
      "事假+病假合計": totalLeave,
    };
  });

  dataForTable.sort(
    (a, b) =>
      parseLeaveToHours(b["事假+病假合計"]) -
      parseLeaveToHours(a["事假+病假合計"])
  );

  console.clear();
  console.table(dataForTable);
})();
