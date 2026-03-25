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
let copyEditorDirty = false
let brandingState = { logoPath: null, updatedAt: null }
let supportMatch = null
const COCKPIT_MODE_KEY = "dashboard-cockpit-mode"
const NOTIFICATION_STORE_KEY = "dashboard-notifications"
let activationChartRange = "14"
let ululeSyncPollTimer = null
const COPY_ENTRY_GROUPS = {
 landing: {
  label: "Page publique",
  order: 0
 },
 dashboard: {
  label: "Dashboard admin",
  order: 1
 }
}

const selectedIds = new Set()
let currentRowIds = []
const t = window.dashboardT || ((key) => key)
let confirmResolve = null

function iconSvg(name) {
 const icons = {
  detail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  resend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10H4z"></path><path d="m4 8 8 6 8-6"></path></svg>',
  token: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="15.5" r="3.5"></circle><path d="M11.5 12.5 20 4"></path><path d="M15 6h3v3"></path><path d="M17 4h3v3"></path></svg>',
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

function readNotifications() {
 try {
  const raw = window.localStorage.getItem(NOTIFICATION_STORE_KEY)
  const parsed = raw ? JSON.parse(raw) : []
  return Array.isArray(parsed) ? parsed : []
 } catch (error) {
  console.debug("notification storage read skipped", error)
  return []
 }
}

function writeNotifications(entries) {
 try {
  window.localStorage.setItem(NOTIFICATION_STORE_KEY, JSON.stringify(entries.slice(0, 12)))
 } catch (error) {
  console.debug("notification storage write skipped", error)
 }
}

function pushNotification(message, { tone = inferToastTone(message) } = {}) {
 const entries = readNotifications()
 entries.unshift({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  message: String(message || ""),
  tone,
  at: new Date().toISOString()
 })
 writeNotifications(entries)
 renderNotificationCenter()
}

function renderNotificationCenter(live = {}) {
 const node = document.getElementById("notificationList")
 if (!node) return

 const items = []
 if (live.queueRunning) {
  items.push({ id: "queue-running", message: t("notice_running_queue"), tone: "info", at: new Date().toISOString() })
 }
 if (live.syncRunning) {
  items.push({ id: "sync-running", message: t("notice_running_sync"), tone: "info", at: new Date().toISOString() })
 }
 items.push(...readNotifications())

 const unique = []
 const seen = new Set()
 for (const item of items) {
  if (!item?.id || seen.has(item.id)) continue
  seen.add(item.id)
  unique.push(item)
  if (unique.length >= 8) break
 }

 if (!unique.length) {
  node.innerHTML = `<div class="mini-empty">${escapeHtml(t("notice_empty"))}</div>`
  return
 }

 node.innerHTML = unique.map((item) => `
  <article class="notice-item notice-${escapeHtml(item.tone || "info")}">
   <div class="notice-bullet"></div>
   <div class="notice-copy">
    <strong>${escapeHtml(item.message || "")}</strong>
    <span>${escapeHtml(formatDate(item.at))}</span>
   </div>
  </article>
 `).join("")
}

function formatShortDate(dateValue) {
 const date = new Date(dateValue)
 if (Number.isNaN(date.getTime())) return "-"
 return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
}

function renderActivationChart(points) {
 const node = document.getElementById("activationChart")
 if (!node) return
 const items = Array.isArray(points) ? points : []
 if (!items.length || items.every((point) => Number(point.count || 0) === 0)) {
  node.innerHTML = `<div class="mini-empty">${escapeHtml(t("activation_chart_empty"))}</div>`
  return
 }

 const width = 920
 const height = 240
 const paddingX = 28
 const paddingTop = 22
 const paddingBottom = 34
 const usableWidth = width - (paddingX * 2)
 const usableHeight = height - paddingTop - paddingBottom
 const maxCount = Math.max(...items.map((point) => Number(point.count || 0)), 1)

 const coordinates = items.map((point, index) => {
  const x = paddingX + (usableWidth * (items.length === 1 ? 0.5 : index / (items.length - 1)))
  const y = paddingTop + usableHeight - ((Number(point.count || 0) / maxCount) * usableHeight)
  return { ...point, x, y }
 })

 const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ")
 const area = `M ${coordinates[0].x} ${height - paddingBottom} L ${coordinates.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${coordinates[coordinates.length - 1].x} ${height - paddingBottom} Z`
 const labels = coordinates.map((point, index) => {
  if (index !== 0 && index !== coordinates.length - 1 && index % 2 !== 0) return ""
  return `<text x="${point.x}" y="${height - 10}" text-anchor="middle">${escapeHtml(formatShortDate(point.date))}</text>`
 }).join("")
 const valueLabels = coordinates.map((point) => {
  if (Number(point.count || 0) <= 0) return ""
  return `<text x="${point.x}" y="${Math.max(point.y - 14, 16)}" text-anchor="middle" class="activation-value-label">${escapeHtml(String(point.count))}</text>`
 }).join("")

 node.innerHTML = `
  <div class="activation-chart-shell">
  <svg viewBox="0 0 ${width} ${height}" class="activation-chart-svg" role="img" aria-label="${escapeHtml(t("activation_chart_title"))}">
   <defs>
    <linearGradient id="activationArea" x1="0" x2="0" y1="0" y2="1">
     <stop offset="0%" stop-color="rgba(99, 163, 255, 0.32)"></stop>
     <stop offset="100%" stop-color="rgba(99, 163, 255, 0)"></stop>
    </linearGradient>
   </defs>
   <line x1="${paddingX}" y1="${height - paddingBottom}" x2="${width - paddingX}" y2="${height - paddingBottom}" class="activation-axis"></line>
   <path d="${area}" class="activation-area"></path>
   <polyline points="${polyline}" class="activation-line"></polyline>
   ${coordinates.map((point) => `
    <g class="activation-point-group">
     <circle cx="${point.x}" cy="${point.y}" r="5.5" class="activation-point" data-date="${escapeHtml(point.date)}" data-count="${escapeHtml(String(point.count))}"></circle>
     <circle cx="${point.x}" cy="${point.y}" r="14" class="activation-hit" data-date="${escapeHtml(point.date)}" data-count="${escapeHtml(String(point.count))}"></circle>
    </g>
   `).join("")}
   <g class="activation-values">${valueLabels}</g>
   <g class="activation-labels">${labels}</g>
  </svg>
  <div class="activation-chart-tooltip hidden" id="activationChartTooltip"></div>
  </div>
 `

 const shell = node.querySelector(".activation-chart-shell")
 const tooltip = node.querySelector(".activation-chart-tooltip")
 if (!shell || !tooltip) return

 shell.addEventListener("pointerleave", () => {
  tooltip.classList.add("hidden")
 })

 shell.addEventListener("pointermove", (event) => {
  const target = event.target.closest?.(".activation-hit, .activation-point")
  if (!target) {
   tooltip.classList.add("hidden")
   return
  }

  const date = String(target.getAttribute("data-date") || "")
  const count = Number(target.getAttribute("data-count") || 0)
  const label = new Date(date).toLocaleDateString("fr-FR", {
   weekday: "long",
   day: "numeric",
   month: "long",
   year: "numeric"
  })

  tooltip.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${count} activation${count > 1 ? "s" : ""}</span>`
  tooltip.classList.remove("hidden")

  const bounds = shell.getBoundingClientRect()
  const svgTarget = target instanceof SVGElement ? target : null
  const pointX = Number(svgTarget?.getAttribute("cx") || 0)
  const pointY = Number(svgTarget?.getAttribute("cy") || 0)
  const scaleX = bounds.width / width
  const scaleY = bounds.height / height
  tooltip.style.left = `${pointX * scaleX}px`
  tooltip.style.top = `${Math.max((pointY * scaleY) - 18, 12)}px`
 })
}

async function refreshActivationChart() {
 try {
  const queryValue = activationChartRange === "all" ? "all" : encodeURIComponent(activationChartRange)
  const response = await fetch(`/stats/activations-daily?days=${queryValue}`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "activation chart request failed")
  renderActivationChart(payload.points || [])
 } catch (error) {
  console.error("activation chart refresh error", error)
  renderActivationChart([])
 }
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

async function confirmAction(message, options = {}) {
 const confirmed = await showConfirm(message, options)
 if (!confirmed) {
  showToast(t("confirm_cancelled"), { tone: "info", duration: 2400 })
 }
 return confirmed
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
 const backdrop = document.getElementById("cockpitBackdrop")
 document.body.classList.toggle("cockpit-dense", Boolean(enabled))
 document.body.classList.toggle("cockpit-overlay-open", Boolean(enabled))
 const button = document.getElementById("cockpitModeBtn")
 if (button) {
  button.classList.toggle("is-active", Boolean(enabled))
  button.setAttribute("aria-pressed", enabled ? "true" : "false")
 }
 if (cockpit) cockpit.classList.toggle("hidden", !enabled)
 if (backdrop) backdrop.classList.toggle("hidden", !enabled)
 try {
  window.localStorage.setItem(COCKPIT_MODE_KEY, enabled ? "1" : "0")
 } catch (error) {
  console.debug("cockpit mode persistence skipped", error)
 }
}

function syncFocusMode() {
 const active = !document.getElementById("detailDrawer")?.classList.contains("hidden")
  || !document.getElementById("dayPulseDrawer")?.classList.contains("hidden")
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

function shortRowId(value) {
 const raw = String(value || "").trim()
 if (!raw) return "-"
 return raw.slice(0, 8)
}

function formatUluleOutcome(outcome) {
 const key = `ulule_outcome_${String(outcome || "").trim().toLowerCase()}`
 const translated = t(key)
 return translated === key ? String(outcome || "-") : translated
}

function formatUluleRewardName(value, fallbackRewardId = "-") {
 if (typeof value === "string") {
  const trimmed = value.trim()
  if (trimmed) return trimmed
 }

 if (value && typeof value === "object") {
  const directCandidates = [
   value.title_fr,
   value.title_en,
   value.title,
   value.name,
   value.label,
   value.fr,
   value.en
  ]

  for (const candidate of directCandidates) {
   if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim()
   }
  }

  const description = value.description || value.description_fr || value.description_en || null
  if (typeof description === "string" && description.trim()) {
   return description.trim()
  }
  if (description && typeof description === "object") {
   const localized = description.fr || description.en || Object.values(description).find((entry) => typeof entry === "string" && entry.trim())
   if (typeof localized === "string" && localized.trim()) {
    return localized.trim()
   }
  }
 }

 return `#${fallbackRewardId || "-"}`
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
 const buttonNode = document.getElementById(`cockpit${slot}ActionBtn`)
 if (valueNode) valueNode.innerText = String(value || 0)
 if (copyNode) copyNode.innerText = copy
 if (buttonNode) {
  buttonNode.dataset.filterStatus = tone === "good" ? "clean" : (slot === "Secondary" && tone === "pending" ? "todo" : (slot === "Tertiary" ? "all" : "todo"))
 }
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
 const confirmed = await confirmAction(t("confirm_branding_remove"))
 if (!confirmed) return

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
 const source = document.getElementById("source")?.value || "all"
 const brevoStatus = document.getElementById("brevoStatus").value
 const sort = document.getElementById("sort").value
 return { search, status, source, brevoStatus, sort }
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

function updateSelectionBar() {
 const bar = document.getElementById("selectionBar")
 const countNode = document.getElementById("selectionBarCount")
 if (!bar || !countNode) return
 const count = selectedIds.size
 bar.classList.toggle("hidden", count === 0)
 countNode.textContent = t("selection_bar_count", {
  count,
  plural: count > 1 ? "s" : ""
 })
}

async function refreshDayPulse() {
 const summaryNode = document.getElementById("dayPulseSummary")
 const listNode = document.getElementById("dayPulseList")
 if (!summaryNode || !listNode) return

 try {
  const response = await fetch("/stats/activity")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "activity request failed")

  const summary = payload.summary || {}
  summaryNode.innerHTML = `
   <div class="pulse-chip"><b>${Number(summary.imported || 0)}</b><span>${escapeHtml(t("day_pulse_imported"))}</span></div>
   <div class="pulse-chip"><b>${Number(summary.sent || 0)}</b><span>${escapeHtml(t("day_pulse_sent"))}</span></div>
   <div class="pulse-chip"><b>${Number(summary.activated || 0)}</b><span>${escapeHtml(t("day_pulse_activated"))}</span></div>
  `

  const events = Array.isArray(payload.events) ? payload.events : []
  if (!events.length) {
   listNode.innerHTML = `<div class="mini-empty">${escapeHtml(t("day_pulse_empty"))}</div>`
   return
  }

  listNode.innerHTML = events.map((event) => `
   <article class="pulse-item pulse-${escapeHtml(event.tone || "neutral")}">
    <div class="pulse-icon">${iconSvg(event.tone === "activated" ? "discord" : event.tone === "success" ? "spark" : "resend")}</div>
    <div class="pulse-copy">
     <strong>${escapeHtml(event.title || "-")}</strong>
     <p>${escapeHtml(event.copy || "-")}</p>
    </div>
    <time>${escapeHtml(formatDate(event.at))}</time>
   </article>
  `).join("")
 } catch (error) {
  console.error("day pulse refresh error", error)
  listNode.innerHTML = `<div class="mini-empty">${escapeHtml(t("day_pulse_empty"))}</div>`
 }
}

async function runSupportLookup({ open = false } = {}) {
 const input = document.getElementById("supportLookup")
 const hint = document.getElementById("supportHint")
 const preview = document.getElementById("supportPreview")
 const value = String(input?.value || "").trim().toLowerCase()

 if (!value) {
  supportMatch = null
  preview?.classList.add("hidden")
  if (hint) hint.textContent = t("support_idle")
  return
 }

 try {
  const params = new URLSearchParams({
   page: "1",
   limit: "1",
   search: value,
   status: "all",
   brevoStatus: "all",
   sort: "last_import_desc"
  })
  const response = await fetch(`/admin/api/list?${params.toString()}`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "support lookup failed")

  const row = Array.isArray(payload.data) ? payload.data[0] : null
  if (!row) {
   supportMatch = null
   preview?.classList.add("hidden")
   if (hint) hint.textContent = t("support_empty")
   return
  }

  supportMatch = row
  if (hint) hint.textContent = t("support_found", { email: row.email || value })
  if (preview) {
   preview.classList.remove("hidden")
   preview.innerHTML = [
    renderSmartBadge(row.used ? t("badge_active") : t("badge_unactivated"), {
     kind: row.used ? "good" : "pending",
     icon: row.discord_id ? "discord" : ""
    }),
    renderSmartBadge(formatBrevoStatus(row.brevo_status), {
     kind: ["soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam"].includes(String(row.brevo_status || "").toLowerCase())
      ? "warn"
      : (row.used ? "good" : "neutral")
    })
   ].join("")
  }

  if (open) {
   await openDetail(row.id)
   showToast(t("support_opened", { email: row.email || value }), { tone: "success" })
  }
 } catch (error) {
  console.error("support lookup error", error)
  showToast(t("alert_support_failed"), { tone: "error" })
 }
}

function applyQuickView(status, { revealList = true } = {}) {
 const statusNode = document.getElementById("status")
 const brevoNode = document.getElementById("brevoStatus")
 const searchNode = document.getElementById("search")
  if (statusNode) statusNode.value = status
 if (brevoNode) brevoNode.value = "all"
 if (searchNode) searchNode.value = ""
 page = 1
 loadList()
 if (revealList) {
  document.getElementById("listTitle")?.scrollIntoView({ behavior: "smooth", block: "start" })
 }
}

function updateSelectAllState() {
 const selectAll = document.getElementById("selectAll")
 if (!currentRowIds.length) {
  selectAll.checked = false
  updateSelectionBar()
  return
 }
 const selectedOnPage = currentRowIds.filter((id) => selectedIds.has(id)).length
 selectAll.checked = selectedOnPage === currentRowIds.length
 updateSelectionBar()
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

function renderUluleStatus(status = {}) {
 const statusNode = document.getElementById("ululeStatus")
 const metaNode = document.getElementById("ululeMeta")
 const syncButton = document.getElementById("ululeSyncBtn")
 if (!statusNode || !metaNode || !syncButton) return

 const scannedNode = document.getElementById("ululeSummaryScanned")
 const matchedNode = document.getElementById("ululeSummaryMatched")
 const insertedNode = document.getElementById("ululeSummaryInserted")
 const skippedNode = document.getElementById("ululeSummarySkipped")
 const sentNode = document.getElementById("ululeSummarySent")
 const failedNode = document.getElementById("ululeSummaryFailed")

 const schedulerMinutes = Number(status.schedulerIntervalMinutes || 30)
 const rewardCount = Array.isArray(status.eligibleRewardIds) ? status.eligibleRewardIds.length : 0
 const startDate = status.initialStartAt
  ? new Date(status.initialStartAt).toLocaleDateString("fr-FR")
  : "-"
 const windowHours = Number(status.inviteWindowHours || 24)

 metaNode.innerText = status.initialCatchupDone
  ? t("ulule_meta_live", {
   projectId: status.projectId || "-",
   windowHours,
   rewardCount
  })
  : t("ulule_meta_initial", {
   projectId: status.projectId || "-",
   startDate,
   rewardCount
  })

 if (scannedNode) scannedNode.innerText = String(status.scanned || 0)
 if (matchedNode) matchedNode.innerText = String(status.matched || 0)
 if (insertedNode) insertedNode.innerText = String(status.inserted || 0)
 if (skippedNode) skippedNode.innerText = String(status.skippedExisting || 0)
 if (sentNode) sentNode.innerText = String(status.sent || 0)
 if (failedNode) failedNode.innerText = String(status.failed || 0)

 syncButton.disabled = Boolean(status.running)

 if (status.running) {
  statusNode.innerText = t("ulule_status_running", {
   scanned: status.scanned || 0,
   matched: status.matched || 0,
   inserted: status.inserted || 0,
   skipped: status.skippedExisting || 0,
   sent: status.sent || 0,
   failed: status.failed || 0,
   currentEmail: status.currentEmail || "-"
  })
  return
 }

 if (status.lastError) {
  statusNode.innerText = t("ulule_status_failed", {
   error: status.lastError
  })
  return
 }

 if (status.lastFinishedAt) {
  statusNode.innerText = t("ulule_status_done", {
   scanned: status.scanned || 0,
   matched: status.matched || 0,
   inserted: status.inserted || 0,
   skipped: status.skippedExisting || 0,
   sent: status.sent || 0,
   failed: status.failed || 0
  })
  return
 }

 statusNode.innerText = t("ulule_status_idle", { minutes: schedulerMinutes })
}

function renderUluleImports(items = [], options = {}) {
 const {
  targetId = "ululeImportsList",
  emptyKey = "ulule_empty"
 } = options

 const listNode = document.getElementById(targetId)
 if (!listNode) return

 if (!Array.isArray(items) || !items.length) {
  listNode.innerHTML = `<div class="mini-empty">${escapeHtml(t(emptyKey))}</div>`
  return
 }

 listNode.innerHTML = items.map((item) => {
  const outcomeClass = String(item.outcome || "neutral").replace(/[^a-z0-9_]+/gi, "-")
  const orderId = escapeHtml(String(item.order_id || "-"))
  const rewardName = escapeHtml(formatUluleRewardName(item.reward_name, item.reward_id))
  const email = escapeHtml(item.email || "—")
  const seenAt = escapeHtml(formatDate(item.last_seen_at || item.created_at))
  const outcome = escapeHtml(formatUluleOutcome(item.outcome))
  const error = item.last_error ? `<p class="ulule-import-error">${escapeHtml(item.last_error)}</p>` : ""

  return `
   <article class="ulule-import-item">
    <div class="ulule-import-main">
     <div class="ulule-import-topline">
      <strong>${email}</strong>
      <span class="ulule-import-badge ulule-outcome-${outcomeClass}">${outcome}</span>
     </div>
     <p class="ulule-import-copy">${rewardName}</p>
     <div class="ulule-import-meta">
      <span>Commande ${orderId}</span>
      <span>${seenAt}</span>
     </div>
     ${error}
    </div>
   </article>
  `
 }).join("")
}

async function refreshUluleStatus() {
 try {
  const response = await fetch("/admin/api/ulule/status")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "ulule status request failed")
  renderUluleStatus(payload.status || {})
  return payload.status || {}
 } catch (error) {
  console.error("ulule status refresh error", error)
  const statusNode = document.getElementById("ululeStatus")
  if (statusNode) {
   statusNode.innerText = t("ulule_status_failed", { error: error.message || "server error" })
  }
  return null
 }
}

async function loadUluleImports() {
 try {
  const [importsResponse, refundsResponse] = await Promise.all([
   fetch("/admin/api/ulule/imports?limit=40"),
   fetch("/admin/api/ulule/imports?limit=20&refunded=1")
  ])
  const [importsPayload, refundsPayload] = await Promise.all([
   importsResponse.json(),
   refundsResponse.json()
  ])

  if (!importsResponse.ok) {
   throw new Error(importsPayload.error || "ulule imports request failed")
  }

  if (!refundsResponse.ok) {
   throw new Error(refundsPayload.error || "ulule refunds request failed")
  }

  renderUluleImports(importsPayload.items || [], {
   targetId: "ululeImportsList",
   emptyKey: "ulule_empty"
  })
  renderUluleImports(refundsPayload.items || [], {
   targetId: "ululeRefundsList",
   emptyKey: "ulule_refunds_empty"
  })

  return {
   imports: importsPayload.items || [],
   refunds: refundsPayload.items || []
  }
 } catch (error) {
  console.error("ulule imports load error", error)
  renderUluleImports([], {
   targetId: "ululeImportsList",
   emptyKey: "ulule_empty"
  })
  renderUluleImports([], {
   targetId: "ululeRefundsList",
   emptyKey: "ulule_refunds_empty"
  })
  return { imports: [], refunds: [] }
 }
}

function startUluleStatusPolling() {
 if (ululeSyncPollTimer) clearInterval(ululeSyncPollTimer)
 ululeSyncPollTimer = setInterval(async () => {
  const status = await refreshUluleStatus()
  if (!status?.running) {
   clearInterval(ululeSyncPollTimer)
   ululeSyncPollTimer = null
   await loadUluleImports()
  }
 }, 2500)
}

function stopUluleStatusPolling() {
 if (!ululeSyncPollTimer) return
 clearInterval(ululeSyncPollTimer)
 ululeSyncPollTimer = null
}

async function startUluleSync() {
 const confirmed = await confirmAction(t("confirm_ulule_sync"))
 if (!confirmed) return

 try {
  const response = await fetch("/admin/api/ulule/sync", { method: "POST" })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || t("alert_ulule_sync_failed"))

  if (payload.started === false) {
   showToast(t("ulule_status_running", {
    scanned: payload.state?.scanned || 0,
    matched: payload.state?.matched || 0,
    inserted: payload.state?.inserted || 0,
    skipped: payload.state?.skippedExisting || 0,
    sent: payload.state?.sent || 0,
    failed: payload.state?.failed || 0,
    currentEmail: payload.state?.currentEmail || "-"
   }), { tone: "info" })
   startUluleStatusPolling()
   return
  }

  showToast(t("alert_ulule_sync_started"), { tone: "success" })
  pushNotification(t("alert_ulule_sync_started"), { tone: "success" })
  startUluleStatusPolling()
  await refreshUluleStatus()
  await loadUluleImports()
 } catch (error) {
  console.error("ulule sync start error", error)
  showToast(error.message || t("alert_ulule_sync_failed"), { tone: "error" })
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
    renderNotificationCenter({ queueRunning: true, syncRunning: Boolean(brevoSyncPollTimer) })
    return status
   }
   queueStatus.innerText = t("queue_running")
   renderNotificationCenter({ queueRunning: true, syncRunning: Boolean(brevoSyncPollTimer) })
   return status
  }

  const sent = status.lastStats?.sent || 0
  const failed = status.lastStats?.failed || 0
  const processed = status.lastStats?.processed || 0
  queueStatus.innerText = t("queue_last_batch", { processed, sent, failed })
  renderNotificationCenter({ queueRunning: false, syncRunning: Boolean(brevoSyncPollTimer) })
  return status
 } catch (error) {
  document.getElementById("queueStatus").innerText = t("queue_unavailable")
  return null
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
  renderNotificationCenter({ queueRunning: false, syncRunning: true })
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
  renderNotificationCenter({ queueRunning: false, syncRunning: false })
  return
 }

 statusNode.innerText = t("brevo_sync_idle")
 renderNotificationCenter({ queueRunning: false, syncRunning: false })
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
   const importedAt = escapeHtml(formatDate(row.created_at))
   const importMeta = escapeHtml(t("row_import_meta", { date: importedAt, id: shortRowId(id) }))
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
   rowBadges.push(
    renderSmartBadge(row.import_source === "ulule" ? t("source_ulule") : t("source_manual"), {
     kind: row.import_source === "ulule" ? "pending" : "neutral"
    })
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
   const isUluleImport = row.import_source === "ulule"
   const supporterName = isUluleImport ? escapeHtml(String(row.ulule_supporter_name || "").trim()) : ""
   const ululeRewards = isUluleImport && Array.isArray(row.ulule_reward_names)
    ? row.ulule_reward_names
      .map((value) => formatUluleRewardName(value, ""))
      .filter(Boolean)
    : []
   const ululeRewardsMarkup = ululeRewards.length
    ? `<div class="ulule-reward-list">${ululeRewards.map((reward) => `<span class="ulule-reward-pill">${escapeHtml(reward)}</span>`).join("")}</div>`
    : ""
   const sentBadge = row.email_sent
    ? renderSmartBadge(t("badge_sent"), { kind: "good" })
    : renderSmartBadge(t("badge_unsent"), { kind: "neutral" })
   const activatedBadge = row.used
    ? renderSmartBadge(t("badge_active"), { kind: "good", icon: row.discord_id ? "discord" : "spark" })
    : renderSmartBadge(t("badge_unactivated"), { kind: "pending" })
   return `<tr>
    <td class="select-col"><input class="row-select" type="checkbox" data-id="${id}" ${checked}></td>
    <td class="email-cell" title="${email}">${supporterName ? `<div class="email-person-name">${supporterName}</div>` : ""}<div class="email-main">${email}</div><div class="email-submeta">${importMeta}</div><div class="row-badges">${rowBadges.join("")}</div>${ululeRewardsMarkup}</td>
    <td class="status-cell">${sentBadge}</td>
    <td class="status-cell">${activatedBadge}</td>
    <td class="datetime-cell">${sentAt}</td>
    <td class="datetime-cell">${usedAt}</td>
    <td class="status-pill-cell"><span class="brevo-badge brevo-${brevoStatusKey.replace(/[^a-z_]+/g, "-")}">${brevoStatus}</span></td>
    <td class="error-cell">${error}</td>
    <td class="actions-cell">
     <button class="icon-btn detail-btn" data-id="${id}" title="${escapeHtml(t("row_detail_title"))}" aria-label="${escapeHtml(t("row_detail_title"))}">${iconSvg("detail")}</button>
     <button class="icon-btn resend-btn" data-email="${email}" title="${escapeHtml(t("row_resend_title"))}" aria-label="${escapeHtml(t("row_resend_title"))}">${iconSvg("resend")}</button>
     <button class="icon-btn token-btn" data-id="${id}" data-email="${email}" title="${escapeHtml(t("row_regenerate_token_title"))}" aria-label="${escapeHtml(t("row_regenerate_token_title"))}">${iconSvg("token")}</button>
     <button class="icon-btn delete-btn" data-id="${id}" data-email="${email}" title="${escapeHtml(t("row_delete_title"))}" aria-label="${escapeHtml(t("row_delete_title"))}">${iconSvg("delete")}</button>
    </td>
   </tr>`
  })
  .join("")
}

