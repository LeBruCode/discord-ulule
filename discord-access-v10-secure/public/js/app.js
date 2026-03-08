let page = 1
const limit = 100

function escapeHtml(value) {
 return String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;")
}

function getFilters() {
 const search = document.getElementById("search").value.trim()
 const status = document.getElementById("status").value
 return { search, status }
}

async function refreshStats() {
 const stats = await fetch("/stats").then((r) => r.json())
 document.getElementById("total").innerText = stats.total || 0
 document.getElementById("sent").innerText = stats.sent || 0
 document.getElementById("activated").innerText = stats.activated || 0
 document.getElementById("rate").innerText = `${stats.rate || 0}%`
}

function renderRows(rows) {
 const table = document.getElementById("table")
 if (!rows.length) {
  table.innerHTML = '<tr><td colspan="4">No emails found.</td></tr>'
  return
 }

 table.innerHTML = rows
  .map((row) => {
   const email = escapeHtml(row.email || "")
   const sent = row.email_sent ? "Yes" : "No"
   const used = row.used ? "Yes" : "No"
   return `<tr>
    <td>${email}</td>
    <td>${sent}</td>
    <td>${used}</td>
    <td><button class="resend-btn" data-email="${email}">Resend</button></td>
   </tr>`
  })
  .join("")
}

async function loadList() {
 const { search, status } = getFilters()
 const params = new URLSearchParams({
  page: String(page),
  limit: String(limit),
  search,
  status
 })

 const response = await fetch(`/admin/api/list?${params.toString()}`)
 const payload = await response.json()
 renderRows(Array.isArray(payload.data) ? payload.data : [])
}

async function importEmails() {
 const emails = document.getElementById("emails").value
 const response = await fetch("/admin/api/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emails })
 })
 const payload = await response.json()
 alert(`Imported: ${payload.imported || 0}`)
 await refreshAll()
}

async function sendEmails() {
 const response = await fetch("/admin/api/send", { method: "POST" })
 const payload = await response.json()
 alert(`Processed: ${payload.processed || 0}`)
 await refreshAll()
}

async function resendEmail(email) {
 const response = await fetch("/admin/api/resend", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email })
 })
 if (!response.ok) {
  alert("Resend failed")
  return
 }
 alert(`Resent to ${email}`)
 await refreshAll()
}

async function refreshAll() {
 await Promise.all([refreshStats(), loadList()])
}

document.getElementById("importBtn").addEventListener("click", importEmails)
document.getElementById("sendBtn").addEventListener("click", sendEmails)
document.getElementById("status").addEventListener("change", async () => {
 page = 1
 await loadList()
})
document.getElementById("search").addEventListener("input", async () => {
 page = 1
 await loadList()
})
document.getElementById("table").addEventListener("click", async (event) => {
 const button = event.target.closest(".resend-btn")
 if (!button) return
 const email = button.getAttribute("data-email")
 if (!email) return
 await resendEmail(email)
})

refreshAll().catch((error) => {
 console.error("dashboard init error", error)
})
