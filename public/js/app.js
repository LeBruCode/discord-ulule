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
let currentDetailEmail = ""
let copyEditorLoaded = false
let copyEntries = []
let brandingState = { logoPath: null, updatedAt: null }
const COCKPIT_MODE_KEY = "dashboard-cockpit-mode"

const selectedIds = new Set()
let currentRowIds = []
const t = window.dashboardT || ((key) => key)
let confirmResolve = null

function iconSvg(name) {
 const icons = {
  detail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  resend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z"></path><path d="m4 8 8 6 8-6"></path></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 12h10l1-12"></path><path d="M9 7V4h6v3"></path></svg>',
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 8.4c1.1-.5 2.2-.8 3.3-.8 1.1 0 2.2.3 3.3.8"></path><path d="M7.1 16.7c-1-.7-1.8-1.8-2.3-3.3.5-2.4 1.6-4.2 3.1-5.4.8-.1 1.6 0 2.4.4l.4.8"></path><path d="M16.9 16.7c1-.7 1.8-1.8 2.3-3.3-.5-2.4-1.6-4.2-3.1-5.4-.8-.1-1.6 0-2.4.4l-.4.8"></path><circle cx="9.5" cy="12.5" r="1"></circle><circle cx="14.5" cy="12.5" r="1"></circle><path d="M8.8 17.5c1 .5 2.1.8 3.2.8 1.1 0 2.2-.3 3.2-.8"></path></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 4.5L18 8.2l-4.3 1.7L12 14.4l-1.7-4.5L6 8.2l4.3-1.7L12 2z"></path><path d="m19 14 1 2.6 2.5 1-2.5 1-1 2.4-1-2.4-2.5-1 2.5-1L19 14z"></path><path d="m5 15 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"></path></svg>'
 }
 return icons[name] || ""
}

function inferToastTone(message) {
 const text = String(message || "").toLowerCase()
 if (/(échou|impossible|erreur|invalid|introuv|bloqu|failed|server error)/.test(text)) return "error"
 if (/(enregistr|supprim|renvoy|sélectionn|lancé|chargé|terminée|terminé|retiré)/.test(text)) return "success"
 return "info"
}

function toastTitleKey(tone) {
 if (tone === "error") return "toast_error_title"
 if (tone === "success") return "toast_success_title"
 return "toast_info_title"
}

function showToast(message, { tone = inferToastTone(message), duration = 4200 } = {}) {
 const stack = document.getElementById("toastStack")
 if (!stack) return

 const toast = document.createElement("div")
 toast.className = `toast toast-${tone}`
 toast.innerHTML = `
  <div class="toast-copy">
   <strong>${escapeHtml(t(toastTitleKey(tone)))}</strong>
   <p>${escapeHtml(String(message || ""))}</p>
  </div>
  <button type="button" class="toast-close" aria-label="${escapeHtml(t("detail_close"))}">×</button>
 `

 const close = () => {
  toast.classList.add("toast-exit")
  window.setTimeout(() => toast.remove(), 180)
 }

 toast.querySelector(".toast-close")?.addEventListener("click", close)
 stack.appendChild(toast)
 window.setTimeout(close, duration)
}

async function showConfirm(message, { confirmLabel = t("confirm_ok"), cancelLabel = t("confirm_cancel"), title = t("confirm_title") } = {}) {
 const modal = document.getElementById("confirmModal")
 const titleNode = document.getElementById("confirmModalTitle")
 const messageNode = document.getElementById("confirmModalMessage")
 const cancelButton = document.getElementById("confirmModalCancel")
 const okButton = document.getElementById("confirmModalOk")

 if (!modal || !titleNode || !messageNode || !cancelButton || !okButton) return false

 titleNode.textContent = title
 messageNode.textContent = String(message || "")
 cancelButton.textContent = cancelLabel
 okButton.textContent = confirmLabel
 modal.classList.remove("hidden")
 syncFocusMode()

 return await new Promise((resolve) => {
  confirmResolve = resolve
 })
}

