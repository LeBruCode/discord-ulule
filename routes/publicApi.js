import express from "express"
import axios from "axios"
import { supabase } from "../services/supabase.js"

const router = express.Router()
const DISCORD_API = "https://discord.com/api/v10"

function getDiscordConfig() {
 return {
  clientId: process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.REDIRECT_URI || process.env.DISCORD_REDIRECT_URI,
  botToken: process.env.BOT_TOKEN || process.env.DISCORD_BOT_TOKEN,
  guildId: process.env.GUILD_ID || process.env.DISCORD_GUILD_ID,
  roleId: process.env.ROLE_ID || process.env.DISCORD_ROLE_ID,
  webhookSecret: process.env.DISCORD_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET
 }
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

export default router
