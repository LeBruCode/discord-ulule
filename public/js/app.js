let page = 1
const limit = 100
let total = 0
let loading = false

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

function setLoading(value) {
 loading = value
 document.getElementById("prevBtn").disabled = value
 document.getElementById("nextBtn").disabled = value
}

function updatePaginationMeta() {
 const totalPages = Math.max(1, Math.ceil(total / limit))
 const clampedPage = Math.min(page, totalPages)
 page = clampedPage

 document.getElementById("pageInfo").innerText = `Page ${clampedPage} / ${totalPages}`
 document.getElementById("listMeta").innerText = `${total} result${total > 1 ? "s" : ""}`
 document.getElementById("prevBtn").disabled = loading || clampedPage <= 1
 document.getElementById("nextBtn").disabled = loading || clampedPage >= totalPages
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
   const id = row.id == null ? "" : String(row.id)
   const email = escapeHtml(row.email || "")
   const sent = row.email_sent ? "Yes" : "No"
   const used = row.used ? "Yes" : "No"
   return `<tr>
    <td>${email}</td>
    <td>${sent}</td>
    <td>${used}</td>
    <td>
     <button class="resend-btn" data-email="${email}">Resend</button>
     <button class="delete-btn" data-id="${id}" data-email="${email}">Delete</button>
    </td>
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

 setLoading(true)
 try {
  const response = await fetch(`/admin/api/list?${params.toString()}`)
  if (!response.ok) throw new Error("list request failed")
  const payload = await response.json()
  total = Number(payload.total) || 0
  renderRows(Array.isArray(payload.data) ? payload.data : [])
  updatePaginationMeta()
 } catch (error) {
  console.error("load list error", error)
  document.getElementById("table").innerHTML = '<tr><td colspan="4">Server error while loading list.</td></tr>'
 } finally {
  setLoading(false)
  updatePaginationMeta()
 }
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
 page = 1
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

async function deleteRow(id, email) {
 const confirmed = window.confirm(`Delete ${email} from database?`)
 if (!confirmed) return

 const response = await fetch("/admin/api/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id })
 })

 if (!response.ok) {
  alert("Delete failed")
  return
 }

 alert(`Deleted ${email}`)
 page = 1
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
document.getElementById("prevBtn").addEventListener("click", async () => {
 if (loading || page <= 1) return
 page -= 1
 await loadList()
})
document.getElementById("nextBtn").addEventListener("click", async () => {
 if (loading) return
 const totalPages = Math.max(1, Math.ceil(total / limit))
 if (page >= totalPages) return
 page += 1
 await loadList()
})
document.getElementById("table").addEventListener("click", async (event) => {
 const resendButton = event.target.closest(".resend-btn")
 if (resendButton) {
  const email = resendButton.getAttribute("data-email")
  if (!email) return
  await resendEmail(email)
  return
 }

 const deleteButton = event.target.closest(".delete-btn")
 if (!deleteButton) return
 const id = deleteButton.getAttribute("data-id")
 const email = deleteButton.getAttribute("data-email")
 if (!id || !email) return
 await deleteRow(id, email)
})

refreshAll().catch((error) => {
 console.error("dashboard init error", error)
})
