let page=1
let limit=50
let search=""
let status="all"

function debounce(fn,delay){
 let t
 return (...args)=>{
  clearTimeout(t)
  t=setTimeout(()=>fn(...args),delay)
 }
}

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

function next(){
 page++
 load()
}

function prev(){
 if(page>1) page--
 load()
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

function searchEmail(v){
 search=v
 page=1
 load()
}

document.getElementById("importBtn").addEventListener("click",importEmails)
document.getElementById("sendBtn").addEventListener("click",sendEmails)
document.getElementById("nextBtn").addEventListener("click",next)
document.getElementById("prevBtn").addEventListener("click",prev)
document.getElementById("limit").addEventListener("change",changeLimit)
document.getElementById("status").addEventListener("change",changeStatus)

document.getElementById("search").addEventListener("input",debounce(e=>{
 searchEmail(e.target.value)
},300))

setInterval(refresh,3000)
refresh()
load()