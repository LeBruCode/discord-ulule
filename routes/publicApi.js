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
  roleId: process.env.ROLE_ID || process.env.DISCORD_ROLE_ID
 }
}

function getTokenExpiry(createdAt) {
 const created = new Date(createdAt)
 return new Date(created.getTime() + 1000 * 60 * 60 * 24 * 7)
}

async function getAccessTokenRecord(token) {
 const { data, error } = await supabase
  .from("access_tokens")
  .select("id, used, discord_id, created_at")
  .eq("token", token)
  .single()

 if (error || !data) return null
 if (data.used && data.discord_id) return null
 if (getTokenExpiry(data.created_at) < new Date()) return null
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
 const { clientId, redirectUri } = getDiscordConfig()
 const inviteUrl = process.env.DISCORD_INVITE_URL || "https://discord.com"

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

  const tokenResponse = await axios.post(
   `${DISCORD_API}/oauth2/token`,
   new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
   }).toString(),
   { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  )
  const accessToken = tokenResponse.data?.access_token
  if (!accessToken) return res.status(502).send("Discord token exchange failed")

  const userResponse = await axios.get(`${DISCORD_API}/users/@me`, {
   headers: { Authorization: `Bearer ${accessToken}` }
  })
  const discordId = userResponse.data?.id
  if (!discordId) return res.status(502).send("Discord user lookup failed")

  if (guildId && botToken) {
   try {
    await axios.put(
     `${DISCORD_API}/guilds/${guildId}/members/${discordId}`,
     { access_token: accessToken },
     { headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" } }
    )
   } catch (error) {
    const status = error?.response?.status
    if (status !== 204 && status !== 201) {
     console.error("guild join error", error?.response?.data || error.message)
    }
   }
  }

  if (guildId && roleId && botToken) {
   try {
    await axios.put(
     `${DISCORD_API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
     {},
     { headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" } }
    )
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

  const invite = process.env.DISCORD_INVITE_URL || "https://discord.com"
  return res.redirect(invite)
 } catch (error) {
  console.error("discord callback error", error?.response?.data || error.message || error)
  return res.status(500).send("Discord authentication failed")
 }
})

export default router
