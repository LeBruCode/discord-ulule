import express from "express"
import { supabase } from "../services/supabase.js"

const router=express.Router()

router.get("/",async(req,res)=>{

 const {count:total}=await supabase
 .from("access_tokens")
 .select("*",{count:"exact",head:true})

 const {count:sent}=await supabase
 .from("access_tokens")
 .select("*",{count:"exact",head:true})
 .eq("email_sent",true)

 const {count:activated}=await supabase
 .from("access_tokens")
 .select("*",{count:"exact",head:true})
 .eq("used",true)

 res.json({
  total,
  sent,
  activated,
  rate: total?Math.round(activated/total*100):0
 })

})

export default router