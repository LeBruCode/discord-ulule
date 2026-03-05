
let page=1
let limit=50
let dataStore=[]

async function refresh(){

 const list=await fetch(`/admin/api/list?page=${page}&limit=${limit}`)
 const listJson=await list.json()

 const stats=await fetch(`/admin/api/stats`)
 const statsJson=await stats.json()

 dataStore=listJson.data

 renderTable()
 renderStats(statsJson)
}

function renderTable(){

 const tbody=document.getElementById("tbody")
 tbody.innerHTML=""

 dataStore.forEach(r=>{

  tbody.innerHTML+=`
   <tr>
    <td><input type="checkbox" value="${r.id}" class="row"></td>
    <td>${r.email}</td>
    <td>${r.email_sent?'Yes':'No'}</td>
    <td>${r.used?'Yes':'No'}</td>
    <td><button onclick="resend('${r.id}')">Resend</button></td>
   </tr>
  `

 })

 document.getElementById("page").innerText="Page "+page
}

function renderStats(s){

 const rate=s.total?Math.round((s.activated/s.total)*100):0

 document.getElementById("total").innerText=s.total
 document.getElementById("sent").innerText=s.sent
 document.getElementById("activated").innerText=s.activated
 document.getElementById("rate").innerText=rate+"%"
}

function next(){page++;refresh()}
function prev(){if(page>1){page--;refresh()}}

function sendAll(){
 fetch("/admin/api/send-all",{method:"POST"}).then(refresh)
}

function resend(id){
 fetch("/admin/api/resend/"+id,{method:"POST"}).then(refresh)
}

function deleteAll(){

 if(!confirm("Delete all emails?")) return

 fetch("/admin/api/delete-all",{method:"POST"}).then(refresh)
}

function deleteSelected(){

 const ids=[...document.querySelectorAll(".row:checked")].map(x=>x.value)

 fetch("/admin/api/delete-selected",{
  method:"POST",
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ids})
 }).then(refresh)
}

function exportCsv(){
 window.location="/admin/api/export"
}

refresh()
