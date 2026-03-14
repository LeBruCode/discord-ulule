let page = 1
let limit = 100
let total = 0
let loading = false
let importPollTimer = null
let currentDetailId = null

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
 return labels[status] || "Aucun statut"
}

function formatYesNo(value) {
 return value ? "Oui" : "Non"
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

async function refreshBrevoStats() {
 try {
  const payload = await fetch("/admin/api/brevo-stats").then((r) => r.json())
  const stats = payload.stats || {}
  for (const key of ["none", "request", "queued", "sent", "delivered", "soft_bounce", "hard_bounce", "blocked"]) {
   const node = document.getElementById(`brevoStat-${key}`)
   if (node) node.innerText = Number(stats[key] || 0)
  }
 } catch (error) {
  console.error("brevo stats error", error)
 }
}

async function refreshQueueStatus() {
 try {
  const status = await fetch("/admin/api/send-status").then((r) => r.json())
  const queueStatus = document.getElementById("queueStatus")
 if (status.running) {
   queueStatus.innerText = "File d'envoi: ça bombarde"
   return
  }

  const sent = status.lastStats?.sent || 0
  const failed = status.lastStats?.failed || 0
  const processed = status.lastStats?.processed || 0
  queueStatus.innerText = `File d'envoi: pause café • dernier tour: ${processed} traités, ${sent} envoyés, ${failed} plantés`
 } catch (error) {
  document.getElementById("queueStatus").innerText = "File d'envoi: j'ai perdu le fil"
 }
}

function renderImportStatus(status) {
 const importStatus = document.getElementById("importStatus")
 const bar = document.getElementById("importProgressBar")
 const progress = Number(status.progress) || 0
 bar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`

 if (status.running) {
  importStatus.innerText = `Import en cours: ${status.processed}/${status.total} (${progress}%) • ${status.inserted} ajoutés • ${status.failed} en vrac`
  return
 }

 if ((status.total || 0) > 0) {
  importStatus.innerText = `Import bouclé: ${status.processed}/${status.total} • ${status.inserted} ajoutés • ${status.failed} ratés`
  return
 }

 importStatus.innerText = "Import: tranquille pour l'instant"
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
  document.getElementById("importStatus").innerText = "Import: statut dans le brouillard"
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
  table.innerHTML = '<tr><td colspan="9">Aucun e-mail trouvé. C\'est le désert.</td></tr>'
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
   const excluded = row.resend_excluded === true
   const error = escapeHtml(row.email_error || "-")
   const checked = selectedIds.has(id) ? "checked" : ""
   return `<tr>
    <td class="select-col"><input class="row-select" type="checkbox" data-id="${id}" ${checked}></td>
    <td class="email-cell" title="${email}">${email}${excluded ? ' <span class="inline-pill">Exclu</span>' : ""}</td>
    <td class="status-cell">${sent}</td>
    <td class="status-cell">${used}</td>
    <td class="datetime-cell">${sentAt}</td>
    <td class="datetime-cell">${usedAt}</td>
    <td class="status-pill-cell"><span class="brevo-badge brevo-${brevoStatusKey.replace(/[^a-z_]+/g, "-")}">${brevoStatus}</span></td>
    <td class="error-cell">${error}</td>
    <td class="actions-cell">
     <button class="icon-btn detail-btn" data-id="${id}" title="Détail" aria-label="Détail">⋯</button>
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
  document.getElementById("table").innerHTML = '<tr><td colspan="9">Le serveur a toussé pendant le chargement.</td></tr>'
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
  alert("Un import tourne déjà. Laisse-le finir sa vie.")
  startImportPolling()
  return
 }
 if (!response.ok) {
  alert(payload.error || "L'import s'est pris les pieds dans le tapis")
  return
 }
 emailsInput.value = ""
 alert(`Import lancé: ${payload.total || 0} e-mails partent à l'échauffement`)
 startImportPolling()
 page = 1
 await refreshAll()
}

async function sendEmails() {
 const response = await fetch("/admin/api/send", { method: "POST" })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "L'envoi a boudé")
  return
 }
 alert(`C'est parti: ${payload.queued || 0} e-mails sont sur la ligne de départ`)
 await refreshAll()
}

