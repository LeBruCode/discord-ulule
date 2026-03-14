if (typeof window.applyDashboardCopy === "function") {
 window.applyDashboardCopy()
}

let page = 1
let limit = 100
let total = 0
let loading = false
let importPollTimer = null
let brevoSyncPollTimer = null
let currentDetailId = null
let copyEditorLoaded = false
let copyEntries = []

const selectedIds = new Set()
let currentRowIds = []
const t = window.dashboardT || ((key) => key)

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
  queued: t("brevo_status_queued"),
  request: t("brevo_status_request"),
  sent: t("brevo_status_sent"),
  delivered: t("brevo_status_delivered"),
  opened: t("brevo_status_opened"),
  unique_opened: t("brevo_status_opened"),
  click: t("brevo_status_click"),
  unique_clicked: t("brevo_status_click"),
  soft_bounce: t("brevo_status_soft_bounce"),
  hard_bounce: t("brevo_status_hard_bounce"),
  blocked: t("brevo_status_blocked"),
  error: t("brevo_status_error"),
  deferred: t("brevo_status_deferred"),
  invalid: t("brevo_status_invalid"),
  spam: t("brevo_status_spam")
 }
 return labels[status] || t("brevo_status_none")
}

function formatYesNo(value) {
 return value ? t("yes") : t("no")
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

 document.getElementById("pageInfo").innerText = t("meta_page", { page: clampedPage, totalPages })
 document.getElementById("listMeta").innerText = t("meta_results", {
  total,
  plural: total > 1 ? "s" : "",
  limit,
  selected: selectedIds.size,
  selectedPlural: selectedIds.size > 1 ? "s" : ""
 })
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
  for (const key of ["none", "request", "queued", "sent", "delivered", "soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam", "consolidated", "gap"]) {
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
   queueStatus.innerText = t("queue_running")
   return
  }

  const sent = status.lastStats?.sent || 0
  const failed = status.lastStats?.failed || 0
  const processed = status.lastStats?.processed || 0
  queueStatus.innerText = t("queue_last_batch", { processed, sent, failed })
 } catch (error) {
  document.getElementById("queueStatus").innerText = t("queue_unavailable")
 }
}

function renderImportStatus(status) {
 const importStatus = document.getElementById("importStatus")
 const bar = document.getElementById("importProgressBar")
 const progress = Number(status.progress) || 0
 bar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`

 if (status.running) {
  importStatus.innerText = t("import_running", {
   processed: status.processed,
   total: status.total,
   progress,
   inserted: status.inserted,
   failed: status.failed
  })
  return
 }

 if ((status.total || 0) > 0) {
  importStatus.innerText = t("import_finished", {
   processed: status.processed,
   total: status.total,
   inserted: status.inserted,
   failed: status.failed
  })
  return
 }

 importStatus.innerText = t("import_idle")
}

function setReconcileStatus(message) {
 document.getElementById("reconcileStatus").innerText = message
}

function renderBrevoSyncStatus(status) {
 const statusNode = document.getElementById("brevoSyncStatus")
 const bar = document.getElementById("brevoSyncProgressBar")
 const progress = Number(status?.progress) || 0
 bar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`

 if (status?.running) {
  statusNode.innerText = t("brevo_sync_running", {
   processed: status.processed || 0,
   total: status.total || 0,
   progress,
   matched: status.matched || 0,
   updated: status.updated || 0,
   missing: status.missing || 0,
   failed: status.failed || 0
  })
  return
 }

 if ((status?.processed || 0) > 0 || (status?.updated || 0) > 0) {
  statusNode.innerText = t("brevo_sync_finished", {
   processed: status.processed || 0,
   total: status.total || 0,
   matched: status.matched || 0,
   updated: status.updated || 0,
   missing: status.missing || 0,
   failed: status.failed || 0
  })
  return
 }

 statusNode.innerText = t("brevo_sync_idle")
}

async function refreshBrevoSyncStatus() {
 try {
  const status = await fetch("/admin/api/brevo-sync-status").then((r) => r.json())
  renderBrevoSyncStatus(status)
  return status
 } catch (error) {
  document.getElementById("brevoSyncStatus").innerText = t("brevo_sync_unavailable")
  return null
 }
}

