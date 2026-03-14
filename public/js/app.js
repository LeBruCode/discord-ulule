let page = 1
let limit = 100
let total = 0
let loading = false
let importPollTimer = null

const selectedIds = new Set()
let currentRowIds = []

function escapeHtml(value) {
 return String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;")
}

function formatDate(value) {
 if (!value) return "-"
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return "-"
 return date.toLocaleString("fr-FR")
}

function formatBrevoStatus(value) {
 const status = String(value || "").trim().toLowerCase()
 const labels = {
  queued: "En file",
  request: "Requête",
  sent: "Envoyé",
  delivered: "Délivré",
  opened: "Ouvert",
  unique_opened: "Ouvert",
  click: "Cliqué",
  unique_clicked: "Cliqué",
  soft_bounce: "Rebond souple",
  hard_bounce: "Rebond dur",
  blocked: "Bloqué",
  error: "Erreur",
  deferred: "Différé",
  invalid: "Invalide",
  spam: "Spam"
 }
 return labels[status] || "-"
}

function getFilters() {
 const search = document.getElementById("search").value.trim()
 const status = document.getElementById("status").value
 const brevoStatus = document.getElementById("brevoStatus").value
 const sort = document.getElementById("sort").value
 return { search, status, brevoStatus, sort }
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
 document.getElementById("listMeta").innerText = `${total} résultat${total > 1 ? "s" : ""} • ${limit}/page • ${selectedIds.size} sélectionné${selectedIds.size > 1 ? "s" : ""}`
 document.getElementById("prevBtn").disabled = loading || clampedPage <= 1
 document.getElementById("nextBtn").disabled = loading || clampedPage >= totalPages
}

function updateSelectAllState() {
 const selectAll = document.getElementById("selectAll")
 if (!currentRowIds.length) {
  selectAll.checked = false
  return
 }
 const selectedOnPage = currentRowIds.filter((id) => selectedIds.has(id)).length
 selectAll.checked = selectedOnPage === currentRowIds.length
}

async function refreshStats() {
 const stats = await fetch("/stats").then((r) => r.json())
 document.getElementById("total").innerText = stats.total || 0
 document.getElementById("sent").innerText = stats.sent || 0
 document.getElementById("activated").innerText = stats.activated || 0
 document.getElementById("rate").innerText = `${stats.rate || 0}%`
}

async function refreshQueueStatus() {
 try {
  const status = await fetch("/admin/api/send-status").then((r) => r.json())
  const queueStatus = document.getElementById("queueStatus")
  if (status.running) {
   queueStatus.innerText = "File d'envoi: en cours"
   return
  }

  const sent = status.lastStats?.sent || 0
  const failed = status.lastStats?.failed || 0
  const processed = status.lastStats?.processed || 0
  queueStatus.innerText = `File d'envoi: inactive • dernier lot: traités ${processed}, envoyés ${sent}, échecs ${failed}`
 } catch (error) {
  document.getElementById("queueStatus").innerText = "File d'envoi: statut indisponible"
 }
}