function closeConfirm(result) {
 const modal = document.getElementById("confirmModal")
 if (modal) modal.classList.add("hidden")
 if (confirmResolve) {
  const resolve = confirmResolve
  confirmResolve = null
  resolve(result)
 }
 syncFocusMode()
}

window.alert = (message) => showToast(message)

function setCockpitMode(enabled, { reveal = false } = {}) {
 const cockpit = document.getElementById("cockpitPanel")
 document.body.classList.toggle("cockpit-dense", Boolean(enabled))
 const button = document.getElementById("cockpitModeBtn")
 if (button) {
  button.classList.toggle("is-active", Boolean(enabled))
  button.setAttribute("aria-pressed", enabled ? "true" : "false")
 }
 if (cockpit) cockpit.classList.toggle("hidden", !enabled)
 try {
  window.localStorage.setItem(COCKPIT_MODE_KEY, enabled ? "1" : "0")
 } catch (error) {
  console.debug("cockpit mode persistence skipped", error)
 }
 if (reveal && enabled && cockpit) {
  cockpit.scrollIntoView({ behavior: "smooth", block: "start" })
 }
}

function syncFocusMode() {
 const active = !document.getElementById("detailDrawer")?.classList.contains("hidden")
  || !document.getElementById("copyDrawer")?.classList.contains("hidden")
  || !document.getElementById("brandingDrawer")?.classList.contains("hidden")
  || !document.getElementById("confirmModal")?.classList.contains("hidden")
 const scrim = document.getElementById("focusScrim")
 document.body.classList.toggle("focus-mode", active)
 if (scrim) scrim.classList.toggle("hidden", !active)
}

async function loadLatestDashboardCopy() {
 try {
  const response = await fetch("/admin/api/dashboard-copy", { cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "dashboard copy request failed")
  if (payload.copy && typeof payload.copy === "object") {
   window.DASHBOARD_COPY = payload.copy
   if (typeof window.applyDashboardCopy === "function") {
    window.applyDashboardCopy()
   }
   refreshStats().catch((error) => {
    console.debug("stats refresh skipped after copy load", error)
   })
   syncCollapseButtons()
  }
 } catch (error) {
  console.error("dashboard copy refresh error", error)
 }
}

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

function badgeTone(kind) {
 if (kind === "good") return "smart-good"
 if (kind === "warn") return "smart-warn"
 if (kind === "pending") return "smart-pending"
 return "smart-neutral"
}

function renderSmartBadge(label, { kind = "neutral", icon = "" } = {}) {
 return `<span class="smart-badge ${badgeTone(kind)}">${icon ? `<span class="smart-badge-icon">${iconSvg(icon)}</span>` : ""}<span>${escapeHtml(label)}</span></span>`
}

function setMissionAction(slot, { value = 0, copy = "", tone = "" } = {}) {
 const card = document.getElementById(`cockpit${slot}ActionValue`)?.closest(".mission-action-card")
 const valueNode = document.getElementById(`cockpit${slot}ActionValue`)
 const copyNode = document.getElementById(`cockpit${slot}ActionCopy`)
 if (valueNode) valueNode.innerText = String(value || 0)
 if (copyNode) copyNode.innerText = copy
 if (card) {
  card.classList.remove("tone-good", "tone-pending", "tone-warn")
  if (tone) card.classList.add(`tone-${tone}`)
 }
}

function buildBrandingAssetUrl(branding = {}) {
 const rawSource = branding.logoDataUrl || branding.logoPath || ""
 if (!rawSource) return ""
 if (rawSource.startsWith("data:")) return rawSource
 const updatedAt = branding.updatedAt || null
 const version = updatedAt ? new Date(updatedAt).getTime() : Date.now()
 return `${rawSource}${rawSource.includes("?") ? "&" : "?"}v=${version}`
}

function applyBranding(branding = {}) {
 brandingState = branding
 const logoPath = branding.logoPath || null
 const logoDataUrl = branding.logoDataUrl || null
 const logoWidth = Number(branding.logoWidth) || 96
 const logoUrl = buildBrandingAssetUrl(branding)
 const brandLogo = document.getElementById("brandLogo")
 const preview = document.getElementById("brandingPreview")
 const status = document.getElementById("brandingStatus")
 const removeButton = document.getElementById("brandingRemoveBtn")
 const sizeRange = document.getElementById("brandingSizeRange")
 const sizeValue = document.getElementById("brandingSizeValue")

 brandLogo.style.width = `${logoWidth}px`
 brandLogo.style.height = "auto"
  sizeRange.value = String(logoWidth)
 sizeValue.innerText = `${logoWidth} px`

 if (logoUrl) {
 brandLogo.src = logoUrl
  preview.src = logoUrl
  brandLogo.classList.remove("hidden")
  preview.classList.remove("hidden")
  status.innerText = logoPath ? logoPath.split("/").pop() : (logoDataUrl ? t("branding_loaded") : t("branding_empty"))
  removeButton.disabled = false
  return
 }

 brandLogo.removeAttribute("src")
 preview.removeAttribute("src")
 brandLogo.classList.add("hidden")
 preview.classList.add("hidden")
 status.innerText = t("branding_empty")
 removeButton.disabled = true
}

async function refreshBranding() {
 try {
  const response = await fetch("/admin/api/dashboard-branding")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "branding request failed")
  applyBranding(payload.branding || {})
 } catch (error) {
  console.error("branding refresh error", error)
 }
}