async function reconcileSentEmails() {
 const input = document.getElementById("reconcileEmails")
 const emails = input.value
 if (!emails.trim()) {
  alert("Colle d'abord une liste Brevo, sinon je devine au hasard")
  return
 }

 setReconcileStatus("Réconciliation en cours... on remet de l'ordre là-dedans")
 const response = await fetch("/admin/api/reconcile-sent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emails })
 })
 const payload = await response.json()
 if (!response.ok) {
  setReconcileStatus("Réconciliation: petit gadin")
  alert(payload.error || "La réconciliation s'est emmêlé les câbles")
  return
 }

 input.value = ""
 const missing = Number(payload.missing) || 0
 const updatedRows = Number(payload.updatedRows) || 0
 const matched = Number(payload.matched) || 0
 setReconcileStatus(`Réconciliation bouclée: ${matched} retrouvés, ${updatedRows} mis à jour, ${missing} introuvables`)

 if (missing > 0) {
  const preview = (payload.missingEmails || []).slice(0, 15).join("\n")
  alert(`Réconciliation bouclée.\n\nRetrouvés: ${matched}\nMis à jour: ${updatedRows}\nAbsents de la base: ${missing}${preview ? `\n\nExemples absents:\n${preview}` : ""}`)
 } else {
  alert(`Réconciliation bouclée: ${matched} e-mails retrouvés, ${updatedRows} ligne(s) mises à jour.`)
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
  alert(payload.details || payload.error || "Le renvoi a calé")
  return
 }
 alert(`C'est reparti pour ${email}`)
 await refreshAll()
}

async function deleteRow(id, email) {
 const confirmed = window.confirm(`Tu veux vraiment bazarder ${email} de la base ?`)
 if (!confirmed) return

 const response = await fetch("/admin/api/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id })
 })

 if (!response.ok) {
  alert("Impossible de jeter cette ligne à la poubelle")
  return
 }

 selectedIds.delete(id)
 alert(`Hop, ${email} a disparu du radar`)
 page = 1
 await refreshAll()
}

async function batchResend() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert("Sélectionne au moins une ligne, champion")
  return
 }

 const response = await fetch("/admin/api/batch-resend", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids })
 })
  const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Le renvoi en lot a fait grève")
  return
 }

 alert(`Renvoi en lot: ${payload.processed || 0} traités, ${payload.sent || 0} envoyés, ${payload.failed || 0} ratés`)
 await refreshAll()
}

async function resendFiltered() {
 const { search, status, brevoStatus } = getFilters()
 const labelParts = []
 if (status !== "all") labelParts.push(`statut=${status}`)
 if (brevoStatus !== "all") labelParts.push(`Brevo=${brevoStatus}`)
 if (search) labelParts.push(`recherche=${search}`)
 const label = labelParts.length ? ` (${labelParts.join(", ")})` : ""

 const confirmed = window.confirm(`Tu veux relancer toutes les lignes du filtre actuel${label} ?`)
 if (!confirmed) return

 const response = await fetch("/admin/api/resend-filtered", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search, status, brevoStatus })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Le renvoi filtré est parti se cacher")
  return
 }

 alert(`Renvoi filtré: ${payload.processed || 0} traités, ${payload.sent || 0} envoyés, ${payload.failed || 0} ratés`)
 await refreshAll()
}

async function selectFiltered() {
 const filters = getFilters()
 const response = await fetch("/admin/api/select-filtered", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(filters)
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Impossible de choper tout le filtre")
  return
 }

 selectedIds.clear()
 for (const id of payload.ids || []) selectedIds.add(id)
 updateSelectAllState()
 updatePaginationMeta()
 alert(`${payload.total || 0} ligne(s) dans le filet du filtre actuel`)
}

async function setExcludedForSelected(excluded) {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert("Sélectionne au moins une ligne, sinon je mime")
  return
 }

 const response = await fetch("/admin/api/exclude-selected", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids, excluded })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "La mise à jour a dérapé")
  return
 }

 alert(`${payload.updated || 0} ligne(s) ${excluded ? "mises au placard" : "remises dans le jeu"}`)
 await refreshAll()
}