async function refreshImportStatus() {
 try {
  const status = await fetch("/admin/api/import-status").then((r) => r.json())
  renderImportStatus(status)
  return status
 } catch (error) {
  document.getElementById("importStatus").innerText = t("import_unknown")
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

function startBrevoSyncPolling() {
 if (brevoSyncPollTimer) clearInterval(brevoSyncPollTimer)
 brevoSyncPollTimer = setInterval(async () => {
  const status = await refreshBrevoSyncStatus()
  if (!status) return
  if (!status.running) {
   clearInterval(brevoSyncPollTimer)
   brevoSyncPollTimer = null
   await refreshAll()
  }
 }, 2000)
}

function stopBrevoSyncPolling() {
 if (!brevoSyncPollTimer) return
 clearInterval(brevoSyncPollTimer)
 brevoSyncPollTimer = null
}

function renderRows(rows) {
 const table = document.getElementById("table")
 if (!rows.length) {
  currentRowIds = []
  updateSelectAllState()
  table.innerHTML = `<tr><td colspan="9">${escapeHtml(t("table_empty"))}</td></tr>`
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
    <td class="email-cell" title="${email}">${email}${excluded ? ` <span class="inline-pill">${escapeHtml(t("row_excluded_pill"))}</span>` : ""}</td>
    <td class="status-cell">${sent}</td>
    <td class="status-cell">${used}</td>
    <td class="datetime-cell">${sentAt}</td>
    <td class="datetime-cell">${usedAt}</td>
    <td class="status-pill-cell"><span class="brevo-badge brevo-${brevoStatusKey.replace(/[^a-z_]+/g, "-")}">${brevoStatus}</span></td>
    <td class="error-cell">${error}</td>
    <td class="actions-cell">
     <button class="icon-btn detail-btn" data-id="${id}" title="${escapeHtml(t("row_detail_title"))}" aria-label="${escapeHtml(t("row_detail_title"))}">⋯</button>
     <button class="icon-btn resend-btn" data-email="${email}" title="${escapeHtml(t("row_resend_title"))}" aria-label="${escapeHtml(t("row_resend_title"))}">✉</button>
     <button class="icon-btn delete-btn" data-id="${id}" data-email="${email}" title="${escapeHtml(t("row_delete_title"))}" aria-label="${escapeHtml(t("row_delete_title"))}">🗑</button>
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
  document.getElementById("table").innerHTML = `<tr><td colspan="9">${escapeHtml(t("table_load_error"))}</td></tr>`
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
  alert(t("alert_import_running"))
  startImportPolling()
  return
 }
 if (!response.ok) {
  alert(payload.error || t("alert_import_failed"))
  return
 }
 emailsInput.value = ""
 alert(t("alert_import_started", { total: payload.total || 0 }))
 startImportPolling()
 page = 1
 await refreshAll()
}

async function sendEmails() {
 const response = await fetch("/admin/api/send", { method: "POST" })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_send_failed"))
  return
 }
 alert(t("alert_send_started", { queued: payload.queued || 0 }))
 await refreshAll()
}

async function reconcileSentEmails() {
 const input = document.getElementById("reconcileEmails")
 const emails = input.value
 if (!emails.trim()) {
  alert(t("alert_reconcile_missing_input"))
  return
 }

 setReconcileStatus(t("reconcile_running"))
 const response = await fetch("/admin/api/reconcile-sent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ emails })
 })
 const payload = await response.json()
 if (!response.ok) {
  setReconcileStatus(t("reconcile_failed"))
  alert(payload.error || t("alert_reconcile_failed"))
  return
 }

 input.value = ""
 const missing = Number(payload.missing) || 0
 const updatedRows = Number(payload.updatedRows) || 0
 const matched = Number(payload.matched) || 0
 setReconcileStatus(t("reconcile_done", { matched, updated: updatedRows, missing }))

 if (missing > 0) {
  const preview = (payload.missingEmails || []).slice(0, 15).join("\n")
  alert(t("alert_reconcile_done_missing", {
   matched,
   updated: updatedRows,
   missing,
   preview: preview ? `\n\nExemples absents:\n${preview}` : ""
  }))
 } else {
  alert(t("alert_reconcile_done", { matched, updated: updatedRows }))
 }

 page = 1
 await refreshAll()
}

