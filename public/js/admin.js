
let dataStore=[]
let page=1
let limit=50
let totalRows=0

let chartInstance=null
let timelineChart=null

async function fetchData(){

 const list=await fetch(`/admin/api/list?page=${page}&limit=${limit}`)
 const listJson=await list.json()

 const stats=await fetch(`/admin/api/stats`)
 const statsJson=await stats.json()

 dataStore=listJson.data
 totalRows=listJson.total

 renderTable()
 renderStats(statsJson)
 renderCharts(statsJson)

}

function renderTable(){

 const tbody=document.getElementById("tbody")
 tbody.innerHTML=""

 dataStore.forEach(r=>{

  tbody.innerHTML+=`
   <tr>
    <td><input type="checkbox" class="rowCheck" value="${r.id}"></td>
    <td>${r.email}</td>
    <td>${r.email_sent?'Oui':'Non'}</td>
    <td>${r.used?'Oui':'Non'}</td>
    <td><button onclick="resendOne('${r.id}')">Renvoyer</button></td>
   </tr>
  `

 })

 document.getElementById("pageInfo").innerText=`Page ${page}`

}

function renderStats(s){

 const rate=s.total?Math.round((s.activated/s.total)*100):0

 document.getElementById("totalEmails").innerText=s.total
 document.getElementById("activated").innerText=s.activated
 document.getElementById("rate").innerText=rate+"%"

}

function renderCharts(s){

 const activated=s.activated
 const notActivated=s.total-activated

 if(chartInstance) chartInstance.destroy()

 chartInstance=new Chart(document.getElementById("chart"),{
  type:"doughnut",
  data:{labels:["Activé","Non activé"],
  datasets:[{data:[activated,notActivated],backgroundColor:["#22c55e","#ef4444"]}]}
 })

 const map={}

 s.timeline.forEach(r=>{

  const d=r.used_at.slice(0,10)

  if(!map[d]) map[d]=0
  map[d]++

 })

 const labels=Object.keys(map).sort()
 const values=labels.map(l=>map[l])

 if(timelineChart) timelineChart.destroy()

 timelineChart=new Chart(document.getElementById("timeline"),{
  type:"line",
  data:{labels,datasets:[{label:"Activations",data:values,borderColor:"#6366f1"}]}
 })

}

function changeLimit(v){
 limit=parseInt(v)
 page=1
 fetchData()
}

function prevPage(){ if(page>1){page--;fetchData()} }
function nextPage(){ page++;fetchData() }

function sendAllEmails(){ fetch('/admin/send-all',{method:'POST'}).then(fetchData) }

function resendOne(id){ fetch('/admin/resend-one/'+id,{method:'POST'}).then(fetchData) }

function deleteAll(){ if(confirm("Supprimer tous ?")) fetch('/admin/delete-all',{method:'POST'}).then(fetchData) }

function deleteSelected(){

 const ids=[...document.querySelectorAll('.rowCheck:checked')].map(x=>x.value)

 fetch('/admin/delete-selected',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ids})
 }).then(fetchData)

}

function exportActivated(){ window.location='/admin/export-activated' }

fetchData()
