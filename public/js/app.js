let page=1
let limit=50
let search=""
let status="all"

function bool(v){ return v ? "Oui" : "Non" }

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

  const tr=document.createElement("tr")

  tr.innerHTML=`
   <td>${r.email}</td>
   <td>${bool(r.email_sent)}</td>
   <td>${bool(r.used)}</td>
   <td><button data-email="${r.email}" class="resend">Resend</button></td>
  `

  tbody.appendChild(tr)

 })

 document.querySelectorAll(".resend").forEach(btn=>{
  btn.addEventListener("click",()=>resend(btn.dataset.email))
 })

 document.getElementById("page").innerText=page
}

async function resend(email){

 await fetch("/admin/api/resend",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({email})
 })

 alert("Email renvoyé")
}

async function importEmails(){

 const emails=document.getElementById("emails").value

 await fetch("/admin/api/import",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({emails})
 })

 load()
}

async function sendEmails(){
 await fetch("/admin/api/send",{method:"POST"})
}

function next(){ page++; load() }
function prev(){ if(page>1) page--; load() }

document.getElementById("importBtn").addEventListener("click",importEmails)
document.getElementById("sendBtn").addEventListener("click",sendEmails)
document.getElementById("nextBtn").addEventListener("click",next)
document.getElementById("prevBtn").addEventListener("click",prev)

setInterval(refresh,3000)
refresh()
load()