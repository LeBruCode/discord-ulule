import express from "express"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import vm from "vm"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router = express.Router()
const DISCORD_API = "https://discord.com/api/v10"
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dashboardCopyFilePath = path.join(__dirname, "..", "public", "js", "dashboardCopy.js")
const APP_SETTINGS_TABLE = "app_settings"
const DASHBOARD_BRANDING_KEY = "dashboard_branding"
const DASHBOARD_COPY_KEY = "dashboard_copy"
const publicRequestRateLimit = new Map()

function getDiscordConfig() {
 return {
  clientId: process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI || process.env.DISCORD_REDIRECT_URI,
  botToken: process.env.BOT_TOKEN || process.env.DISCORD_BOT_TOKEN,
  guildId: process.env.GUILD_ID || process.env.DISCORD_GUILD_ID,
  roleId: process.env.ROLE_ID || process.env.DISCORD_ROLE_ID,
  webhookSecret: process.env.DISCORD_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET,
  brevoWebhookSecret: process.env.BREVO_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET
 }
}

function isRateLimited(ip) {
 const now = Date.now()
 const windowMs = 15 * 60 * 1000
 const maxAttempts = 8
 const entry = publicRequestRateLimit.get(ip) || { count: 0, resetAt: now + windowMs }
 if (now > entry.resetAt) {
  entry.count = 0
  entry.resetAt = now + windowMs
 }
 if (entry.count >= maxAttempts) return true
 entry.count += 1
 publicRequestRateLimit.set(ip, entry)
 return false
}

async function readPublicBranding() {
 try {
  const { data, error } = await supabase
   .from(APP_SETTINGS_TABLE)
   .select("value,updated_at")
   .eq("key", DASHBOARD_BRANDING_KEY)
   .maybeSingle()

  if (error) throw error
  const value = data?.value || {}
  return {
   logoPath: typeof value.logoPath === "string" ? value.logoPath : null,
   logoDataUrl: typeof value.logoDataUrl === "string" ? value.logoDataUrl : null,
   logoWidth: Number.isFinite(Number(value.logoWidth)) ? Number(value.logoWidth) : 96,
   updatedAt: value.updatedAt || data?.updated_at || null
  }
 } catch (error) {
  console.warn("public branding read skipped", error?.message || error)
  return { logoPath: null, logoDataUrl: null, logoWidth: 96, updatedAt: null }
 }
}

async function readPublicCopyDefaults() {
 try {
  const source = await fs.readFile(dashboardCopyFilePath, "utf8")
  const context = { window: {} }
  vm.createContext(context)
  vm.runInContext(source, context)
  return context.window?.DASHBOARD_COPY || {}
 } catch (error) {
  console.warn("public copy defaults read skipped", error?.message || error)
  return {}
 }
}

async function readPublicCopy() {
 const defaults = await readPublicCopyDefaults()

 try {
  const { data, error } = await supabase
   .from(APP_SETTINGS_TABLE)
   .select("value")
   .eq("key", DASHBOARD_COPY_KEY)
   .maybeSingle()

  if (error) throw error
  if (data?.value && typeof data.value === "object") {
   return { ...defaults, ...data.value }
  }
 } catch (error) {
  console.warn("public copy read skipped", error?.message || error)
 }

 return defaults
}

function getBrevoEventStatus(eventName) {
 const value = String(eventName || "").trim().toLowerCase()
 if (!value) return null
 if (value === "invalid_email") return "invalid"
 return value
}

function getBrevoEventTimestamp(payload) {
 const candidates = [payload?.date, payload?.event_date, payload?.ts_event]
 for (const candidate of candidates) {
  if (!candidate) continue
  const date = new Date(candidate)
  if (!Number.isNaN(date.getTime())) return date.toISOString()
 }
 return new Date().toISOString()
}

function getBrevoMessageId(payload) {
 return String(
  payload?.["message-id"] ||
  payload?.messageId ||
  payload?.message_id ||
  ""
 ).trim() || null
}

function getBrevoAccessTokenId(payload) {
 const rawTags = []
 if (Array.isArray(payload?.tags)) rawTags.push(...payload.tags)
 if (typeof payload?.tag === "string") rawTags.push(...payload.tag.split(","))

 for (const rawTag of rawTags) {
  const tag = String(rawTag || "").trim()
  if (!tag.startsWith("access-token:")) continue
  const accessTokenId = tag.slice("access-token:".length).trim()
  if (accessTokenId) return accessTokenId
 }

 return null
}