async function setExcludedForFiltered(excluded) {
 const filters = getFilters()
 const response = await fetch("/admin/api/exclude-filtered", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...filters, excluded })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "La mise à jour du filtre a bégayé")
  return
 }

 alert(`${payload.updated || 0} ligne(s) ${excluded ? "mises au placard" : "remises dans la course"} pour le filtre actuel`)
 await refreshAll()
}

function exportFiltered() {
 const { search, status, brevoStatus, sort } = getFilters()
 const params = new URLSearchParams({ search, status, brevoStatus, sort })
 window.location = `/admin/api/export?${params.toString()}`
}

function closeDetailDrawer() {
 currentDetailId = null
 document.getElementById("detailDrawer").classList.add("hidden")
}

function renderTimelineItem(item) {
 const label = escapeHtml(item.label || "-")
 const at = escapeHtml(formatDate(item.at))
 const value = escapeHtml(item.value || "-")
 return `<div class="timeline-item"><div class="timeline-dot"></div><div><b>${label}</b><p>${value}</p><span>${at}</span></div></div>`
}

async function openDetail(id) {
 const response = await fetch(`/admin/api/detail/${encodeURIComponent(id)}`)
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Impossible d'ouvrir les coulisses de cette ligne")
  return
 }

 currentDetailId = id
 const row = payload.data || {}
 document.getElementById("detailEmail").innerText = row.email || "-"
 document.getElementById("detailMeta").innerHTML = `
  <span class="inline-pill">${formatBrevoStatus(row.brevo_status)}</span>
  <span class="inline-pill">${row.resend_excluded ? "Au placard" : "Prêt à repartir"}</span>
  <span class="inline-pill">Activé: ${formatYesNo(row.used)}</span>
 `
 document.getElementById("detailTimeline").innerHTML = (payload.timeline || []).map(renderTimelineItem).join("") || '<p class="panel-copy">Aucun historique ici. Même pas un petit drame.</p>'
 document.getElementById("detailNote").value = row.admin_note || ""
 document.getElementById("detailDrawer").classList.remove("hidden")
}

async function saveDetailNote() {
 if (!currentDetailId) return
 const note = document.getElementById("detailNote").value
 const response = await fetch("/admin/api/note", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: currentDetailId, note })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Impossible de garder cette note au chaud")
  return
 }

 alert("Note bien rangée")
 await openDetail(currentDetailId)
 await loadList()
}

async function batchDelete() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert("Sélectionne au moins une ligne avant de sortir la tronçonneuse")
  return
 }

 const confirmed = window.confirm(`Tu veux vraiment bazarder ${ids.length} ligne(s) ?`)
 if (!confirmed) return

 const response = await fetch("/admin/api/batch-delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "La suppression en lot a foiré")
  return
 }

 ids.forEach((id) => selectedIds.delete(id))
 alert(`Hop, ${payload.deleted || 0} ligne(s) se sont fait la malle`)
 page = 1
 await refreshAll()
}

async function refreshAll() {
 const [importStatus] = await Promise.all([
  refreshImportStatus(),
  refreshStats(),
  refreshBrevoStats(),
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
document.getElementById("filterResendBtn").addEventListener("click", resendFiltered)
document.getElementById("selectFilteredBtn").addEventListener("click", selectFiltered)
document.getElementById("excludeSelectedBtn").addEventListener("click", async () => setExcludedForSelected(true))
document.getElementById("includeSelectedBtn").addEventListener("click", async () => setExcludedForSelected(false))
document.getElementById("excludeFilteredBtn").addEventListener("click", async () => setExcludedForFiltered(true))
document.getElementById("includeFilteredBtn").addEventListener("click", async () => setExcludedForFiltered(false))
document.getElementById("exportBtn").addEventListener("click", exportFiltered)
document.getElementById("batchDeleteBtn").addEventListener("click", batchDelete)
document.getElementById("detailCloseBtn").addEventListener("click", closeDetailDrawer)
document.getElementById("saveNoteBtn").addEventListener("click", saveDetailNote)
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
 const detailButton = event.target.closest(".detail-btn")
 if (detailButton) {
  const id = detailButton.getAttribute("data-id")
  if (!id) return
  await openDetail(id)
  return
 }

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
