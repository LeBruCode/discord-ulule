import express from "express"
import crypto from "crypto"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router=express.Router()

function token(){
 return crypto.randomBytes(32).toString("hex")
}

// Import emails
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

// Send batch emails
router.post("/send",async(req,res)=>{

 const {data}=await supabase
  .from("access_tokens")
  .select("*")
  .eq("email_sent",false)
  .limit(500)

 for(const r of data){

  try{
   await sendMail(r.email,r.token)

   await supabase
    .from("access_tokens")
    .update({email_sent:true})
    .eq("id",r.id)

  }catch(e){
   console.error("mail error",r.email)
  }

 }

 res.json({processed:data.length})
})

// Resend to specific email
router.post("/resend",async(req,res)=>{

 const email=req.body.email

 const {data}=await supabase
  .from("access_tokens")
  .select("*")
  .eq("email",email)
  .single()

 if(!data){
  return res.status(404).json({error:"email not found"})
 }

 try{

  await sendMail(data.email,data.token)

  await supabase
   .from("access_tokens")
   .update({email_sent:true})
   .eq("id",data.id)

  res.json({success:true})

 }catch(e){
  res.status(500).json({error:"send failed"})
 }

})

// List with filters
router.get("/list",async(req,res)=>{

 const page=parseInt(req.query.page)||1
 const limit=parseInt(req.query.limit)||50
 const search=req.query.search||""
 const status=req.query.status||"all"

 let query=supabase
  .from("access_tokens")
  .select("*",{count:"exact"})
  .order("id",{ascending:false})

 if(search){
  query=query.ilike("email",`%${search}%`)
 }

 if(status==="sent"){
  query=query.eq("email_sent",true)
 }

 if(status==="activated"){
  query=query.eq("used",true)
 }

 const start=(page-1)*limit
 const end=start+limit-1

 const {data,count}=await query.range(start,end)

 res.json({data,total:count})
})

export default router