async function uploadBrandingFile(file) {
 const allowed = ["image/png", "image/jpeg"]
 if (!file || !allowed.includes(file.type) || file.size > 1024 * 1024 * 2) {
  showToast(t("alert_branding_invalid"))
  return
 }

 const dataUrl = await new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ""))
  reader.onerror = () => reject(new Error("file read failed"))
  reader.readAsDataURL(file)
 })

 const response = await fetch("/admin/api/dashboard-branding/logo", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ dataUrl })
 })
 const payload = await response.json()
 if (!response.ok) {
  showToast(payload.error || t("alert_branding_failed"))
  return
 }

 applyBranding(payload.branding || {})
 showToast(t("alert_branding_saved"))
}

async function removeBrandingLogo() {
 const response = await fetch("/admin/api/dashboard-branding/logo", { method: "DELETE" })
 const payload = await response.json()
 if (!response.ok) {
  showToast(payload.error || t("alert_branding_failed"))
  return
 }

 applyBranding(payload.branding || {})
 showToast(t("alert_branding_removed"))
}

async function saveBrandingSize() {
 const sizeRange = document.getElementById("brandingSizeRange")
 const response = await fetch("/admin/api/dashboard-branding/settings", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ logoWidth: Number(sizeRange.value) || 96 })
 })
 const payload = await response.json()
 if (!response.ok) {
  showToast(payload.error || t("alert_branding_failed"))
  return
 }

 applyBranding(payload.branding || {})
}

function toggleCollapsible(targetId, button) {
 const target = document.getElementById(targetId)
 if (!target) return
 const collapsed = target.classList.toggle("collapsed")
 if (button) {
  button.setAttribute("aria-expanded", collapsed ? "false" : "true")
  button.innerText = collapsed ? t("expand_btn") : t("collapse_btn")
  }
}