async function findAccessTokenForBrevoEvent(payload) {
 const accessTokenId = getBrevoAccessTokenId(payload)
 if (accessTokenId) {
  const { data, error } = await supabase
   .from("access_tokens")
   .select("id")
   .eq("id", accessTokenId)
   .maybeSingle()
  if (data && !error) return data
 }

 const messageId = getBrevoMessageId(payload)
 if (messageId) {
  const { data, error } = await supabase
   .from("access_tokens")
   .select("id")
   .eq("brevo_message_id", messageId)
   .order("created_at", { ascending: false })
   .limit(1)
   .maybeSingle()
  if (data && !error) return data
 }

 const email = String(payload?.email || payload?.recipient || "").trim().toLowerCase()
 if (email) {
  const { data, error } = await supabase
   .from("access_tokens")
   .select("id")
   .eq("email", email)
   .order("created_at", { ascending: false })
   .limit(1)
   .maybeSingle()
  if (data && !error) return data
 }

 return null
}

async function applyBrevoEvent(payload) {
 const status = getBrevoEventStatus(payload?.event)
 if (!status) return { ignored: true, reason: "missing event" }

 const record = await findAccessTokenForBrevoEvent(payload)
 if (!record?.id) return { ignored: true, reason: "record not found" }

 const messageId = getBrevoMessageId(payload)
 const eventAt = getBrevoEventTimestamp(payload)
 const update = {
  brevo_status: status,
  brevo_event_at: eventAt
 }

 if (messageId) update.brevo_message_id = messageId

 if (status === "sent" || status === "delivered") {
  update.email_sent = true
  update.email_sent_at = eventAt
  update.email_error = null
 }

 if (["error", "soft_bounce", "hard_bounce", "blocked", "invalid", "deferred", "spam"].includes(status)) {
  update.email_sent = false
  update.email_error = String(
   payload?.reason ||
   payload?.message ||
   payload?.description ||
   status
  ).trim()
 }

 const { error } = await supabase
  .from("access_tokens")
  .update(update)
  .eq("id", record.id)

 if (error) throw error
 return { ignored: false, id: record.id, status }
}

function getTokenExpiry(createdAt) {
 const created = new Date(createdAt)
 return new Date(created.getTime() + 1000 * 60 * 60 * 24 * 7)
}

function getAxiosErrorDetails(error) {
 const status = error?.response?.status
 const data = error?.response?.data
 const description =
  data?.error_description ||
  data?.message ||
  data?.error ||
  error?.message ||
  "unknown error"
 return { status, description }
}

function sleep(ms) {
 return new Promise((resolve) => setTimeout(resolve, ms))
}

async function discordApiRequest(config, maxRetries = 3) {
 let attempt = 0
 let lastError = null

 while (attempt <= maxRetries) {
  try {
   return await axios(config)
  } catch (error) {
   lastError = error
   const status = error?.response?.status
   const retryAfterRaw = error?.response?.data?.retry_after
   const retryAfterSec = Number(retryAfterRaw)
   const retryAfterMs = Number.isFinite(retryAfterSec) ? Math.ceil(retryAfterSec * 1000) : 0
   const shouldRetry = status === 429 || status === 500 || status === 502 || status === 503 || status === 504
   if (!shouldRetry || attempt === maxRetries) break

   const jitter = Math.floor(Math.random() * 250)
   const backoffMs = 400 * (2 ** attempt)
   await sleep(Math.max(retryAfterMs, backoffMs) + jitter)
   attempt += 1
  }
 }

 throw lastError
}

async function isMemberOfGuild(discordId) {
 const { botToken, guildId } = getDiscordConfig()
 if (!discordId || !botToken || !guildId) return null

 try {
  await discordApiRequest({
   method: "GET",
   url: `${DISCORD_API}/guilds/${guildId}/members/${discordId}`,
   headers: { Authorization: `Bot ${botToken}` }
  }, 2)
  return true
 } catch (error) {
  if (error?.response?.status === 404) return false
  console.error("guild member check error", error?.response?.data || error?.message || error)
  return null
 }
}

