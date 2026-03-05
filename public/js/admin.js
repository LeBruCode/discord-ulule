
let page=1
let limit=50
let dataStore=[]
let totalRows=0

async function fetchData(){

 const list=await fetch(`/admin/api/list?page=${page}&limit=${limit}`)
 const json=await list.json()

 const stats=await fetch(`/admin/api/stats`)
 const s=await stats.json()

 dataStore=json.data
 totalRows=json.total

 renderTable()
 renderStats(s)
}

function renderTable(){

 const tbody=document.getElementById("tbody")
 tbody.innerHTML=""

 dataStore.forEach(r=>{

  tbody.innerHTML+=`
  <tr>
   <td><input type="checkbox" value="${r.id}" class="row"></td>
   <td>${r.email}</td>
   <td>${r.email_sent?'Oui':'Non'}</td>
   <td>${r.used?'Oui':'Non'}</td>
  </tr>
  `

 })

 document.getElementById("pageInfo").innerText="Page "+page
}

function renderStats(s){

 const rate=s.total?Math.round((s.activated/s.total)*100):0

 document.getElementById("total").innerText=s.total
 document.getElementById("activated").innerText=s.activated
 document.getElementById("rate").innerText=rate+"%"
}

function prev(){ if(page>1){page--;fetchData()} }
function next(){ page++;fetchData() }

function sendEmails(){
 fetch("/admin/send",{method:"POST"}).then(fetchData)
}

function deleteAll(){

 if(!confirm("Delete all?")) return

 fetch("/admin/delete-all",{method:"POST"}).then(fetchData)
}

function deleteSelected(){

 const ids=[...document.querySelectorAll(".row:checked")].map(x=>x.value)

 fetch("/admin/delete-selected",{
  method:"POST",
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ids})
 }).then(fetchData)
}

function exportCsv(){
 window.location="/admin/export"
}

fetchData()