function syncCollapseButtons() {
 for (const button of document.querySelectorAll(".collapse-toggle")) {
  const target = document.getElementById(button.dataset.target)
  const collapsed = target?.classList.contains("collapsed")
  button.setAttribute("aria-expanded", collapsed ? "false" : "true")
  button.innerText = collapsed ? t("expand_btn") : t("collapse_btn")
 }
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
 const totalCount = Number(stats.total || 0)
 const activatedCount = Number(stats.activated || 0)
 const sentCount = Number(stats.sent || 0)
 const relanceableCount = Number(stats.relanceable || 0)
 const pendingCount = Number(stats.pending || 0)
 const attentionCount = Number(stats.attention || 0)
 const unactivatedCount = Number(stats.unactivated || 0)
 const rateValue = totalCount ? Math.round((activatedCount / totalCount) * 100) : 0

 document.getElementById("total").innerText = totalCount
 document.getElementById("sent").innerText = sentCount
 document.getElementById("activated").innerText = activatedCount
 document.getElementById("rate").innerText = `${rateValue}%`
 document.getElementById("cockpitActivated").innerText = activatedCount
 document.getElementById("cockpitRelance").innerText = relanceableCount
 document.getElementById("cockpitPending").innerText = pendingCount
 document.getElementById("cockpitAttention").innerText = attentionCount
 document.getElementById("cockpitUnactivated").innerText = unactivatedCount
 document.getElementById("cockpitTotal").innerText = totalCount
 document.getElementById("cockpitRateDisplay").innerText = `${rateValue}%`
 document.getElementById("cockpitOrbitSub").innerText = t("cockpit_orbit_sub", {
  activated: activatedCount,
  total: totalCount
 })
 document.getElementById("cockpitOrbit").style.setProperty("--orbit-progress", `${Math.max(0, Math.min(rateValue, 100))}%`)
 document.getElementById("cockpitRateHint").innerText = t("cockpit_rate_hint", {
  activated: activatedCount,
  total: totalCount
 })
 document.getElementById("cockpitRelanceHint").innerText = t("cockpit_relance_hint")
 document.getElementById("cockpitPendingHint").innerText = t("cockpit_pending_hint")
 document.getElementById("cockpitAttentionHint").innerText = t("cockpit_attention_hint")
 document.getElementById("cockpitUnactivatedHint").innerText = t("cockpit_unactivated_hint")
 document.getElementById("cockpitTotalHint").innerText = t("cockpit_total_hint")

 const primary = attentionCount > 0
  ? { value: attentionCount, copy: t("cockpit_primary_action_copy_attention"), tone: "warn" }
  : relanceableCount > 0
   ? { value: relanceableCount, copy: t("cockpit_primary_action_copy_relance"), tone: "pending" }
   : { value: activatedCount, copy: t("cockpit_primary_action_copy_idle"), tone: "good" }

 const secondary = pendingCount > 0
  ? { value: pendingCount, copy: t("cockpit_secondary_action_copy_pending"), tone: "pending" }
  : unactivatedCount > 0
   ? { value: unactivatedCount, copy: t("cockpit_secondary_action_copy_unactivated"), tone: "warn" }
   : { value: sentCount, copy: t("cockpit_secondary_action_copy_idle"), tone: "good" }

 const tertiary = totalCount > 0
  ? { value: totalCount, copy: t("cockpit_tertiary_action_copy_total"), tone: "neutral" }
  : { value: 0, copy: t("cockpit_tertiary_action_copy_idle"), tone: "neutral" }

 setMissionAction("Primary", primary)
 setMissionAction("Secondary", secondary)
 setMissionAction("Tertiary", tertiary)
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
   if (status.total) {
    queueStatus.innerText = t("queue_running_progress", {
     processed: status.processed || 0,
     total: status.total || 0,
     progress: status.progress || 0,
     currentEmail: status.currentEmail || "-"
    })
    return
   }
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
 const stopButton = document.getElementById("brevoSyncStopBtn")
 const progress = Number(status?.progress) || 0
 bar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`
 stopButton.disabled = !status?.running

 if (status?.running) {
  statusNode.innerText = t("brevo_sync_running", {
   processed: status.processed || 0,
   total: status.total || 0,
   progress,
   matched: status.matched || 0,
   updated: status.updated || 0,
   missing: status.missing || 0,
   failed: status.failed || 0,
   currentEmail: status.currentEmail || "-"
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
  table.innerHTML = `<tr><td colspan="9"><div class="empty-state"><strong>${escapeHtml(t("table_empty"))}</strong><span>${escapeHtml(t("cockpit_pending_hint"))}</span></div></td></tr>`
  return
 }

 currentRowIds = rows.map((row) => String(row.id || "")).filter((id) => id)
 updateSelectAllState()

 table.innerHTML = rows
  .map((row) => {
   const id = row.id == null ? "" : String(row.id)
   const email = escapeHtml(row.email || "")
   const sentAt = escapeHtml(formatDate(row.email_sent_at))
   const usedAt = escapeHtml(formatDate(row.used_at))
   const brevoStatusKey = String(row.brevo_status || "").trim().toLowerCase()
   const brevoStatus = escapeHtml(formatBrevoStatus(brevoStatusKey))
   const excluded = row.resend_excluded === true
   const error = escapeHtml(row.email_error || "-")
   const checked = selectedIds.has(id) ? "checked" : ""
   const rowBadges = []
   rowBadges.push(
    row.used
     ? renderSmartBadge(t("badge_active"), { kind: "good", icon: row.discord_id ? "discord" : "spark" })
     : renderSmartBadge(t("badge_unactivated"), { kind: "pending" })
   )
   if (row.discord_id) {
    rowBadges.push(renderSmartBadge(t("badge_discord_joined"), { kind: "good", icon: "discord" }))
   }
   if (excluded) {
    rowBadges.push(renderSmartBadge(t("row_excluded_pill"), { kind: "warn" }))
   }
   if (["request", "queued", "sent"].includes(brevoStatusKey)) {
    rowBadges.push(renderSmartBadge(t("badge_pending"), { kind: "pending" }))
   }
   if (["soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam"].includes(brevoStatusKey)) {
    rowBadges.push(renderSmartBadge(t("badge_attention"), { kind: "warn" }))
   }
   const sentBadge = row.email_sent
    ? renderSmartBadge(t("badge_sent"), { kind: "good" })
    : renderSmartBadge(t("badge_unsent"), { kind: "neutral" })
   const activatedBadge = row.used
    ? renderSmartBadge(t("badge_active"), { kind: "good", icon: row.discord_id ? "discord" : "spark" })
    : renderSmartBadge(t("badge_unactivated"), { kind: "pending" })
   return `<tr>
    <td class="select-col"><input class="row-select" type="checkbox" data-id="${id}" ${checked}></td>
    <td class="email-cell" title="${email}"><div class="email-main">${email}</div><div class="row-badges">${rowBadges.join("")}</div></td>
    <td class="status-cell">${sentBadge}</td>
    <td class="status-cell">${activatedBadge}</td>
    <td class="datetime-cell">${sentAt}</td>
    <td class="datetime-cell">${usedAt}</td>
    <td class="status-pill-cell"><span class="brevo-badge brevo-${brevoStatusKey.replace(/[^a-z_]+/g, "-")}">${brevoStatus}</span></td>
    <td class="error-cell">${error}</td>
    <td class="actions-cell">
     <button class="icon-btn detail-btn" data-id="${id}" title="${escapeHtml(t("row_detail_title"))}" aria-label="${escapeHtml(t("row_detail_title"))}">${iconSvg("detail")}</button>
     <button class="icon-btn resend-btn" data-email="${email}" title="${escapeHtml(t("row_resend_title"))}" aria-label="${escapeHtml(t("row_resend_title"))}">${iconSvg("resend")}</button>
     <button class="icon-btn delete-btn" data-id="${id}" data-email="${email}" title="${escapeHtml(t("row_delete_title"))}" aria-label="${escapeHtml(t("row_delete_title"))}">${iconSvg("delete")}</button>
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

async function stopBrevoSync() {
 const response = await fetch("/admin/api/brevo-sync-stop", { method: "POST" })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_brevo_sync_stop_failed"))
  return
 }

 if (payload.stopped) {
  alert(t("alert_brevo_sync_stop_requested"))
 } else {
  alert(t("alert_brevo_sync_stop_idle"))
 }

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
 const confirmed = await showConfirm(t("confirm_delete_row", { email }))
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

 const confirmed = await showConfirm(t("confirm_resend_filtered", { label }))
 if (!confirmed) return

 const response = await fetch("/admin/api/resend-filtered", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search, status, brevoStatus })
 })
 const payload = await response.json()
 if (!response.ok) {
  showToast(payload.error || t("alert_resend_filter_failed"))
  return
 }

 showToast(t("queue_filtered_started", { queued: payload.queued || 0 }))
 await refreshQueueStatus()
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
 if (payload.capped) {
  alert(t("alert_select_filter_capped", { selected: payload.selected || 0, total: payload.total || 0 }))
  return
 }
 alert(t("alert_select_filter_success", { total: payload.selected || payload.total || 0 }))
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
 currentDetailEmail = ""
 document.getElementById("detailDrawer").classList.add("hidden")
 syncFocusMode()
}

