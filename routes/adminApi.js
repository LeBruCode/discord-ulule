import express from "express"
import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import vm from "vm"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router = express.Router()
const UUID_V4_OR_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dashboardCopyFilePath = path.join(__dirname, "..", "public", "js", "dashboardCopy.js")

const rateLimitStore = new Map()
const importQueueState = {
 running: false,
 total: 0,
 processed: 0,
 inserted: 0,
 failed: 0,
 currentEmail: null,
 lastError: null,
 lastStartedAt: null,
 lastFinishedAt: null
}
const sendQueueState = {
 running: false,
 lastStartedAt: null,
 lastFinishedAt: null,
 lastStats: { processed: 0, sent: 0, failed: 0 }
}
const BREVO_MAX_RETRIES = 4
const BREVO_BASE_DELAY_MS = 800
const BREVO_INTER_SEND_DELAY_MS = 400
const IMPORT_CHUNK_SIZE = 250
const BREVO_FAILED_STATUSES = ["error", "soft_bounce", "hard_bounce", "blocked", "invalid", "deferred", "spam"]
const BREVO_STATUSES = ["queued", "request", "sent", "delivered", "opened", "unique_opened", "click", "unique_clicked", "soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam"]

function token() {
 return crypto.randomBytes(32).toString("hex")
}

function errorMessage(error) {
 return error?.message || "unknown error"
}