async function getAccessTokenRecord(token) {
 const { data, error } = await supabase
  .from("access_tokens")
  .select("id, used, discord_id, created_at")
  .eq("token", token)
  .single()

 if (error || !data) return null
 if (getTokenExpiry(data.created_at) < new Date()) return null

 // Main path: native Discord listener should reset this on member leave.
 // Fallback path: verify membership on activation request to auto-heal stale rows.
 if (data.used && data.discord_id) {
  const stillMember = await isMemberOfGuild(data.discord_id)
  if (stillMember === false) {
   const { error: resetError } = await supabase
    .from("access_tokens")
    .update({ used: false, used_at: null, discord_id: null })
    .eq("id", data.id)
   if (resetError) {
    console.error("token fallback reset error", resetError)
    return null
   }
   return { ...data, used: false, discord_id: null }
  }
  return null
 }

 return data
}

router.post("/activate", async (req, res) => {
 try {
  const { token } = req.body || {}

  if (!token || typeof token !== "string") {
   return res.status(400).json({ success: false, message: "token required" })
  }

  const data = await getAccessTokenRecord(token)
  if (!data) return res.json({ success: false, message: "invalid or expired" })
  return res.json({ success: true })
 } catch (error) {
  console.error("activate error", error)
  return res.status(500).json({ success: false, message: "server error" })
 }
})

router.get("/config", (req, res) => {
 const { clientId, redirectUri, guildId } = getDiscordConfig()
 const inviteUrl = process.env.DISCORD_INVITE_URL || (guildId ? `https://discord.com/channels/${guildId}` : "https://discord.com")

 return res.json({
  discordOauthReady: Boolean(clientId && redirectUri),
  discordInviteUrl: inviteUrl
 })
})