function closeCopyDrawer() {
 document.getElementById("copyDrawer").classList.add("hidden")
 syncFocusMode()
}

function openBrandingDrawer() {
 document.getElementById("brandingDrawer").classList.remove("hidden")
 syncFocusMode()
}

function closeBrandingDrawer() {
 document.getElementById("brandingDrawer").classList.add("hidden")
 syncFocusMode()
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
 closeBrandingDrawer()
 document.getElementById("copyDrawer").classList.remove("hidden")
 syncFocusMode()
 await loadLatestDashboardCopy()
 if (copyEditorLoaded) {
  const response = await fetch("/admin/api/dashboard-copy", { cache: "no-store" })
  const payload = await response.json()
  if (response.ok) {
   copyEntries = Array.isArray(payload.entries) ? payload.entries : copyEntries
  }
  renderCopyEditorEntries()
  return
 }

 const response = await fetch("/admin/api/dashboard-copy", { cache: "no-store" })
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

 window.DASHBOARD_COPY = { ...(window.DASHBOARD_COPY || {}), ...entries }
 if (typeof window.applyDashboardCopy === "function") {
  window.applyDashboardCopy()
 }
 await refreshStats()
 copyEntries = Object.entries(entries).map(([key, value]) => ({
  key,
  label: key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
  value: String(value ?? "")
 }))
 renderCopyEditorEntries()
 syncCollapseButtons()
 alert(t("alert_copy_saved"))
}