async function startBrevoSync() {
 const response = await fetch("/admin/api/brevo-sync", { method: "POST" })
 const payload = await response.json()

 if (response.status === 409) {
  alert(t("alert_brevo_sync_running"))
  startBrevoSyncPolling()
  return
 }

 if (!response.ok) {
  alert(payload.error || t("alert_brevo_sync_failed"))
  return
 }

 alert(t("alert_brevo_sync_started"))
 startBrevoSyncPolling()
 await refreshBrevoSyncStatus()
}

async function resendEmail(email) {
 const response = await fetch("/admin/api/resend", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.details || payload.error || t("alert_resend_failed"))
  return
 }
 alert(t("alert_resend_ok", { email }))
 await refreshAll()
}

async function deleteRow(id, email) {
 const confirmed = window.confirm(t("confirm_delete_row", { email }))
 if (!confirmed) return

 const response = await fetch("/admin/api/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id })
 })

 if (!response.ok) {
  alert(t("alert_delete_failed"))
  return
 }

 selectedIds.delete(id)
 alert(t("alert_delete_ok", { email }))
 page = 1
 await refreshAll()
}

async function batchResend() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert(t("alert_select_none"))
  return
 }

 const response = await fetch("/admin/api/batch-resend", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_batch_resend_failed"))
  return
 }

 alert(t("alert_batch_resend_ok", {
  processed: payload.processed || 0,
  sent: payload.sent || 0,
  failed: payload.failed || 0
 }))
 await refreshAll()
}

async function resendFiltered() {
 const { search, status, brevoStatus } = getFilters()
 const labelParts = []
 if (status !== "all") labelParts.push(t("filter_label_status", { value: status }))
 if (brevoStatus !== "all") labelParts.push(t("filter_label_brevo", { value: brevoStatus }))
 if (search) labelParts.push(t("filter_label_search", { value: search }))
 const label = labelParts.length ? ` (${labelParts.join(", ")})` : ""

 const confirmed = window.confirm(t("confirm_resend_filtered", { label }))
 if (!confirmed) return

 const response = await fetch("/admin/api/resend-filtered", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search, status, brevoStatus })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_resend_filter_failed"))
  return
 }

 alert(t("alert_resend_filter_ok", {
  processed: payload.processed || 0,
  sent: payload.sent || 0,
  failed: payload.failed || 0
 }))
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
  alert(payload.error || t("alert_select_filter_failed"))
  return
 }

 selectedIds.clear()
 for (const id of payload.ids || []) selectedIds.add(id)
 updateSelectAllState()
 updatePaginationMeta()
 alert(t("alert_select_filter_ok", { total: payload.total || 0 }))
}

async function setExcludedForSelected(excluded) {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert(t("alert_select_none_fun"))
  return
 }

 const response = await fetch("/admin/api/exclude-selected", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids, excluded })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_exclude_failed"))
  return
 }

 alert(t("alert_exclude_ok", {
  updated: payload.updated || 0,
  action: excluded ? t("action_excluded_selected") : t("action_included_selected")
 }))
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
  alert(payload.error || t("alert_exclude_filter_failed"))
  return
 }

 alert(t("alert_exclude_ok", {
  updated: payload.updated || 0,
  action: excluded ? t("action_excluded_filtered") : t("action_included_filtered")
 }))
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

function closeCopyDrawer() {
 document.getElementById("copyDrawer").classList.add("hidden")
}

