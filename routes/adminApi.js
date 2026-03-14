import express from "express"
import crypto from "crypto"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router = express.Router()
const UUID_V4_OR_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function token() {
 return crypto.randomBytes(32).toString("hex")
}

function errorMessage(error) {
 return error?.message || "unknown error"
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

async function sendMailWithRetry(email, accessToken) {
 let lastError = null
 for (let attempt = 0; attempt <= BREVO_MAX_RETRIES; attempt += 1) {
  try {
   await sendMail(email, accessToken)
   return
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
  await sendMailWithRetry(row.email, row.token)

  const { error: updateError } = await supabase
   .from("access_tokens")
   .update({
    email_sent: true,
    email_sent_at: new Date().toISOString(),
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
    .select("id,email,token")
    .or("email_sent.eq.false,email_sent.is.null")
    .order("created_at", { ascending: true })
    .limit(100)

   if (error) {
    console.error("send queue fetch error", error)
    break
   }

   const rows = Array.isArray(data) ? data : []
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
  const { count, error } = await supabase
   .from("access_tokens")
   .select("id", { count: "exact", head: true })
   .or("email_sent.eq.false,email_sent.is.null")

  if (error) {
   console.error("send count error", error)
   return res.status(500).json({ error: "server error" })
  }

  if (!sendQueueState.running) {
   processSendQueue().catch((queueError) => {
    console.error("send queue crash", queueError)
    sendQueueState.running = false
   })
  }

  return res.json({
   queued: count || 0,
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
    .select("email")
    .in("email", chunk)

   if (error) {
    console.error("reconcile fetch error", error)
    return res.status(500).json({ error: "server error" })
   }

   const matchedEmails = [...new Set((data || []).map((row) => String(row.email || "").toLowerCase()).filter(Boolean))]
   matchedEmails.forEach((email) => matchedEmailSet.add(email))

   if (!matchedEmails.length) continue

   const { data: updatedData, error: updateError } = await supabase
    .from("access_tokens")
    .update({
     email_sent: true,
     email_sent_at: new Date().toISOString(),
     email_error: null
    })
    .in("email", matchedEmails)
    .or("email_sent.eq.false,email_sent.is.null")
    .select("id")

   if (updateError) {
    console.error("reconcile update error", updateError)
    return res.status(500).json({ error: "server error" })
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
  const sort = typeof req.query.sort === "string" ? req.query.sort : "last_import_desc"

  let query = supabase
   .from("access_tokens")
   .select("*", { count: "exact" })

  if (search) query = query.ilike("email", `%${search}%`)

  if (status === "sent") query = query.eq("email_sent", true)
  if (status === "unsent") query = query.or("email_sent.eq.false,email_sent.is.null")
  if (status === "activated") query = query.eq("used", true)

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
