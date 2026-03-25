import axios from "axios"
import { Client, GatewayIntentBits } from "discord.js"
import { supabase } from "./supabase.js"

let started = false

function requiredConfig() {
 const token = process.env.BOT_TOKEN || process.env.DISCORD_BOT_TOKEN
 const guildId = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID
 return { token, guildId }
}

export async function removeDiscordMemberFromGuild(discordId) {
 const { token, guildId } = requiredConfig()
 if (!discordId || !token || !guildId) return { removed: false, skipped: true }

 try {
  const response = await axios.delete(
   `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
   {
    headers: {
     Authorization: `Bot ${token}`
    },
    validateStatus: () => true
   }
  )

  if (response.status === 204) return { removed: true, skipped: false }
  if (response.status === 404) return { removed: false, skipped: true }
  throw new Error(`Discord remove failed (${response.status})`)
 } catch (error) {
  throw new Error(error?.response?.data?.message || error?.message || "Discord remove failed")
 }
}

export function startDiscordMemberLeaveListener() {
 if (started) return

 const { token, guildId } = requiredConfig()
 if (!token || !guildId) {
  console.log("Discord bot listener disabled: BOT_TOKEN/GUILD_ID missing")
  return
 }

 const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
 })

 client.once("ready", () => {
  console.log("Discord bot listener ready as", client.user?.tag || "unknown")
 })

 client.on("guildMemberRemove", async (member) => {
  try {
   if (!member || member.guild?.id !== guildId) return
   const discordId = member.id
   if (!discordId) return

   const { error } = await supabase
    .from("access_tokens")
    .update({ used: false, used_at: null, discord_id: null })
    .eq("discord_id", discordId)

   if (error) {
    console.error("discord member leave sync error", error)
   } else {
    console.log("discord member leave synced for user", discordId)
   }
  } catch (error) {
   console.error("guildMemberRemove handler crash", error)
  }
 })

 client.login(token).catch((error) => {
  console.error("Discord bot login failed", error?.message || error)
 })

 started = true
}
