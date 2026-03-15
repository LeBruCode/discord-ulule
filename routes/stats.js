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

export default router