function humanizeCopyKey(key) {
 return String(key || "")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function readDashboardCopyObject() {
 const source = await fs.readFile(dashboardCopyFilePath, "utf8")
 const context = { window: {} }
 vm.createContext(context)
 vm.runInContext(source, context)
 return context.window?.DASHBOARD_COPY || {}
}

function serializeDashboardCopyObject(copy) {
 return `window.DASHBOARD_COPY = ${JSON.stringify(copy, null, 2)}

window.dashboardT = function dashboardT(key, vars = {}) {
 const template = window.DASHBOARD_COPY[key] ?? key
 return String(template).replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(vars[name] ?? ""))
}

window.applyDashboardCopy = function applyDashboardCopy() {
 const t = window.dashboardT
 document.title = t("title")
 const textMap = [
  ["[data-copy='eyebrow']", "eyebrow"],
  ["[data-copy='title']", "title"],
  ["#logoutBtn", "logout"],
  ["#statsTotalLabel", "stats_total"],
  ["#statsSentLabel", "stats_sent"],
  ["#statsActivatedLabel", "stats_activated"],
  ["#statsRateLabel", "stats_rate"],
  ["#brevoTitle", "brevo_title"],
  ["#brevoStatLabel-none", "brevo_none"],
  ["#brevoStatLabel-request", "brevo_request"],
  ["#brevoStatLabel-queued", "brevo_queued"],
  ["#brevoStatLabel-sent", "brevo_sent"],
  ["#brevoStatLabel-delivered", "brevo_delivered"],
  ["#brevoStatLabel-soft_bounce", "brevo_soft_bounce"],
  ["#brevoStatLabel-hard_bounce", "brevo_hard_bounce"],
  ["#brevoStatLabel-blocked", "brevo_blocked"],
  ["#importTitle", "import_title"],
  ["#importStatus", "import_idle"],
  ["#reconcileTitle", "reconcile_title"],
  ["#reconcileCopy", "reconcile_copy"],
  ["#reconcileStatus", "reconcile_idle"],
  ["#actionsTitle", "actions_title"],
  ["#importBtn", "import_btn"],
  ["#sendBtn", "send_btn"],
  ["#reconcileBtn", "reconcile_btn"],
  ["#batchResendBtn", "batch_resend_btn"],
  ["#filterResendBtn", "resend_filter_btn"],
  ["#selectFilteredBtn", "select_filter_btn"],
  ["#excludeSelectedBtn", "exclude_selected_btn"],
  ["#includeSelectedBtn", "include_selected_btn"],
  ["#excludeFilteredBtn", "exclude_filter_btn"],
  ["#includeFilteredBtn", "include_filter_btn"],
  ["#exportBtn", "export_btn"],
  ["#batchDeleteBtn", "delete_selected_btn"],
  ["#statusAllOption", "status_all"],
  ["#statusSentOption", "status_sent"],
  ["#statusUnsentOption", "status_unsent"],
  ["#statusActivatedOption", "status_activated"],
  ["#brevoFilterAllOption", "brevo_filter_all"],
  ["#brevoQueuedOption", "brevo_filter_queued"],
  ["#brevoRequestOption", "brevo_filter_request"],
  ["#brevoSentOption", "brevo_filter_sent"],
  ["#brevoDeliveredOption", "brevo_filter_delivered"],
  ["#brevoSoftBounceOption", "brevo_filter_soft_bounce"],
  ["#brevoHardBounceOption", "brevo_filter_hard_bounce"],
  ["#brevoBlockedOption", "brevo_filter_blocked"],
  ["#brevoErrorOption", "brevo_filter_error"],
  ["#brevoDeferredOption", "brevo_filter_deferred"],
  ["#brevoInvalidOption", "brevo_filter_invalid"],
  ["#brevoSpamOption", "brevo_filter_spam"],
  ["#sortRecentOption", "sort_recent"],
  ["#sortOldestOption", "sort_oldest"],
  ["#sortEmailAscOption", "sort_email_asc"],
  ["#sortEmailDescOption", "sort_email_desc"],
  ["#perPage25Option", "per_page_25"],
  ["#perPage50Option", "per_page_50"],
  ["#perPage100Option", "per_page_100"],
  ["#perPage200Option", "per_page_200"],
  ["#queueStatus", "queue_idle"],
  ["#listTitle", "list_title"],
  ["#thEmail", "table_email"],
  ["#thSent", "table_sent"],
  ["#thActivated", "table_activated"],
  ["#thSentAt", "table_sent_at"],
  ["#thUsedAt", "table_used_at"],
  ["#thBrevo", "table_brevo"],
  ["#thError", "table_error"],
  ["#thAction", "table_action"],
  ["#prevBtn", "pagination_prev"],
  ["#nextBtn", "pagination_next"],
  ["[data-copy='detailEyebrow']", "detail_eyebrow"],
  ["#detailCloseBtn", "detail_close"],
  ["#detailHistoryTitle", "detail_history"],
  ["#detailNoteTitle", "detail_note"],
  ["#saveNoteBtn", "detail_note_save"]
 ]

 for (const [selector, key] of textMap) {
  const node = document.querySelector(selector)
  if (node) node.textContent = t(key)
 }

 const placeholders = [
  ["#emails", "import_placeholder"],
  ["#reconcileEmails", "reconcile_placeholder"],
  ["#search", "search_placeholder"],
  ["#detailNote", "detail_note_placeholder"]
 ]
 for (const [selector, key] of placeholders) {
  const node = document.querySelector(selector)
  if (node) node.setAttribute("placeholder", t(key))
 }
}
`
}

function createRateLimiter({ windowMs, max, keyPrefix }) {
 return (req, res, next) => {
  const identity = req.sessionID || req.ip || "anonymous"
  const key = `${keyPrefix}:${identity}`
  const now = Date.now()

  const current = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs }
  if (now > current.resetAt) {
   current.count = 0
   current.resetAt = now + windowMs
  }

  if (current.count >= max) {
   return res.status(429).json({ error: "too many requests" })
  }

  current.count += 1
  rateLimitStore.set(key, current)
  return next()
 }
}

const limitImport = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: "import" })
const limitSend = createRateLimiter({ windowMs: 60 * 1000, max: 5, keyPrefix: "send" })
const limitResend = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyPrefix: "resend" })
const limitDelete = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyPrefix: "delete" })
const limitList = createRateLimiter({ windowMs: 60 * 1000, max: 180, keyPrefix: "list" })
const limitReconcile = createRateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: "reconcile" })

