let page = 1
let limit = 50
let search = ""
let status = "all"

function bool(v){
 return v ? "Oui" : "Non"
}

async function refreshStats(){

 const s = await fetch("/stats").then(r=>r.json())

 document.getElementById("total").innerText = s.total
 document.getElementById("sent").innerText = s.sent
 document.getElementById("activated").innerText = s.activated
 document.getElementById("rate").innerText = s.rate + "%"
}

async function loadEmails(){

 const res = await fetch(`/admin/api/list?page=${page}&limit=${limit}&search=${search}&status=${status}`)
 const j = await res.json()

 const tbody = document.getElementById("table")
 tbody.innerHTML = ""

 if(!j.data) return

 j.data.forEach(r => {

  const tr = document.createElement("tr")

  tr.innerHTML = `
   <td>${r.email}</td>
   <td>${bool(r.email_sent)}</td>
   <td>${bool(r.used)}</td>
   <td><button class="resend" data-email="${r.email}">Resend</button></td>
  `

  tbody.appendChild(tr)

 })

 document.querySelectorAll(".resend").forEach(btn=>{
  btn.addEventListener("click",()=>resend(btn.dataset.email))
 })

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

 const emails = document.getElementById("emails").value

 await fetch("/admin/api/import",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({emails})
 })

 loadEmails()

}

async function sendEmails(){

 await fetch("/admin/api/send",{method:"POST"})

 loadEmails()

}

document.getElementById("importBtn").addEventListener("click",importEmails)
document.getElementById("sendBtn").addEventListener("click",sendEmails)

document.getElementById("search").addEventListener("input",e=>{
 search = e.target.value
 loadEmails()
})

document.getElementById("status").addEventListener("change",e=>{
 status = e.target.value
 loadEmails()
})

setInterval(refreshStats,3000)

refreshStats()
loadEmails()
