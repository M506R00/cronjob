// https://hqsinvpur.cpc.com.tw/MAT/OPQ/mtnDQTBTAB.aspx
const hostname = 'hqsinvpur.cpc.com.tw'
const program = 'mtnDQTBTAB'
const crawlerMatnos = (matno, data, page = 1) => {
  // data.set('__ASYNCPOST', 'true')
  data.set('ctl00$tbxChangePage', '')
  data.set('ctl00$cphBody$TabContainer1$TabPanel1$tbxMATNO_qry', matno)
  data.set('ctl00$cphBody$TabContainer1$TabPanel1$tbxDIVISION_qry', 'M50')
  data.set('ctl00$cphBody$TabContainer1$TabPanel1$rblMPERSON', '有保管人')
  data.set('ctl00$cphBody$TabContainer1$TabPanel2$gvData$ctl01$ddlPages', String(page))
  data.set('ctl00$tsmMain', 'ctl00$cphBody$upMain|ctl00$cphBody$TBtoolbar1$btnQueryOnly')
  if (Number(page) === 1) {
    data.set('ctl00$cphBody$TBtoolbar1$btnQueryOnly', '送出查詢')
  } else {
    data.delete('ctl00$cphBody$TBtoolbar1$btnQueryOnly')
  }
  fetch(`https://${hostname}/MAT/OPQ/${program}.aspx?matno=${matno}&page=${page}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: data
  })
    .then(res => res.text())
    .then(html => {
      let qty = 0
      const m = html.match(/共(\d+)筆資料/)
      if (m) {
        qty = Number(m[1])
      }
      let countMat = true
      if (page === 1) {
        let totolPages = 1
        const ms = html.match(/<option( selected="selected")? value="\d+">\d+<\/option>/g)
        if (ms) {
          totolPages = ms.length
        }
        if (qty === 500) {
          countMat &= false
          for (let m = 0; m < 10; m++) {
            crawlerMatnos(`${matno}${m}`, data, page)
          }
        } else if (totolPages > 1) {
          countMat &= true
          for (let p = 1; p < totolPages; p++) {
            data.set('__VIEWSTATE', html.match(/id="__VIEWSTATE" value="([\s\S]+?)"/)[1])
            crawlerMatnos(matno, data, page + p)
          }
        }
      }
      if (qty > 0 && countMat) {
        const ths = [...html.matchAll(/<th class="DataHeaderS?"[^>]+>([\s\S]+?)<\/th>/g)].map(th => th[1].replace(/<[\s\S]+?>/g, ''))
        const tds = [...html.matchAll(/<tr class="DataRow"[^>]+>([\s\S]+?)<\/tr>/g)]
          .map(tr => [...tr[1].matchAll(/<td[^>]+>([\s\S]+?)<\/td>/g)]
            .map(td => (td[0].includes('title') ? td[0].match(/title="([\s\S]+?)"/)[1] : td[1])
              .replace(/[\t\n]/g, '').replace(/ \w+="[\s\S]+?"/g, '')
              .replace(/<\/?(sp)?an?>/g, '')
              .replace(/&quot;/g, '"')
              .replace(/&nbsp;/g, '')
              .replace(/\s{5,}/g, '')
              .trim()
            )
          )
        const data = new URLSearchParams()
        data.append('program', program)
        data.append('ths', JSON.stringify(ths))
        data.append('tds', JSON.stringify(tds))
        fetch(`http://localhost/mat/api/?p=updatePartStockColQty&from=cronjob&matno=${matno}&qty=${qty}&page=${page}&tds_length=${tds.length}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          body: data
        })
          .then(res => res.json())
          .then(json => {
            console.log(new Date(), matno, qty, page, tds.length, json)
          })
      } else {
        console.log(matno, qty, page)
      }
    })
}
const crawler = () => {
  const data = new URLSearchParams()
  data.append('program', program)
  data.append('length', 2)
  fetch(`http://localhost/mat/api/?p=getPartStockEpNos&from=cronjob`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: data
  })
    .then(res => res.json())
    .then(matnos => {
      console.log('matnos', matnos)
      // matnos = [
      //   'RB',// 500
      //   'RD',// 500
      //   'RT',// 370
      //   'VF',// 361
      //   'SF',// 185
      //   'SH',// 95
      //   'VP',// 35
      //   'QJ',// 24
      //   'SB',// 13
      //   'SS',// 7
      //   'VG',// 5
      //   'ED',// 1
      // ]
      matnos.forEach(matno => {
        const formdata = new FormData(document.querySelector('#aspnetForm'))

        const data = new URLSearchParams()
        for (const pair of formdata) {
          data.append(pair[0], pair[1])
        }
        crawlerMatnos(matno, data, 1)
      })

    })
}
// update per day
const scheduleTimes = ['23:50'/*, '07:50', '15:50'*/] // 時:分
setInterval(() => {
  const date = new Date()
  scheduleTimes.forEach(scheduleTime => {
    if (
      date.getHours() === Number(scheduleTime.split(':')[0]) &&
      date.getMinutes() === Number(scheduleTime.split(':')[1])) {
      crawler()
    }
  })
}, 60 * 1000) //每分鐘執行一次