function renderImportStatus(status) {
 const importStatus = document.getElementById("importStatus")
 const bar = document.getElementById("importProgressBar")
 const progress = Number(status.progress) || 0
 bar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`

 if (status.running) {
  importStatus.innerText = `Import en cours: ${status.processed}/${status.total} (${progress}%) • ajoutés ${status.inserted} • échecs ${status.failed}`
  return
 }

 if ((status.total || 0) > 0) {
  importStatus.innerText = `Import terminé: ${status.processed}/${status.total} • ajoutés ${status.inserted} • échecs ${status.failed}`
  return
 }

 importStatus.innerText = "Import: inactif"
}

function setReconcileStatus(message) {
 document.getElementById("reconcileStatus").innerText = message
}

async function refreshImportStatus() {
 try {
  const status = await fetch("/admin/api/import-status").then((r) => r.json())
  renderImportStatus(status)
  return status
 } catch (error) {
  document.getElementById("importStatus").innerText = "Import: statut indisponible"
  return null
 }
}

function startImportPolling() {
 if (importPollTimer) clearInterval(importPollTimer)
 importPollTimer = setInterval(async () => {
  const status = await refreshImportStatus()
  if (!status) return
  if (!status.running) {
   clearInterval(importPollTimer)
   importPollTimer = null
   await refreshAll()
  }
 }, 1500)
}

function stopImportPolling() {
 if (!importPollTimer) return
 clearInterval(importPollTimer)
 importPollTimer = null
}

function renderRows(rows) {
 const table = document.getElementById("table")
 if (!rows.length) {
  currentRowIds = []
  updateSelectAllState()
  table.innerHTML = '<tr><td colspan="9">Aucun e-mail trouvé.</td></tr>'
  return
 }

 currentRowIds = rows.map((row) => String(row.id || "")).filter((id) => id)
 updateSelectAllState()

 table.innerHTML = rows
  .map((row) => {
   const id = row.id == null ? "" : String(row.id)
   const email = escapeHtml(row.email || "")
   const sent = row.email_sent ? "Oui" : "Non"
   const used = row.used ? "Oui" : "Non"
   const sentAt = escapeHtml(formatDate(row.email_sent_at))
   const usedAt = escapeHtml(formatDate(row.used_at))
   const brevoStatusKey = String(row.brevo_status || "").trim().toLowerCase()
   const brevoStatus = escapeHtml(formatBrevoStatus(brevoStatusKey))
   const error = escapeHtml(row.email_error || "-")
   const checked = selectedIds.has(id) ? "checked" : ""
   return `<tr>
    <td class="select-col"><input class="row-select" type="checkbox" data-id="${id}" ${checked}></td>
    <td class="email-cell" title="${email}">${email}</td>
    <td class="status-cell">${sent}</td>
    <td class="status-cell">${used}</td>
    <td class="datetime-cell">${sentAt}</td>
    <td class="datetime-cell">${usedAt}</td>
    <td class="status-pill-cell"><span class="brevo-badge brevo-${brevoStatusKey.replace(/[^a-z_]+/g, "-")}">${brevoStatus}</span></td>
    <td class="error-cell">${error}</td>
    <td class="actions-cell">
     <button class="icon-btn resend-btn" data-email="${email}" title="Renvoyer" aria-label="Renvoyer">✉</button>
     <button class="icon-btn delete-btn" data-id="${id}" data-email="${email}" title="Supprimer" aria-label="Supprimer">🗑</button>
    </td>
   </tr>`
  })
  .join("")
}

async function loadList() {
 const { search, status, brevoStatus, sort } = getFilters()
 const params = new URLSearchParams({
  page: String(page),
  limit: String(limit),
  search,
  status,
  brevoStatus,
  sort
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
  document.getElementById("table").innerHTML = '<tr><td colspan="9">Erreur serveur lors du chargement.</td></tr>'
 } finally {
  setLoading(false)
  updatePaginationMeta()
 }
}

async function importEmails() {
 const emailsInput = document.getElementById("emails")
 const emails = emailsInput.value
 const response = await fetch("/admin/api/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emails })
 })
 const payload = await response.json()
 if (response.status === 409) {
  alert("Un import est déjà en cours")
  startImportPolling()
  return
 }
 if (!response.ok) {
  alert(payload.error || "Échec de l'import")
  return
 }
 emailsInput.value = ""
 alert(`Import lancé: ${payload.total || 0} e-mails en file`)
 startImportPolling()
 page = 1
 await refreshAll()
}

async function sendEmails() {
 const response = await fetch("/admin/api/send", { method: "POST" })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Échec de l'envoi")
  return
 }
 alert(`File lancée: ${payload.queued || 0} e-mails en attente`)
 await refreshAll()
}

async function reconcileSentEmails() {
 const input = document.getElementById("reconcileEmails")
 const emails = input.value
 if (!emails.trim()) {
  alert("Colle d'abord une liste d'e-mails Brevo")
  return
 }

 setReconcileStatus("Réconciliation en cours...")
 const response = await fetch("/admin/api/reconcile-sent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emails })
 })
 const payload = await response.json()
 if (!response.ok) {
  setReconcileStatus("Réconciliation: échec")
  alert(payload.error || "Échec de la réconciliation")
  return
 }

 input.value = ""
 const missing = Number(payload.missing) || 0
 const updatedRows = Number(payload.updatedRows) || 0
 const matched = Number(payload.matched) || 0
 setReconcileStatus(`Réconciliation terminée: ${matched} e-mails retrouvés, ${updatedRows} ligne(s) mises à jour, ${missing} absente(s) de la base`)

 if (missing > 0) {
  const preview = (payload.missingEmails || []).slice(0, 15).join("\n")
  alert(`Réconciliation terminée.\n\nRetrouvés: ${matched}\nLignes mises à jour: ${updatedRows}\nAbsents de la base: ${missing}${preview ? `\n\nExemples absents:\n${preview}` : ""}`)
 } else {
  alert(`Réconciliation terminée: ${matched} e-mails retrouvés, ${updatedRows} ligne(s) mises à jour.`)
 }

 page = 1
 await refreshAll()
}

async function resendEmail(email) {
 const response = await fetch("/admin/api/resend", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.details || payload.error || "Échec du renvoi")
  return
 }
 alert(`Renvoyé à ${email}`)
 await refreshAll()
}

async function deleteRow(id, email) {
 const confirmed = window.confirm(`Supprimer ${email} de la base de données ?`)
 if (!confirmed) return

 const response = await fetch("/admin/api/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id })
 })

 if (!response.ok) {
  alert("Échec de la suppression")
  return
 }

 selectedIds.delete(id)
 alert(`Supprimé : ${email}`)
 page = 1
 await refreshAll()
}

async function batchResend() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert("Aucune ligne sélectionnée")
  return
 }

 const response = await fetch("/admin/api/batch-resend", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids })
 })
  const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Échec du renvoi en lot")
  return
 }

 alert(`Renvoi en lot: traités ${payload.processed || 0}, envoyés ${payload.sent || 0}, échecs ${payload.failed || 0}`)
 await refreshAll()
}

async function batchDelete() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert("Aucune ligne sélectionnée")
  return
 }

 const confirmed = window.confirm(`Supprimer ${ids.length} ligne(s) ?`)
 if (!confirmed) return

 const response = await fetch("/admin/api/batch-delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Échec de la suppression en lot")
  return
 }

 ids.forEach((id) => selectedIds.delete(id))
 alert(`Supprimées : ${payload.deleted || 0}`)
 page = 1
 await refreshAll()
}

async function refreshAll() {
 const [importStatus] = await Promise.all([
  refreshImportStatus(),
  refreshStats(),
  loadList(),
  refreshQueueStatus()
 ])

 if (importStatus?.running) {
  if (!importPollTimer) startImportPolling()
 } else {
  stopImportPolling()
 }
}

document.getElementById("importBtn").addEventListener("click", importEmails)
document.getElementById("sendBtn").addEventListener("click", sendEmails)
document.getElementById("reconcileBtn").addEventListener("click", reconcileSentEmails)
document.getElementById("batchResendBtn").addEventListener("click", batchResend)
document.getElementById("batchDeleteBtn").addEventListener("click", batchDelete)
document.getElementById("status").addEventListener("change", async () => {
 page = 1
 await loadList()
})
document.getElementById("brevoStatus").addEventListener("change", async () => {
 page = 1
 await loadList()
})
document.getElementById("sort").addEventListener("change", async () => {
 page = 1
 await loadList()
})
document.getElementById("perPage").addEventListener("change", async (event) => {
 limit = Math.min(Math.max(Number(event.target.value) || 100, 1), 200)
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
document.getElementById("selectAll").addEventListener("change", (event) => {
 const shouldSelect = Boolean(event.target.checked)
 for (const id of currentRowIds) {
  if (shouldSelect) selectedIds.add(id)
  else selectedIds.delete(id)
 }
 updatePaginationMeta()
})

document.getElementById("table").addEventListener("change", (event) => {
 const checkbox = event.target.closest(".row-select")
 if (!checkbox) return
 const id = checkbox.getAttribute("data-id")
 if (!id) return
 if (checkbox.checked) selectedIds.add(id)
 else selectedIds.delete(id)
 updateSelectAllState()
 updatePaginationMeta()
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

setInterval(() => {
 refreshQueueStatus().catch(() => {})
}, 10000)

refreshAll().catch((error) => {
 console.error("dashboard init error", error)
})
