import express from "express"
import crypto from "crypto"
import { supabase } from "../services/supabase.js"
import { mailQueue } from "../queue/mailQueue.js"

const router=express.Router()

function token(){
 return crypto.randomBytes(32).toString("hex")
}

router.post("/import",async(req,res)=>{

 const emails=req.body.emails
  .split("\n")
  .map(e=>e.trim())
  .filter(e=>e)

 for(const email of emails){

  await supabase.from("access_tokens").insert({
   email,
   token:token(),
   used:false,
   email_sent:false
  })

 }

 res.json({imported:emails.length})
})

router.post("/send",async(req,res)=>{

 const {data}=await supabase
 .from("access_tokens")
 .select("*")
 .eq("email_sent",false)
 .limit(500)

 for(const r of data){

  await mailQueue.add("send",{
   email:r.email,
   token:r.token,
   id:r.id
  })

 }

 res.json({queued:data.length})
})

router.get("/list",async(req,res)=>{

 const page=parseInt(req.query.page)||1
 const limit=parseInt(req.query.limit)||50
 const start=(page-1)*limit
 const end=start+limit-1

 const {data,count}=await supabase
  .from("access_tokens")
  .select("*",{count:"exact"})
  .range(start,end)
  .order("id",{ascending:false})

 res.json({data,total:count})
})

export default router