router.get("/landing-config", async (req, res) => {
 try {
  const branding = await readPublicBranding()
  const copy = await readPublicCopy()
  res.setHeader("Cache-Control", "no-store")
  return res.json({ branding, copy })
 } catch (error) {
  console.error("landing config error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/request-access-link", async (req, res) => {
 try {
  const ip = req.ip || "unknown"
  if (isRateLimited(ip)) {
   return res.status(429).json({
    success: true,
    message: "Si ton adresse existe déjà dans la liste, tu vas recevoir un lien dans quelques instants."
   })
  }

  const email = String(req.body?.email || "").trim().toLowerCase()
  if (!email) {
   return res.status(400).json({ error: "email required" })
  }

  const genericMessage = "Si ton adresse existe déjà dans la liste, tu vas recevoir un lien dans quelques instants."
  const { data, error } = await supabase
   .from("access_tokens")
   .select("id,email,token")
   .eq("email", email)
   .order("created_at", { ascending: false })
   .limit(1)
   .maybeSingle()

  if (error) {
    console.error("request access lookup error", error)
    return res.status(500).json({ error: "server error" })
  }

  if (!data?.email || !data?.token) {
   return res.json({ success: true, message: genericMessage })
  }

  try {
   const sendResponse = await sendMail(data.email, data.token, { accessTokenId: data.id })
   const messageId = String(sendResponse?.messageId || sendResponse?.message_id || "").trim() || null
   const nowIso = new Date().toISOString()
   await supabase
    .from("access_tokens")
    .update({
     email_sent: false,
     email_sent_at: null,
     brevo_status: "queued",
     brevo_event_at: nowIso,
     brevo_message_id: messageId,
     email_error: null
    })
    .eq("id", data.id)
  } catch (sendError) {
   console.error("request access send error", sendError)
   await supabase
    .from("access_tokens")
    .update({ email_error: sendError?.message || "mail send failed" })
    .eq("id", data.id)
  }

  return res.json({ success: true, message: genericMessage })
 } catch (error) {
  console.error("request access route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/discord/authorize", async (req, res) => {
 try {
  const token = String(req.query.token || "").trim()
  const record = await getAccessTokenRecord(token)
  if (!record) return res.status(400).send("Invalid or expired activation token")

  const { clientId, redirectUri } = getDiscordConfig()
  if (!clientId || !redirectUri) {
   return res.status(500).send("Discord OAuth is not configured")
  }

  const params = new URLSearchParams({
   client_id: clientId,
   redirect_uri: redirectUri,
   response_type: "code",
   scope: "identify guilds.join",
   state: token
  })

  return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`)
 } catch (error) {
  console.error("discord authorize error", error)
  return res.status(500).send("Server error")
 }
})

router.get("/callback", async (req, res) => {
 try {
  const code = String(req.query.code || "").trim()
  const token = String(req.query.state || "").trim()
  if (!code || !token) return res.status(400).send("Missing OAuth parameters")

  const record = await getAccessTokenRecord(token)
  if (!record) return res.status(400).send("Invalid or expired activation token")

  const { clientId, clientSecret, redirectUri, botToken, guildId, roleId } = getDiscordConfig()
  if (!clientId || !clientSecret || !redirectUri) {
   return res.status(500).send("Discord OAuth env vars are missing")
  }

  const tokenResponse = await discordApiRequest({
   method: "POST",
   url: `${DISCORD_API}/oauth2/token`,
   data: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
   }).toString(),
   headers: { "Content-Type": "application/x-www-form-urlencoded" }
  })
  const accessToken = tokenResponse.data?.access_token
  if (!accessToken) return res.status(502).send("Discord token exchange failed")

  const userResponse = await discordApiRequest({
   method: "GET",
   url: `${DISCORD_API}/users/@me`,
   headers: { Authorization: `Bearer ${accessToken}` }
  })
  const discordId = userResponse.data?.id
  if (!discordId) return res.status(502).send("Discord user lookup failed")

  if (guildId && botToken) {
   try {
    await discordApiRequest({
     method: "PUT",
     url: `${DISCORD_API}/guilds/${guildId}/members/${discordId}`,
     data: { access_token: accessToken },
     headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" }
    })
   } catch (error) {
    const status = error?.response?.status
    if (status !== 204 && status !== 201) {
     console.error("guild join error", error?.response?.data || error.message)
    }
   }
  }

  if (guildId && roleId && botToken) {
   try {
    await discordApiRequest({
     method: "PUT",
     url: `${DISCORD_API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
     data: {},
     headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" }
    })
   } catch (error) {
    console.error("role assign error", error?.response?.data || error.message)
   }
  }

  const { error: updateError } = await supabase
   .from("access_tokens")
   .update({ used: true, used_at: new Date().toISOString(), discord_id: discordId })
   .eq("id", record.id)

  if (updateError) {
   console.error("callback update error", updateError)
   return res.status(500).send("Database update failed")
  }

  const invite = process.env.DISCORD_INVITE_URL || (guildId ? `https://discord.com/channels/${guildId}` : "https://discord.com")
  return res.redirect(invite)
 } catch (error) {
  const { status, description } = getAxiosErrorDetails(error)
  console.error("discord callback error", {
   status,
   description,
   raw: error?.response?.data || error?.message || error
  })
  return res.status(500).send(`Discord authentication failed: ${description}`)
 }
})

router.post("/discord/member-left", async (req, res) => {
 try {
  const { webhookSecret, guildId } = getDiscordConfig()
  if (!webhookSecret) return res.status(500).json({ error: "missing DISCORD_WEBHOOK_SECRET" })

  const provided = String(req.headers["x-webhook-secret"] || "")
  if (provided !== webhookSecret) return res.status(401).json({ error: "unauthorized" })

  const eventGuildId = String(req.body?.guild_id || "")
  const discordId = String(req.body?.user_id || "")
  if (!eventGuildId || !discordId) return res.status(400).json({ error: "guild_id and user_id required" })
  if (guildId && eventGuildId !== guildId) return res.status(400).json({ error: "guild mismatch" })

  const { error } = await supabase
   .from("access_tokens")
   .update({ used: false, used_at: null, discord_id: null })
   .eq("discord_id", discordId)

  if (error) {
   console.error("member-left update error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true })
 } catch (error) {
  console.error("member-left route error", error)
 return res.status(500).json({ error: "server error" })
 }
})

router.post("/brevo/webhook", async (req, res) => {
 try {
  const { brevoWebhookSecret } = getDiscordConfig()
  const providedSecret =
   String(req.headers["x-brevo-webhook-secret"] || "").trim() ||
   String(req.query.secret || "").trim()

  if (brevoWebhookSecret && providedSecret !== brevoWebhookSecret) {
   return res.status(401).json({ error: "unauthorized" })
  }

  const events = Array.isArray(req.body) ? req.body : [req.body]
  let processed = 0
  let ignored = 0

  for (const payload of events) {
   const result = await applyBrevoEvent(payload || {})
   if (result.ignored) ignored += 1
   else processed += 1
  }

  return res.json({ success: true, processed, ignored })
 } catch (error) {
  console.error("brevo webhook error", error)
  return res.status(500).json({ error: "server error" })
 }
})

export default router
