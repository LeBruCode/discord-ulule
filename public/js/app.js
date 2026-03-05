let page=1
let limit=50
let search=""
let status="all"

async function refresh(){

 const s=await fetch("/stats").then(r=>r.json())

 document.getElementById("total").innerText=s.total
 document.getElementById("sent").innerText=s.sent
 document.getElementById("activated").innerText=s.activated
 document.getElementById("rate").innerText=s.rate+"%"

 document.getElementById("bar").style.width=s.rate+"%"
}

async function load(){

 const res=await fetch(`/admin/api/list?page=${page}&limit=${limit}&search=${search}&status=${status}`)
 const j=await res.json()

 const tbody=document.getElementById("table")
 tbody.innerHTML=""

 j.data.forEach(r=>{
  tbody.innerHTML+=`<tr>
   <td>${r.email}</td>
   <td>${r.email_sent}</td>
   <td>${r.used}</td>
  </tr>`
 })

 document.getElementById("page").innerText=page
}

function changeLimit(){
 limit=parseInt(document.getElementById("limit").value)
 page=1
 load()
}

function changeStatus(){
 status=document.getElementById("status").value
 page=1
 load()
}

function searchEmail(){
 search=document.getElementById("search").value
 page=1
 load()
}

function next(){
 page++
 load()
}

function prev(){
 if(page>1){page--}
 load()
}

async function importEmails(){

 const emails=document.getElementById("emails").value

 const res=await fetch("/admin/api/import",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({emails})
 })

 const j=await res.json()
 console.log("imported",j.imported)
 load()
}

async function sendEmails(){

 const res=await fetch("/admin/api/send",{method:"POST"})
 const j=await res.json()

 console.log("queued",j.queued)
}

setInterval(refresh,3000)
refresh()
load()