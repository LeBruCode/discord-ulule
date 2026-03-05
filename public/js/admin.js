
let dataStore=[]
let page=1
let limit=50
let totalRows=0



async function fetchData(){

 const list=await fetch(`/admin/api/list?page=${page}&limit=${limit}`)
 const listJson=await list.json()

 const stats=await fetch(`/admin/api/stats`)
 const statsJson=await stats.json()

 dataStore=listJson.data
 totalRows=listJson.total

 renderTable()
 renderStats(statsJson)
 

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

 })

}

function changeLimit(v){
 limit=parseInt(v)
 page=1
 fetchData()
}

function prevPage(){ if(page>1){page--;fetchData()} }
function nextPage(){ page++;fetchData() }

/* ===== EMAIL ACTIONS ===== */

function sendEmails(){
 fetch('/admin/send-all-fast',{method:'POST'})
 .then(()=>fetchData())
}

function resendEmails(){
 fetch('/admin/resend-emails',{method:'POST'})
 .then(()=>fetchData())
}

function resendOne(id){
 fetch('/admin/resend-one/'+id,{method:'POST'})
 .then(()=>fetchData())
}

function deleteAll(){

 if(!confirm("Supprimer tous les emails ?")) return

 fetch('/admin/delete-all',{method:'POST'})
 .then(()=>{
   page=1
   fetchData()
 })

}

function deleteSelected(){

 const ids=[...document.querySelectorAll('.rowCheck:checked')].map(x=>x.value)

 fetch('/admin/delete-selected',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ids})
 }).then(()=>fetchData())

}

function exportActivated(){
 window.location='/admin/export-activated'
}

/* refresh dashboard */


fetchData()