function setupBrandingDropzone() {
 const input = document.getElementById("brandingFileInput")
 const dropzone = document.getElementById("brandingDropzone")

 input.addEventListener("change", async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  await uploadBrandingFile(file)
  input.value = ""
 })

 for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
   event.preventDefault()
   dropzone.classList.add("dragover")
  })
 }

 for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
   event.preventDefault()
   if (eventName === "dragleave" && dropzone.contains(event.relatedTarget)) return
   dropzone.classList.remove("dragover")
  })
 }

 dropzone.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  await uploadBrandingFile(file)
 })
}

function renderTimelineItem(item) {
 const label = escapeHtml(item.label || "-")
 const at = escapeHtml(formatDate(item.at))
 const value = escapeHtml(item.value || "-")
 const rawLabel = String(item.label || "").toLowerCase()
 let icon = "spark"
 let tone = "timeline-default"
 if (rawLabel.includes("brevo")) tone = "timeline-brevo"
 if (rawLabel.includes("activ")) tone = "timeline-activated"
 if (rawLabel.includes("discord")) {
  tone = "timeline-discord"
  icon = "discord"
 }
 if (rawLabel.includes("erreur")) tone = "timeline-error"
 return `<div class="timeline-item ${tone}"><div class="timeline-dot">${iconSvg(icon)}</div><div class="timeline-content"><b>${label}</b><p>${value}</p><span>${at}</span></div></div>`
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
 currentDetailEmail = String(row.email || "")
 document.getElementById("detailEmail").innerText = row.email || "-"
 document.getElementById("detailResendBtn").classList.toggle("hidden", !currentDetailEmail || Boolean(row.used))
 document.getElementById("detailResendBtn").disabled = !currentDetailEmail || Boolean(row.used)
 const detailBadges = [
  renderSmartBadge(formatBrevoStatus(row.brevo_status), {
   kind: ["soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam"].includes(String(row.brevo_status || "").toLowerCase()) ? "warn" : (row.used ? "good" : "pending")
  }),
  renderSmartBadge(row.resend_excluded ? t("detail_status_excluded") : t("detail_status_allowed"), {
   kind: row.resend_excluded ? "warn" : "neutral"
  }),
  renderSmartBadge(t("detail_status_activated", { value: formatYesNo(row.used) }), {
   kind: row.used ? "good" : "pending",
   icon: row.discord_id ? "discord" : ""
  })
 ]
 if (row.discord_id) {
  detailBadges.push(renderSmartBadge(t("badge_discord_joined"), { kind: "good", icon: "discord" }))
 }
 document.getElementById("detailMeta").innerHTML = detailBadges.join("")
 document.getElementById("detailTimeline").innerHTML = (payload.timeline || []).map(renderTimelineItem).join("") || `<p class="panel-copy">${escapeHtml(t("detail_no_history"))}</p>`
 document.getElementById("detailNote").value = row.admin_note || ""
 document.getElementById("detailDrawer").classList.remove("hidden")
 syncFocusMode()
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

async function resendDetailEmail() {
 if (!currentDetailEmail) return
 await resendEmail(currentDetailEmail)
 if (currentDetailId) {
  await openDetail(currentDetailId)
 }
}

async function batchDelete() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert(t("alert_select_none_saw"))
  return
 }

 const confirmed = await showConfirm(t("confirm_delete_rows", { count: ids.length }))
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
  refreshBranding(),
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
 syncCollapseButtons()
}

