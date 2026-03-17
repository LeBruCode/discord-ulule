import express from "express"
import { supabase } from "../services/supabase.js"

const router=express.Router()

router.get("/",async(req,res)=>{
 try {
  const {count:total, error: totalError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})

  if (totalError) throw totalError

  const {count:sent, error: sentError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .eq("email_sent",true)
  if (sentError) throw sentError

  const {count:activated, error: activatedError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .eq("used",true)
  if (activatedError) throw activatedError

  const {count:unactivated, error: unactivatedError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .or("used.is.null,used.eq.false")
  if (unactivatedError) throw unactivatedError

  const {count:relanceable, error: relanceableError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .or("used.is.null,used.eq.false")
   .not("resend_excluded", "is", "true")
  if (relanceableError) throw relanceableError

  const {count:pending, error: pendingError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .in("brevo_status", ["request", "queued", "sent"])
  if (pendingError) throw pendingError

  const {count:attention, error: attentionError}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .in("brevo_status", ["soft_bounce", "hard_bounce", "blocked", "error", "deferred", "invalid", "spam"])
  if (attentionError) throw attentionError

  res.json({
   total,
   sent,
   activated,
   unactivated,
   relanceable,
   pending,
   attention,
   rate: total?Math.round(activated/total*100):0
  })
 } catch (error) {
  console.error("stats route error", error)
  return res.status(500).json({ error: "server error" })
 }

})

router.get("/activity", async (req, res) => {
 try {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
   importedResult,
   sentResult,
   activatedResult,
   importedEventsResult,
   sentEventsResult,
   activatedEventsResult
  ] = await Promise.all([
   supabase.from("access_tokens").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
   supabase.from("access_tokens").select("id", { count: "exact", head: true }).gte("email_sent_at", sinceIso),
   supabase.from("access_tokens").select("id", { count: "exact", head: true }).gte("used_at", sinceIso),
   supabase.from("access_tokens").select("id,email,created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(6),
   supabase.from("access_tokens").select("id,email,email_sent_at,brevo_status").gte("email_sent_at", sinceIso).order("email_sent_at", { ascending: false }).limit(6),
   supabase.from("access_tokens").select("id,email,used_at,discord_id").gte("used_at", sinceIso).order("used_at", { ascending: false }).limit(6)
  ])

  for (const result of [importedResult, sentResult, activatedResult, importedEventsResult, sentEventsResult, activatedEventsResult]) {
   if (result.error) throw result.error
  }

  const events = [
   ...((importedEventsResult.data || []).map((row) => ({
    id: `import-${row.id}`,
    at: row.created_at,
    tone: "imported",
    title: "Import ajouté",
    copy: row.email || "-"
   }))),
   ...((sentEventsResult.data || []).map((row) => ({
    id: `sent-${row.id}`,
    at: row.email_sent_at,
    tone: ["delivered", "opened", "unique_opened", "click", "unique_clicked"].includes(String(row.brevo_status || "").toLowerCase()) ? "success" : "pending",
    title: "Mail relancé",
    copy: row.email || "-"
   }))),
   ...((activatedEventsResult.data || []).map((row) => ({
    id: `activated-${row.id}`,
    at: row.used_at,
    tone: "activated",
    title: row.discord_id ? "A rejoint Discord" : "Activé",
    copy: row.email || "-"
   })))
  ]
   .filter((event) => event.at)
   .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
   .slice(0, 12)

  return res.json({
   summary: {
    imported: importedResult.count || 0,
    sent: sentResult.count || 0,
    activated: activatedResult.count || 0
   },
   events
  })
 } catch (error) {
  console.error("stats activity route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/activations-daily", async (req, res) => {
 try {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 60)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const sinceIso = start.toISOString()

  const { data, error } = await supabase
   .from("access_tokens")
   .select("used_at")
   .eq("used", true)
   .gte("used_at", sinceIso)
   .order("used_at", { ascending: true })

  if (error) throw error

  const buckets = new Map()
  for (let index = 0; index < days; index += 1) {
   const day = new Date(start)
   day.setDate(start.getDate() + index)
   const key = day.toISOString().slice(0, 10)
   buckets.set(key, 0)
  }

  for (const row of data || []) {
   const key = String(row.used_at || "").slice(0, 10)
   if (buckets.has(key)) buckets.set(key, Number(buckets.get(key) || 0) + 1)
  }

  const points = [...buckets.entries()].map(([date, count]) => ({ date, count }))
  return res.json({ days, points })
 } catch (error) {
  console.error("stats activations daily route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

export default router
