import express from "express"
import { supabase } from "../services/supabase.js"

const router = express.Router()

router.post("/activate", async (req, res) => {
 try {
  const { token } = req.body || {}

  if (!token || typeof token !== "string") {
   return res.status(400).json({ success: false, message: "token required" })
  }

  const { data, error } = await supabase
   .from("access_tokens")
   .select("id, used, discord_id, created_at")
   .eq("token", token)
   .single()

  if (error || !data) return res.json({ success: false })
  if (data.used && data.discord_id) {
   return res.json({ success: false, message: "already used" })
  }

  // Token validity: 7 days from creation time.
  const createdAt = new Date(data.created_at)
  const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 60 * 24 * 7)
  if (expiresAt < new Date()) {
   return res.json({ success: false, message: "expired" })
  }

  if (!data.used) {
   const { error: updateError } = await supabase
    .from("access_tokens")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("id", data.id)

   if (updateError) {
    console.error("activate update error", updateError)
    return res.status(500).json({ success: false, message: "server error" })
   }
  }

  return res.json({ success: true })
 } catch (error) {
  console.error("activate error", error)
  return res.status(500).json({ success: false, message: "server error" })
 }
})

router.get("/config", (req, res) => {
 return res.json({
  discordInviteUrl: process.env.DISCORD_INVITE_URL || "https://discord.com"
 })
})

export default router
