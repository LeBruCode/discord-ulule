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

  res.json({
   total,
   sent,
   activated,
   rate: total?Math.round(activated/total*100):0
  })
 } catch (error) {
  console.error("stats route error", error)
  return res.status(500).json({ error: "server error" })
 }

})

export default router