async function loadList() {
 const { search, status, source, brevoStatus, sort } = getFilters()
 const params = new URLSearchParams({
  page: String(page),
  limit: String(limit),
  search,
  status,
  source,
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
 const confirmed = await confirmAction(t("confirm_import"))
 if (!confirmed) return
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
 if (payload.started === false) {
  alert(t("alert_import_nothing_new", { skipped: payload.skippedExisting || 0 }))
  await refreshAll()
  return
 }
 emailsInput.value = ""
 const importMessage = Number(payload.skippedExisting || 0) > 0
  ? t("alert_import_started_skipped", { total: payload.total || 0, skipped: payload.skippedExisting || 0 })
  : t("alert_import_started", { total: payload.total || 0 })
 alert(importMessage)
 pushNotification(importMessage, { tone: "success" })
 startImportPolling()
 page = 1
 await refreshAll()
}

async function sendEmails() {
 const confirmed = await confirmAction(t("confirm_send"))
 if (!confirmed) return

 const response = await fetch("/admin/api/send", { method: "POST" })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_send_failed"))
  return
 }
 const sendMessage = t("alert_send_started", { queued: payload.queued || 0 })
 alert(sendMessage)
 pushNotification(sendMessage, { tone: "success" })
 await refreshAll()
}

async function reconcileSentEmails() {
 const input = document.getElementById("reconcileEmails")
 const emails = input.value
 if (!emails.trim()) {
  alert(t("alert_reconcile_missing_input"))
  return
 }

 const confirmed = await confirmAction(t("confirm_reconcile"))
 if (!confirmed) return

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
 const confirmed = await confirmAction(t("confirm_brevo_sync"))
 if (!confirmed) return

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

 const syncMessage = t("alert_brevo_sync_started")
 alert(syncMessage)
 pushNotification(syncMessage, { tone: "info" })
 startBrevoSyncPolling()
 await refreshBrevoSyncStatus()
}

async function stopBrevoSync() {
 const confirmed = await confirmAction(t("confirm_brevo_sync_stop"))
 if (!confirmed) return

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
 const confirmed = await confirmAction(t("confirm_resend_row", { email }))
 if (!confirmed) return

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
 const resendMessage = t("alert_resend_ok", { email })
 alert(resendMessage)
 pushNotification(resendMessage, { tone: "success" })
 await refreshAll()
}

async function regenerateToken(id, email) {
 const confirmed = await confirmAction(t("confirm_regenerate_token", { email }))
 if (!confirmed) return

 const response = await fetch("/admin/api/regenerate-token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id })
 })
 const payload = await response.json()
 if (!response.ok) {
  alert(payload.error || t("alert_regenerate_token_failed"))
  return
 }

 const tokenMessage = t("alert_regenerate_token_ok", { email })
 alert(tokenMessage)
 pushNotification(tokenMessage, { tone: "success" })
 await refreshAll()
}