function renderCopyEditorEntries() {
 const container = document.getElementById("copyEditorList")
 const search = document.getElementById("copySearch").value.trim().toLowerCase()
 const entries = copyEntries.filter((entry) => {
  if (!search) return true
  return entry.label.toLowerCase().includes(search) || entry.key.toLowerCase().includes(search) || entry.value.toLowerCase().includes(search)
 })

 if (!entries.length) {
  container.innerHTML = '<p class="panel-copy">Aucun texte ne correspond à ta recherche.</p>'
  return
 }

  container.innerHTML = entries.map((entry) => `
   <div class="copy-editor-row">
    <label for="copy-${escapeHtml(entry.key)}">
     <span>${escapeHtml(entry.label)}</span>
     <code>${escapeHtml(entry.key)}</code>
    </label>
    <textarea id="copy-${escapeHtml(entry.key)}" data-copy-key="${escapeHtml(entry.key)}">${escapeHtml(entry.value)}</textarea>
   </div>
  `).join("")
}

async function openCopyDrawer() {
 document.getElementById("copyDrawer").classList.remove("hidden")
 if (copyEditorLoaded) {
  renderCopyEditorEntries()
  return
 }

 const response = await fetch("/admin/api/dashboard-copy")
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || "Impossible de charger les textes du dashboard")
  return
 }

 copyEntries = Array.isArray(payload.entries) ? payload.entries : []
 renderCopyEditorEntries()
 copyEditorLoaded = true
}

async function saveCopyEditor() {
 const entries = {}
 for (const textarea of document.querySelectorAll("[data-copy-key]")) {
  entries[textarea.getAttribute("data-copy-key")] = textarea.value
 }

 const response = await fetch("/admin/api/dashboard-copy", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ entries })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.details || payload.error || "Impossible d'enregistrer les textes")
  return
 }

 alert("Textes enregistrés. Fais un petit refresh pour savourer.")
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
  alert(payload.error || t("alert_detail_failed"))
  return
 }

 currentDetailId = id
 const row = payload.data || {}
 document.getElementById("detailEmail").innerText = row.email || "-"
 document.getElementById("detailMeta").innerHTML = `
  <span class="inline-pill">${formatBrevoStatus(row.brevo_status)}</span>
  <span class="inline-pill">${row.resend_excluded ? t("detail_status_excluded") : t("detail_status_allowed")}</span>
  <span class="inline-pill">${t("detail_status_activated", { value: formatYesNo(row.used) })}</span>
 `
 document.getElementById("detailTimeline").innerHTML = (payload.timeline || []).map(renderTimelineItem).join("") || `<p class="panel-copy">${escapeHtml(t("detail_no_history"))}</p>`
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
  alert(payload.error || t("alert_note_failed"))
  return
 }

 alert(t("alert_note_ok"))
 await openDetail(currentDetailId)
 await loadList()
}

async function batchDelete() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert(t("alert_select_none_saw"))
  return
 }

 const confirmed = window.confirm(t("confirm_delete_rows", { count: ids.length }))
 if (!confirmed) return

 const response = await fetch("/admin/api/batch-delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ids })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_batch_delete_failed"))
  return
 }

 ids.forEach((id) => selectedIds.delete(id))
 alert(t("alert_batch_delete_ok", { deleted: payload.deleted || 0 }))
 page = 1
 await refreshAll()
}

async function refreshAll() {
 const [importStatus, brevoSyncStatus] = await Promise.all([
  refreshImportStatus(),
  refreshBrevoSyncStatus(),
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

 if (brevoSyncStatus?.running) {
  if (!brevoSyncPollTimer) startBrevoSyncPolling()
 } else {
  stopBrevoSyncPolling()
 }
}

document.getElementById("importBtn").addEventListener("click", importEmails)
document.getElementById("sendBtn").addEventListener("click", sendEmails)
document.getElementById("reconcileBtn").addEventListener("click", reconcileSentEmails)
document.getElementById("brevoSyncBtn").addEventListener("click", startBrevoSync)
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
document.getElementById("copyEditorBtn").addEventListener("click", openCopyDrawer)
document.getElementById("copyCloseBtn").addEventListener("click", closeCopyDrawer)
document.getElementById("saveCopyBtn").addEventListener("click", saveCopyEditor)
document.getElementById("copySearch").addEventListener("input", renderCopyEditorEntries)
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