document.getElementById("importBtn").addEventListener("click", importEmails)
document.getElementById("sendBtn").addEventListener("click", sendEmails)
document.getElementById("reconcileBtn").addEventListener("click", reconcileSentEmails)
document.getElementById("brevoSyncBtn").addEventListener("click", startBrevoSync)
document.getElementById("brevoSyncStopBtn").addEventListener("click", stopBrevoSync)
document.getElementById("cockpitModeBtn").addEventListener("click", () => {
 setCockpitMode(!document.body.classList.contains("cockpit-dense"), { reveal: true })
})
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
document.getElementById("detailResendBtn").addEventListener("click", resendDetailEmail)
document.getElementById("saveNoteBtn").addEventListener("click", saveDetailNote)
document.getElementById("copyCloseBtn").addEventListener("click", closeCopyDrawer)
document.getElementById("brandingOpenBtn").addEventListener("click", openBrandingDrawer)
document.getElementById("brandingCloseBtn").addEventListener("click", closeBrandingDrawer)
document.getElementById("copyFromBrandingBtn").addEventListener("click", openCopyDrawer)
document.getElementById("saveCopyBtn").addEventListener("click", saveCopyEditor)
document.getElementById("brandingRemoveBtn").addEventListener("click", removeBrandingLogo)
document.getElementById("brandingSizeRange").addEventListener("input", (event) => {
 document.getElementById("brandingSizeValue").innerText = `${event.target.value} px`
 document.getElementById("brandLogo").style.width = `${event.target.value}px`
 document.getElementById("brandLogo").style.height = "auto"
})
document.getElementById("brandingSizeRange").addEventListener("change", saveBrandingSize)
document.getElementById("copySearch").addEventListener("input", renderCopyEditorEntries)
document.getElementById("confirmModalCancel").addEventListener("click", () => closeConfirm(false))
document.getElementById("confirmModalOk").addEventListener("click", () => closeConfirm(true))
document.getElementById("confirmModal").addEventListener("click", (event) => {
 if (event.target.id === "confirmModal") closeConfirm(false)
})
document.getElementById("focusScrim")?.addEventListener("click", () => {
 closeDetailDrawer()
 closeCopyDrawer()
 closeBrandingDrawer()
 closeConfirm(false)
})
document.addEventListener("keydown", (event) => {
 if (event.key === "Escape" && !document.getElementById("confirmModal").classList.contains("hidden")) {
  closeConfirm(false)
 }
})
for (const button of document.querySelectorAll(".collapse-toggle")) {
 button.addEventListener("click", () => toggleCollapsible(button.dataset.target, button))
}
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

setupBrandingDropzone()
setCockpitMode(window.localStorage.getItem(COCKPIT_MODE_KEY) === "1")
loadLatestDashboardCopy()
 .then(() => refreshAll())
 .catch((error) => {
  console.error("dashboard init error", error)
 })