async function deleteRow(id, email) {
 const confirmed = await confirmAction(t("confirm_delete_row", { email }))
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
 const deleteMessage = t("alert_delete_ok", { email })
 alert(deleteMessage)
 pushNotification(deleteMessage, { tone: "success" })
 page = 1
 await refreshAll()
}

async function batchResend() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert(t("alert_select_none"))
  return
 }

 const confirmed = await confirmAction(t("confirm_batch_resend", { count: ids.length }))
 if (!confirmed) return

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

 const batchResendMessage = t("alert_batch_resend_ok", {
  processed: payload.processed || 0,
  sent: payload.sent || 0,
  failed: payload.failed || 0
 })
 alert(batchResendMessage)
 pushNotification(batchResendMessage, { tone: payload.failed ? "info" : "success" })
 await refreshAll()
}

async function resendFiltered() {
 const { search, status, brevoStatus } = getFilters()
 const labelParts = []
 if (status !== "all") labelParts.push(t("filter_label_status", { value: status }))
 if (brevoStatus !== "all") labelParts.push(t("filter_label_brevo", { value: brevoStatus }))
 if (search) labelParts.push(t("filter_label_search", { value: search }))
 const label = labelParts.length ? ` (${labelParts.join(", ")})` : ""

 const confirmed = await confirmAction(t("confirm_resend_filtered", { label }))
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

 const confirmed = await confirmAction(t("confirm_exclude_selected", {
  action: excluded ? t("action_excluded_selected") : t("action_included_selected"),
  count: ids.length
 }))
 if (!confirmed) return

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

 const excludeSelectedMessage = t("alert_exclude_ok", {
  updated: payload.updated || 0,
  action: excluded ? t("action_excluded_selected") : t("action_included_selected")
 })
 alert(excludeSelectedMessage)
 pushNotification(excludeSelectedMessage, { tone: "info" })
 await refreshAll()
}