function sleep(ms) {
 return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableMailError(error) {
 const msg = String(errorMessage(error)).toLowerCase()
 return msg.includes("(429)") || msg.includes("(500)") || msg.includes("(502)") || msg.includes("(503)") || msg.includes("(504)") || msg.includes("timeout") || msg.includes("network")
}

async function sendMailWithRetry(email, accessToken, accessTokenId) {
 let lastError = null
 for (let attempt = 0; attempt <= BREVO_MAX_RETRIES; attempt += 1) {
  try {
   return await sendMail(email, accessToken, { accessTokenId })
  } catch (error) {
   lastError = error
   if (!isRetryableMailError(error) || attempt === BREVO_MAX_RETRIES) break
   const jitter = Math.floor(Math.random() * 250)
   const waitMs = BREVO_BASE_DELAY_MS * (2 ** attempt) + jitter
   await sleep(waitMs)
  }
 }
 throw lastError || new Error("mail send failed")
}

async function sendOneAccessToken(row) {
 try {
  const sendResponse = await sendMailWithRetry(row.email, row.token, row.id)
  const messageId = String(sendResponse?.messageId || sendResponse?.message_id || "").trim() || null

  const { error: updateError } = await supabase
   .from("access_tokens")
   .update({
    email_sent: false,
    email_sent_at: null,
    brevo_message_id: messageId,
    brevo_status: "queued",
    brevo_event_at: new Date().toISOString(),
    email_error: null
   })
   .eq("id", row.id)

  if (updateError) {
   console.error("send update error", row.email, updateError)
   return { sent: 0, failed: 1 }
  }

  return { sent: 1, failed: 0 }
 } catch (error) {
  console.error("mail error", row.email, error)
  await supabase
   .from("access_tokens")
   .update({ email_error: errorMessage(error) })
   .eq("id", row.id)
  return { sent: 0, failed: 1 }
 }
}

async function processSendQueue() {
 if (sendQueueState.running) return

 sendQueueState.running = true
 sendQueueState.lastStartedAt = new Date().toISOString()
 const stats = { processed: 0, sent: 0, failed: 0 }

 try {
  while (true) {
   const { data, error } = await supabase
    .from("access_tokens")
    .select("id,email,token,email_sent,brevo_status,resend_excluded")
    .or([
     "email_sent.eq.false",
     "email_sent.is.null",
     BREVO_FAILED_STATUSES.map((status) => `brevo_status.eq.${status}`).join(",")
    ].join(","))
    .order("created_at", { ascending: true })
    .limit(100)

   if (error) {
    console.error("send queue fetch error", error)
    break
   }

   const rows = applySendEligibility(data)
   if (!rows.length) break

   for (const row of rows) {
    const result = await sendOneAccessToken(row)
    stats.processed += 1
    stats.sent += result.sent
    stats.failed += result.failed
    await sleep(BREVO_INTER_SEND_DELAY_MS)
   }
  }
 } finally {
  sendQueueState.running = false
  sendQueueState.lastFinishedAt = new Date().toISOString()
  sendQueueState.lastStats = stats
 }
}

function normalizeIdList(ids) {
 if (!Array.isArray(ids)) return []
 return ids
  .map((id) => String(id || "").trim())
  .filter((id) => UUID_V4_OR_V7_REGEX.test(id))
}

function normalizeEmailList(rawValue) {
 if (typeof rawValue !== "string") return []
 return [...new Set(
  rawValue
   .split(/[\s,;]+/)
   .map((email) => email.trim().toLowerCase())
   .filter(Boolean)
 )]
}

function normalizeListFilters(input = {}) {
 return {
  search: typeof input.search === "string" ? input.search.trim() : "",
  status: typeof input.status === "string" ? input.status : "all",
  brevoStatus: typeof input.brevoStatus === "string" ? input.brevoStatus.trim().toLowerCase() : "all"
 }
}

function applyListFilters(query, { search = "", status = "all", brevoStatus = "all" }) {
 if (search) query = query.ilike("email", `%${search}%`)
 if (status === "sent") query = query.eq("email_sent", true)
 if (status === "unsent") query = query.or("email_sent.eq.false,email_sent.is.null")
  if (status === "activated") query = query.eq("used", true)
 if (brevoStatus && brevoStatus !== "all") query = query.eq("brevo_status", brevoStatus)
 return query
}

function applySendEligibility(rows) {
 return (Array.isArray(rows) ? rows : []).filter((row) => {
  if (row.resend_excluded === true) return false
  if (row.email_sent === true) return false
  if (!row.brevo_status) return true
  return BREVO_FAILED_STATUSES.includes(row.brevo_status)
 })
}

async function fetchFilteredRows(filters, { select = "*", limit = 1000, orderAscending = true } = {}) {
 let query = supabase
  .from("access_tokens")
  .select(select)

 query = applyListFilters(query, filters)
 query = query.order("created_at", { ascending: orderAscending }).limit(limit)

 const result = await query
 return result
}

function buildTimeline(row) {
 const events = [
  { key: "imported", label: "Importé", at: row.created_at, value: row.email },
  { key: "brevo", label: "Brevo", at: row.brevo_event_at || row.email_sent_at, value: row.brevo_status || (row.email_sent ? "delivered" : null) },
  { key: "activated", label: "Activé", at: row.used_at, value: row.used ? "oui" : null }
 ]

 if (row.discord_id) {
  events.push({ key: "discord", label: "Discord", at: row.used_at, value: row.discord_id })
 }

 if (row.email_error) {
  events.push({ key: "mail_error", label: "Erreur mail", at: row.brevo_event_at || row.email_sent_at || row.created_at, value: row.email_error })
 }

 if (row.admin_note) {
  events.push({ key: "admin_note", label: "Note admin", at: row.admin_note_updated_at || row.created_at, value: row.admin_note })
 }

 return events.filter((event) => event.at || event.value)
}

async function processImportQueue(emails) {
 if (importQueueState.running) return

 importQueueState.running = true
 importQueueState.total = emails.length
 importQueueState.processed = 0
 importQueueState.inserted = 0
 importQueueState.failed = 0
 importQueueState.currentEmail = null
 importQueueState.lastError = null
 importQueueState.lastStartedAt = new Date().toISOString()
 importQueueState.lastFinishedAt = null

 try {
  for (let i = 0; i < emails.length; i += IMPORT_CHUNK_SIZE) {
   const chunk = emails.slice(i, i + IMPORT_CHUNK_SIZE)
   const payload = chunk.map((email) => ({
    email,
    token: token(),
    used: false,
    email_sent: false
   }))

   importQueueState.currentEmail = chunk[chunk.length - 1] || null
   const { error } = await supabase.from("access_tokens").insert(payload)

   if (!error) {
    importQueueState.processed += chunk.length
    importQueueState.inserted += chunk.length
    continue
   }

   // If a bulk insert fails, fall back to row-by-row for this chunk to keep progress accurate.
   console.error("import chunk error, fallback row-by-row", error)
   importQueueState.lastError = errorMessage(error)
   for (const email of chunk) {
    importQueueState.currentEmail = email
    const { error: rowError } = await supabase.from("access_tokens").insert({
     email,
     token: token(),
     used: false,
     email_sent: false
    })

    importQueueState.processed += 1
    if (rowError) {
     console.error("import row error", email, rowError)
     importQueueState.failed += 1
     importQueueState.lastError = errorMessage(rowError)
    } else {
     importQueueState.inserted += 1
    }
   }
  }
 } finally {
  importQueueState.running = false
  importQueueState.currentEmail = null
  importQueueState.lastFinishedAt = new Date().toISOString()
 }
}

router.post("/import", limitImport, async (req, res) => {
 try {
  if (importQueueState.running) {
   return res.status(409).json({
    error: "import already running",
    status: importQueueState
   })
  }

  const rawEmails = req.body?.emails
  if (typeof rawEmails !== "string") {
   return res.status(400).json({ error: "emails is required" })
  }

  const emails = rawEmails
   .split("\n")
   .map((e) => e.trim().toLowerCase())
   .filter((e) => e)
  const uniqueEmails = [...new Set(emails)]
  if (!uniqueEmails.length) {
   return res.status(400).json({ error: "no email to import" })
  }

  processImportQueue(uniqueEmails).catch((queueError) => {
   console.error("import queue crash", queueError)
   importQueueState.lastError = errorMessage(queueError)
   importQueueState.running = false
   importQueueState.currentEmail = null
   importQueueState.lastFinishedAt = new Date().toISOString()
  })

  return res.status(202).json({
   started: true,
   total: uniqueEmails.length
  })
 } catch (error) {
  console.error("import route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/import-status", async (req, res) => {
 const progress = importQueueState.total
  ? Math.round((importQueueState.processed / importQueueState.total) * 100)
  : 0
 return res.json({
  ...importQueueState,
  progress
 })
})

router.post("/send", limitSend, async (req, res) => {
 try {
  const { data, error } = await supabase
   .from("access_tokens")
   .select("id,email_sent,brevo_status,resend_excluded")
   .or([
    "email_sent.eq.false",
    "email_sent.is.null",
    BREVO_FAILED_STATUSES.map((status) => `brevo_status.eq.${status}`).join(",")
   ].join(","))
   .limit(5000)

  if (error) {
   console.error("send count error", error)
   return res.status(500).json({ error: "server error" })
  }

  const eligibleRows = applySendEligibility(data)

  if (!sendQueueState.running) {
   processSendQueue().catch((queueError) => {
    console.error("send queue crash", queueError)
    sendQueueState.running = false
   })
  }

  return res.json({
   queued: eligibleRows.length,
   running: sendQueueState.running,
   lastStats: sendQueueState.lastStats
  })
 } catch (error) {
  console.error("send route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/send-status", async (req, res) => {
 return res.json({
  running: sendQueueState.running,
  lastStartedAt: sendQueueState.lastStartedAt,
  lastFinishedAt: sendQueueState.lastFinishedAt,
  lastStats: sendQueueState.lastStats
 })
})

router.post("/reconcile-sent", limitReconcile, async (req, res) => {
 try {
  const emails = normalizeEmailList(req.body?.emails)
  if (!emails.length) {
   return res.status(400).json({ error: "emails is required" })
  }

  const matchedEmailSet = new Set()
  let updatedRows = 0
  const chunkSize = 200

  for (let index = 0; index < emails.length; index += chunkSize) {
   const chunk = emails.slice(index, index + chunkSize)
   const { data, error } = await supabase
    .from("access_tokens")
    .select("id,email,email_sent")
    .in("email", chunk)

   if (error) {
    console.error("reconcile fetch error", error)
    return res.status(500).json({ error: "server error", details: errorMessage(error) })
   }

   const rows = Array.isArray(data) ? data : []
   const matchedEmails = [...new Set(rows.map((row) => String(row.email || "").toLowerCase()).filter(Boolean))]
   matchedEmails.forEach((email) => matchedEmailSet.add(email))

   const idsToUpdate = rows
    .filter((row) => row.email_sent !== true)
    .map((row) => String(row.id || "").trim())
    .filter((id) => UUID_V4_OR_V7_REGEX.test(id))

   if (!idsToUpdate.length) continue

   const { data: updatedData, error: updateError } = await supabase
    .from("access_tokens")
    .update({
     email_sent: true,
     email_sent_at: new Date().toISOString(),
     brevo_status: "delivered",
     brevo_event_at: new Date().toISOString(),
     email_error: null
    })
    .in("id", idsToUpdate)
    .select("id")

   if (updateError) {
    console.error("reconcile update error", updateError)
    return res.status(500).json({ error: "server error", details: errorMessage(updateError) })
   }

   updatedRows += Array.isArray(updatedData) ? updatedData.length : 0
  }

  const missingEmails = emails.filter((email) => !matchedEmailSet.has(email))

  return res.json({
   success: true,
   pasted: emails.length,
   matched: matchedEmailSet.size,
   updatedRows,
   missing: missingEmails.length,
   missingEmails
  })
 } catch (error) {
  console.error("reconcile route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/resend", limitResend, async (req, res) => {
 try {
  const { email } = req.body || {}
  if (typeof email !== "string" || !email.trim()) {
   return res.status(400).json({ error: "email required" })
  }

  const { data, error } = await supabase
   .from("access_tokens")
   .select("id,email,token")
   .eq("email", email.trim().toLowerCase())
   .order("created_at", { ascending: false })
   .limit(1)
   .maybeSingle()

  if (error || !data) return res.status(404).json({ error: "not found" })

  const result = await sendOneAccessToken(data)
  if (!result.sent) {
   return res.status(502).json({ error: "mail provider error", details: "send failed" })
  }

  return res.json({ success: true })
 } catch (error) {
  console.error("resend route error", error)
  return res.status(500).json({ error: "server error", details: errorMessage(error) })
 }
})

router.post("/batch-resend", limitResend, async (req, res) => {
 try {
  const ids = normalizeIdList(req.body?.ids)
  if (!ids.length) return res.status(400).json({ error: "valid ids required" })

  const { data, error } = await supabase
   .from("access_tokens")
   .select("id,email,token")
   .in("id", ids)

  if (error) {
   console.error("batch resend fetch error", error)
   return res.status(500).json({ error: "server error" })
  }

  const rows = Array.isArray(data) ? data : []
  let sent = 0
  let failed = 0
  for (const row of rows) {
   const result = await sendOneAccessToken(row)
   sent += result.sent
   failed += result.failed
  }

 return res.json({ success: true, processed: rows.length, sent, failed })
} catch (error) {
 console.error("batch resend route error", error)
 return res.status(500).json({ error: "server error" })
}
})

router.post("/resend-filtered", limitResend, async (req, res) => {
 try {
  const filters = normalizeListFilters(req.body)
  const { data, error } = await fetchFilteredRows(filters, {
   select: "id,email,token,email_sent,brevo_status,resend_excluded",
   limit: 5000,
   orderAscending: true
  })
  if (error) {
   console.error("filtered resend fetch error", error)
   return res.status(500).json({ error: "server error" })
  }

  const rows = (Array.isArray(data) ? data : []).filter((row) => row.resend_excluded !== true)
  let sent = 0
  let failed = 0
  for (const row of rows) {
   const result = await sendOneAccessToken(row)
   sent += result.sent
   failed += result.failed
  }

  return res.json({ success: true, processed: rows.length, sent, failed })
 } catch (error) {
  console.error("filtered resend route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/select-filtered", limitList, async (req, res) => {
 try {
  const filters = normalizeListFilters(req.body)
  const { data, error } = await fetchFilteredRows(filters, {
   select: "id",
   limit: 5000,
   orderAscending: false
  })

  if (error) {
   console.error("select filtered error", error)
   return res.status(500).json({ error: "server error" })
  }

  const ids = normalizeIdList((data || []).map((row) => row.id))
  return res.json({ success: true, ids, total: ids.length })
 } catch (error) {
  console.error("select filtered route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/exclude-selected", limitResend, async (req, res) => {
 try {
  const ids = normalizeIdList(req.body?.ids)
  const excluded = Boolean(req.body?.excluded)
  if (!ids.length) return res.status(400).json({ error: "valid ids required" })

  const { data, error } = await supabase
   .from("access_tokens")
   .update({
    resend_excluded: excluded,
    admin_note_updated_at: new Date().toISOString()
   })
   .in("id", ids)
   .select("id")

  if (error) {
   console.error("exclude selected error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true, updated: Array.isArray(data) ? data.length : 0, excluded })
 } catch (error) {
  console.error("exclude selected route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/exclude-filtered", limitResend, async (req, res) => {
 try {
  const filters = normalizeListFilters(req.body)
  const excluded = Boolean(req.body?.excluded)
  const { data, error } = await fetchFilteredRows(filters, {
   select: "id",
   limit: 5000,
   orderAscending: false
  })
  if (error) {
   console.error("exclude filtered fetch error", error)
   return res.status(500).json({ error: "server error" })
  }

  const ids = normalizeIdList((data || []).map((row) => row.id))
  if (!ids.length) return res.json({ success: true, updated: 0, excluded })

  const { data: updatedData, error: updateError } = await supabase
   .from("access_tokens")
   .update({
    resend_excluded: excluded,
    admin_note_updated_at: new Date().toISOString()
   })
   .in("id", ids)
   .select("id")

  if (updateError) {
   console.error("exclude filtered update error", updateError)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true, updated: Array.isArray(updatedData) ? updatedData.length : 0, excluded })
 } catch (error) {
  console.error("exclude filtered route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/note", limitResend, async (req, res) => {
 try {
  const id = String(req.body?.id || "").trim()
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : ""
  if (!UUID_V4_OR_V7_REGEX.test(id)) return res.status(400).json({ error: "valid uuid id required" })

  const { data, error } = await supabase
   .from("access_tokens")
   .update({
    admin_note: note || null,
    admin_note_updated_at: new Date().toISOString()
   })
   .eq("id", id)
   .select("id,admin_note,admin_note_updated_at")
   .maybeSingle()

  if (error) {
   console.error("note route error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true, data })
 } catch (error) {
  console.error("note route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/detail/:id", limitList, async (req, res) => {
 try {
  const id = String(req.params.id || "").trim()
  if (!UUID_V4_OR_V7_REGEX.test(id)) return res.status(400).json({ error: "valid uuid id required" })

  const { data, error } = await supabase
   .from("access_tokens")
   .select("*")
   .eq("id", id)
   .maybeSingle()

  if (error) {
   console.error("detail route error", error)
   return res.status(500).json({ error: "server error" })
  }
  if (!data) return res.status(404).json({ error: "not found" })

  return res.json({
   data,
   timeline: buildTimeline(data)
  })
 } catch (error) {
  console.error("detail route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/brevo-stats", limitList, async (req, res) => {
 try {
  const stats = {}
  for (const status of ["none", ...BREVO_STATUSES]) {
   let query = supabase
    .from("access_tokens")
    .select("id", { count: "exact", head: true })

   if (status === "none") query = query.is("brevo_status", null)
   else query = query.eq("brevo_status", status)

   const { count, error } = await query
   if (error) throw error
   stats[status] = count || 0
  }

  return res.json({ stats })
 } catch (error) {
  console.error("brevo stats route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/dashboard-copy", limitList, async (req, res) => {
 try {
  const copy = await readDashboardCopyObject()
  const entries = Object.entries(copy).map(([key, value]) => ({
   key,
   label: humanizeCopyKey(key),
   value: String(value ?? "")
  }))
  return res.json({ entries })
 } catch (error) {
  console.error("dashboard copy read error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/dashboard-copy", limitResend, async (req, res) => {
 try {
  const inputEntries = req.body?.entries
  if (!inputEntries || typeof inputEntries !== "object") {
   return res.status(400).json({ error: "entries required" })
  }

  const currentCopy = await readDashboardCopyObject()
  const nextCopy = {}
  for (const key of Object.keys(currentCopy)) {
   const value = inputEntries[key]
   nextCopy[key] = typeof value === "string" ? value : String(currentCopy[key] ?? "")
  }

  const content = serializeDashboardCopyObject(nextCopy)
  await fs.writeFile(dashboardCopyFilePath, `${content.trim()}\n`, "utf8")
  return res.json({ success: true })
 } catch (error) {
  console.error("dashboard copy save error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/export", limitList, async (req, res) => {
 try {
  const filters = normalizeListFilters(req.query)
  const { data, error } = await fetchFilteredRows(filters, {
   select: "email,email_sent,used,email_sent_at,used_at,brevo_status,email_error,resend_excluded,admin_note,created_at",
   limit: 5000,
   orderAscending: false
  })
  if (error) {
   console.error("export route error", error)
   return res.status(500).json({ error: "server error" })
  }

  const rows = Array.isArray(data) ? data : []
  const header = ["email", "email_sent", "used", "email_sent_at", "used_at", "brevo_status", "email_error", "resend_excluded", "admin_note", "created_at"]
  const csvLines = [
   header.join(","),
   ...rows.map((row) => header.map((key) => {
    const value = row[key]
    const normalized = value == null ? "" : String(value)
    return `"${normalized.replaceAll('"', '""')}"`
   }).join(","))
  ]

  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="access_tokens_export_${Date.now()}.csv"`)
  return res.send(csvLines.join("\n"))
 } catch (error) {
  console.error("export route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/delete", limitDelete, async (req, res) => {
 try {
  const rawId = req.body?.id
  const id = String(rawId || "").trim()
  if (!UUID_V4_OR_V7_REGEX.test(id)) {
   return res.status(400).json({ error: "valid uuid id required" })
  }

  const { error } = await supabase
   .from("access_tokens")
   .delete()
   .eq("id", id)

  if (error) {
   console.error("delete route error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true })
 } catch (error) {
  console.error("delete route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/batch-delete", limitDelete, async (req, res) => {
 try {
  const ids = normalizeIdList(req.body?.ids)
  if (!ids.length) return res.status(400).json({ error: "valid ids required" })

  const { error } = await supabase
   .from("access_tokens")
   .delete()
   .in("id", ids)

  if (error) {
   console.error("batch delete route error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true, deleted: ids.length })
 } catch (error) {
  console.error("batch delete route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/list", limitList, async (req, res) => {
 try {
  const page = Math.max(parseInt(req.query.page) || 1, 1)
  const rawLimit = parseInt(req.query.limit) || 50
  const limit = Math.min(Math.max(rawLimit, 1), 200)
  const search = typeof req.query.search === "string" ? req.query.search : ""
  const status = req.query.status || "all"
  const brevoStatus = typeof req.query.brevoStatus === "string" ? req.query.brevoStatus.trim().toLowerCase() : "all"
  const sort = typeof req.query.sort === "string" ? req.query.sort : "last_import_desc"

  let query = supabase
   .from("access_tokens")
   .select("*", { count: "exact" })
  query = applyListFilters(query, { search, status, brevoStatus })

  if (sort === "last_import_asc") {
   query = query.order("created_at", { ascending: true })
  } else if (sort === "email_asc") {
   query = query.order("email", { ascending: true })
  } else if (sort === "email_desc") {
   query = query.order("email", { ascending: false })
  } else {
   query = query.order("created_at", { ascending: false })
  }

  const start = (page - 1) * limit
  const end = start + limit - 1

  const { data, count, error } = await query.range(start, end)
  if (error) {
   console.error("list route error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ data, total: count })
 } catch (error) {
  console.error("list route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

export default router
