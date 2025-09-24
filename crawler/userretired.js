// https://home.cpc.com.tw/a0500web/prm/人事處一組/全公司113年5月份人數異動表.htm
const date = Number(
  document.body.innerText
    .match(/\d+年\d+月/)[0]
    .replace(
      /(\d+)年(\d+)月/,
      (match, p1, p2, offset, string) => `${p1}${p2.padStart(2, 0)}`
    )
)
const userretireds = Array.from(document.getElementsByTagName('tr'))
  .filter((tr, i) => {
    let idx = 0
    if (date >= 10102 && date <= 10201) {
      idx = 10
    } else if (date === 10208) {
      idx = 9
    } else {
      idx = 8
    }
    return i > 0 && tr.cells[idx].innerText.trim() === '離退'
  })
  .map((tr) => {
    let [ur_id, ur_name, ur_us_id, ur_us_name, ur_date] = ['', '', '', '', '']
    if (date >= 10102 && date <= 10201) {
      ur_id = tr.cells[1].innerText.trim()
      ur_name = tr.cells[2].innerText.trim()
      ur_us_id = `${tr.cells[3].innerText.trim()}${tr.cells[4].innerText.trim()}`
      ur_us_name = tr.cells[5].innerText.trim()
      ur_date = ur_id === '012149' ? '1010201' : tr.cells[9].innerText.trim()
    } else {
      ur_id = tr.cells[1].innerText.trim()
      ur_name = tr.cells[2].innerText.trim()
      ur_us_id = tr.cells[3].innerText.trim().replace(' ', '')
      ur_us_name = tr.cells[4].innerText.trim()
      ur_date = tr.cells[7].innerText.trim()
    }
    ur_date = ur_date.replace(
      /(\d{3})(\d{2})(\d{2})/,
      (match, p1, p2, p3, offset, string) =>
        `${Number(p1) + 1911}-${p2}-${p3}`
    )
    return {
      ur_id,
      ur_name,
      ur_us_id,
      ur_us_name,
      ur_date,
    }
  })

if (userretireds.length > 0) {
  let sql = `REPLACE INTO userretired_tab (${Object.entries(
    userretireds[0]
  )
    .map((entry) => entry[0])
    .join(',')}) VALUES${userretireds
      .map(
        (userretired) =>
          `(${Object.entries(userretired)
            .map((entry) => `'${entry[1]}'`)
            .join(',')})`
      )
      .join(',')};`
  // sql += `UPDATE userdata_tab
  //         LEFT JOIN userretired_tab ON ud_id=ur_id SET
  //         ud_us_ids='',
  //         ud_role='0',
  //         ud_status='0',
  //         ud_loginback='0'
  //         WHERE ur_id IS NOT NULL;`
  console.log(sql)
} else {
  console.log(`can't find any userretireds.`)
}