async function setExcludedForFiltered(excluded) {
 const filters = getFilters()
 const confirmed = await confirmAction(t("confirm_exclude_filtered", {
  action: excluded ? t("action_excluded_filtered") : t("action_included_filtered")
 }))
 if (!confirmed) return

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

 const excludeFilteredMessage = t("alert_exclude_ok", {
  updated: payload.updated || 0,
  action: excluded ? t("action_excluded_filtered") : t("action_included_filtered")
 })
 alert(excludeFilteredMessage)
 pushNotification(excludeFilteredMessage, { tone: "info" })
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

function openDayPulseDrawer() {
 document.getElementById("dayPulseDrawer").classList.remove("hidden")
 syncFocusMode()
 refreshDayPulse().catch((error) => {
  console.error("day pulse drawer refresh error", error)
 })
}

function closeDayPulseDrawer() {
 document.getElementById("dayPulseDrawer").classList.add("hidden")
 syncFocusMode()
}

function hasUnsavedCopyChanges() {
 if (!copyEditorDirty) return false
 const currentValues = Object.fromEntries(
  Array.from(document.querySelectorAll("[data-copy-key]")).map((textarea) => [
   textarea.getAttribute("data-copy-key"),
   textarea.value
  ])
 )
 return copyEntries.some((entry) => String(currentValues[entry.key] ?? entry.value) !== String(entry.value ?? ""))
}

async function closeCopyDrawer({ force = false } = {}) {
 if (!force && hasUnsavedCopyChanges()) {
  const shouldSave = await showConfirm(t("confirm_copy_unsaved"), {
   confirmLabel: t("confirm_ok"),
   cancelLabel: t("confirm_cancel")
  })
  if (shouldSave) {
   const saved = await saveCopyEditor({ confirmFirst: false })
   if (!saved) return
  }
 }
 document.getElementById("copyDrawer").classList.add("hidden")
 copyEditorDirty = false
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

function getCopyEntryGroup(entry) {
 if (String(entry?.key || "").startsWith("landing_")) return "landing"
 return "dashboard"
}

function sortCopyEntries(entries) {
 return [...entries].sort((left, right) => {
  const leftGroup = COPY_ENTRY_GROUPS[getCopyEntryGroup(left)]?.order ?? 99
  const rightGroup = COPY_ENTRY_GROUPS[getCopyEntryGroup(right)]?.order ?? 99
  if (leftGroup !== rightGroup) return leftGroup - rightGroup
  return String(left.label || left.key || "").localeCompare(String(right.label || right.key || ""), "fr", { sensitivity: "base" })
 })
}

function renderCopyEditorEntries() {
 const container = document.getElementById("copyEditorList")
 const search = document.getElementById("copySearch").value.trim().toLowerCase()
 const entries = sortCopyEntries(copyEntries).filter((entry) => {
  if (!search) return true
  return entry.label.toLowerCase().includes(search) || entry.key.toLowerCase().includes(search) || entry.value.toLowerCase().includes(search)
 })

 if (!entries.length) {
  container.innerHTML = '<p class="panel-copy">Aucun texte ne correspond à ta recherche.</p>'
  return
 }

 const groupedEntries = entries.reduce((groups, entry) => {
  const groupKey = getCopyEntryGroup(entry)
  if (!groups[groupKey]) groups[groupKey] = []
  groups[groupKey].push(entry)
  return groups
 }, {})

 container.innerHTML = Object.entries(groupedEntries).map(([groupKey, groupEntries]) => `
  <section class="copy-editor-section">
   <div class="copy-editor-section-head">
    <p>${escapeHtml(COPY_ENTRY_GROUPS[groupKey]?.label || "Autres textes")}</p>
    <span>${groupEntries.length}</span>
   </div>
   <div class="copy-editor-section-list">
    ${groupEntries.map((entry) => `
     <div class="copy-editor-row">
      <label for="copy-${escapeHtml(entry.key)}">
       <span>${escapeHtml(entry.label)}</span>
       <code>${escapeHtml(entry.key)}</code>
      </label>
      <textarea id="copy-${escapeHtml(entry.key)}" data-copy-key="${escapeHtml(entry.key)}">${escapeHtml(entry.value)}</textarea>
    </div>
    `).join("")}
   </div>
  </section>
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
  copyEditorDirty = false
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
 copyEditorDirty = false
 renderCopyEditorEntries()
 copyEditorLoaded = true
}

async function saveCopyEditor({ confirmFirst = true } = {}) {
 if (confirmFirst) {
  const confirmed = await confirmAction(t("confirm_copy_save"))
  if (!confirmed) return false
 }

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
  return false
 }

 window.DASHBOARD_COPY = { ...(window.DASHBOARD_COPY || {}), ...entries }
 if (typeof window.applyDashboardCopy === "function") {
  window.applyDashboardCopy()
 }
 await refreshStats()
 copyEntries = sortCopyEntries(Object.entries(entries).map(([key, value]) => ({
  key,
  label: key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
  value: String(value ?? "")
 })))
 copyEditorDirty = false
 renderCopyEditorEntries()
 syncCollapseButtons()
 const copySavedMessage = t("alert_copy_saved")
 alert(copySavedMessage)
 pushNotification(copySavedMessage, { tone: "success" })
 return true
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
 return `<div class="timeline-item ${tone}"><div class="timeline-dot">${iconSvg(icon)}</div><div class="timeline-content"><b>${label}</b><p>${value}</p><span>${at}</span></div><div class="timeline-tail"></div></div>`
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
 const detailSummaryValue = document.getElementById("detailSummaryValue")
 const detailSummaryText = document.getElementById("detailSummaryText")
 const detailSummaryActionBtn = document.getElementById("detailSummaryActionBtn")
 const brevoIssue = ["soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam"].includes(String(row.brevo_status || "").toLowerCase())
 if (row.used) {
  detailSummaryValue.textContent = t("detail_summary_active")
  detailSummaryText.textContent = t("detail_summary_text_active")
  detailSummaryActionBtn.textContent = t("detail_summary_action_active")
  detailSummaryActionBtn.dataset.action = "close"
 } else if (brevoIssue) {
  detailSummaryValue.textContent = t("detail_summary_issue")
  detailSummaryText.textContent = t("detail_summary_text_issue")
  detailSummaryActionBtn.textContent = t("detail_summary_action_issue")
  detailSummaryActionBtn.dataset.action = "history"
 } else {
  detailSummaryValue.textContent = t("detail_summary_waiting")
  detailSummaryText.textContent = t("detail_summary_text_waiting")
  detailSummaryActionBtn.textContent = t("detail_summary_action_waiting")
  detailSummaryActionBtn.dataset.action = "resend"
 }
 document.getElementById("detailDrawer").classList.remove("hidden")
 syncFocusMode()
}

async function saveDetailNote() {
 if (!currentDetailId) return
 const confirmed = await confirmAction(t("confirm_note_save"))
 if (!confirmed) return
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

 const noteMessage = t("alert_note_ok")
 alert(noteMessage)
 pushNotification(noteMessage, { tone: "success" })
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

async function regenerateDetailToken() {
 if (!currentDetailId || !currentDetailEmail) return
 await regenerateToken(currentDetailId, currentDetailEmail)
 if (currentDetailId) {
  await openDetail(currentDetailId)
 }
}

function handleDetailSummaryAction() {
 const button = document.getElementById("detailSummaryActionBtn")
 const action = button?.dataset.action || "close"
 if (action === "close") {
  closeDetailDrawer()
  return
 }
 if (action === "history") {
  document.getElementById("detailHistoryTitle")?.scrollIntoView({ behavior: "smooth", block: "start" })
  return
 }
 resendDetailEmail()
}

async function batchDelete() {
 const ids = Array.from(selectedIds)
 if (!ids.length) {
  alert(t("alert_select_none_saw"))
  return
 }

 const confirmed = await confirmAction(t("confirm_delete_rows", { count: ids.length }))
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
 const batchDeleteMessage = t("alert_batch_delete_ok", { deleted: payload.deleted || 0 })
 alert(batchDeleteMessage)
 pushNotification(batchDeleteMessage, { tone: "success" })
 page = 1
 await refreshAll()
}

async function refreshAll() {
 const [importStatus, queueStatus, ululeStatus] = await Promise.all([
  refreshImportStatus(),
  refreshStats(),
  refreshActivationChart(),
  refreshBranding(),
  loadList(),
  refreshQueueStatus(),
  refreshDayPulse(),
  refreshUluleStatus(),
  loadUluleImports()
 ])

 renderNotificationCenter({
  queueRunning: Boolean(queueStatus?.running),
  syncRunning: false
 })

 if (importStatus?.running) {
  if (!importPollTimer) startImportPolling()
 } else {
  stopImportPolling()
 }

 if (ululeStatus?.running) {
  if (!ululeSyncPollTimer) startUluleStatusPolling()
 } else {
  stopUluleStatusPolling()
 }
 syncCollapseButtons()
}

document.getElementById("importBtn").addEventListener("click", importEmails)
document.getElementById("sendBtn").addEventListener("click", sendEmails)
document.getElementById("ululeSyncBtn")?.addEventListener("click", startUluleSync)
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
document.getElementById("dayPulseOpenBtn").addEventListener("click", openDayPulseDrawer)
document.getElementById("dayPulseCloseBtn").addEventListener("click", closeDayPulseDrawer)
document.getElementById("detailSummaryActionBtn").addEventListener("click", handleDetailSummaryAction)
document.getElementById("detailResendBtn").addEventListener("click", resendDetailEmail)
document.getElementById("detailRegenerateTokenBtn").addEventListener("click", regenerateDetailToken)
document.getElementById("saveNoteBtn").addEventListener("click", saveDetailNote)
document.getElementById("copyCloseBtn").addEventListener("click", closeCopyDrawer)
document.getElementById("copyCloseMobileBtn").addEventListener("click", closeCopyDrawer)
document.getElementById("brandingOpenBtn").addEventListener("click", openBrandingDrawer)
document.getElementById("brandingCloseBtn").addEventListener("click", closeBrandingDrawer)
document.getElementById("copyFromBrandingBtn").addEventListener("click", openCopyDrawer)
document.getElementById("saveCopyBtn").addEventListener("click", saveCopyEditor)
document.getElementById("copyEditorList").addEventListener("input", (event) => {
 if (event.target.matches("[data-copy-key]")) {
  copyEditorDirty = true
 }
})
document.getElementById("brandingRemoveBtn").addEventListener("click", removeBrandingLogo)
document.getElementById("brandingSizeRange").addEventListener("input", (event) => {
 document.getElementById("brandingSizeValue").innerText = `${event.target.value} px`
 document.getElementById("brandLogo").style.width = `${event.target.value}px`
 document.getElementById("brandLogo").style.height = "auto"
})
document.getElementById("brandingSizeRange").addEventListener("change", saveBrandingSize)
document.getElementById("copySearch").addEventListener("input", renderCopyEditorEntries)
document.getElementById("activationChartRangeTabs")?.addEventListener("click", async (event) => {
 const button = event.target.closest("[data-range]")
 if (!button) return
 activationChartRange = button.getAttribute("data-range") || "14"
 for (const node of event.currentTarget.querySelectorAll("[data-range]")) {
  node.classList.toggle("is-active", node === button)
 }
 await refreshActivationChart()
})
document.getElementById("supportSearchBtn")?.addEventListener("click", () => runSupportLookup({ open: false }))
document.getElementById("supportOpenBtn")?.addEventListener("click", () => runSupportLookup({ open: true }))
document.getElementById("supportLookup")?.addEventListener("keydown", (event) => {
 if (event.key === "Enter") {
  event.preventDefault()
  runSupportLookup({ open: true })
 }
})
document.getElementById("confirmModalCancel").addEventListener("click", () => closeConfirm(false))
document.getElementById("confirmModalOk").addEventListener("click", () => closeConfirm(true))
document.getElementById("confirmModalCloseBtn").addEventListener("click", () => closeConfirm(false))
document.getElementById("confirmModal").addEventListener("click", (event) => {
 if (event.target.id === "confirmModal") closeConfirm(false)
})
document.getElementById("detailDrawer").addEventListener("click", (event) => {
 if (event.target.id === "detailDrawer") closeDetailDrawer()
})
document.getElementById("dayPulseDrawer").addEventListener("click", (event) => {
 if (event.target.id === "dayPulseDrawer") closeDayPulseDrawer()
})
document.getElementById("brandingDrawer").addEventListener("click", (event) => {
 if (event.target.id === "brandingDrawer") closeBrandingDrawer()
})
document.getElementById("copyDrawer").addEventListener("click", async (event) => {
 if (event.target.id === "copyDrawer") await closeCopyDrawer()
})
for (const button of document.querySelectorAll("[data-close-sheet]")) {
 button.addEventListener("click", async (event) => {
  const target = event.currentTarget.getAttribute("data-close-sheet")
  if (target === "detailDrawer") closeDetailDrawer()
  if (target === "brandingDrawer") closeBrandingDrawer()
  if (target === "dayPulseDrawer") closeDayPulseDrawer()
 })
}
document.getElementById("focusScrim")?.addEventListener("click", () => {
 closeDetailDrawer()
 closeCopyDrawer()
 closeBrandingDrawer()
 closeConfirm(false)
})
document.getElementById("cockpitBackdrop")?.addEventListener("click", () => {
 setCockpitMode(false)
})
document.getElementById("selectionBarResendBtn").addEventListener("click", batchResend)
document.getElementById("selectionBarExcludeBtn").addEventListener("click", async () => setExcludedForSelected(true))
document.getElementById("selectionBarIncludeBtn").addEventListener("click", async () => setExcludedForSelected(false))
document.getElementById("selectionBarDeleteBtn").addEventListener("click", batchDelete)
for (const button of document.querySelectorAll(".mission-action-btn")) {
 button.addEventListener("click", () => applyQuickView(button.dataset.filterStatus || "all"))
}
document.addEventListener("keydown", (event) => {
 if (event.key === "Escape" && !document.getElementById("confirmModal").classList.contains("hidden")) {
  closeConfirm(false)
   return
 }
 if (event.key === "Escape" && !document.getElementById("copyDrawer").classList.contains("hidden")) {
  closeCopyDrawer()
   return
 }
 if (event.key === "Escape" && !document.getElementById("detailDrawer").classList.contains("hidden")) {
  closeDetailDrawer()
   return
 }
 if (event.key === "Escape" && !document.getElementById("dayPulseDrawer").classList.contains("hidden")) {
  closeDayPulseDrawer()
   return
 }
 if (event.key === "Escape" && !document.getElementById("brandingDrawer").classList.contains("hidden")) {
  closeBrandingDrawer()
  }
})
for (const button of document.querySelectorAll(".collapse-toggle")) {
 button.addEventListener("click", () => toggleCollapsible(button.dataset.target, button))
}
document.getElementById("status").addEventListener("change", async () => {
 page = 1
 await loadList()
})
document.getElementById("source").addEventListener("change", async () => {
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

  const tokenButton = event.target.closest(".token-btn")
  if (tokenButton) {
   const id = tokenButton.getAttribute("data-id")
   const email = tokenButton.getAttribute("data-email")
   if (!id || !email) return
   await regenerateToken(id, email)
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
renderNotificationCenter()
setCockpitMode(window.localStorage.getItem(COCKPIT_MODE_KEY) === "1")
loadLatestDashboardCopy()
 .then(() => refreshAll())
 .catch((error) => {
  console.error("dashboard init error", error)
 })
