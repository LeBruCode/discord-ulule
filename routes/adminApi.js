import express from "express"
import crypto from "crypto"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router = express.Router()
const UUID_V4_OR_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function token(){
 return crypto.randomBytes(32).toString("hex")
}

router.post("/import",async(req,res)=>{
 try {
  const rawEmails = req.body?.emails
  if (typeof rawEmails !== "string") {
   return res.status(400).json({ error: "emails is required" })
  }

  const emails = rawEmails
   .split("\n")
   .map((e) => e.trim().toLowerCase())
   .filter((e) => e)

  for(const email of emails){
   const { error } = await supabase.from("access_tokens").insert({
    email,
    token:token(),
    used:false,
    email_sent:false,
    expires_at:new Date(Date.now()+1000*60*60*24*7) // 7 days
   })

   if (error) {
    console.error("import error", email, error)
   }
 }

  res.json({imported:emails.length})
 } catch (error) {
  console.error("import route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/send",async(req,res)=>{
 try {
  const {data,error}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("email_sent",false)
   .limit(500)

  if (error) {
   console.error("send fetch error", error)
   return res.status(500).json({ error: "server error" })
  }

  const rows = Array.isArray(data) ? data : []
  for(const r of rows){

   try{
    await sendMail(r.email,r.token)

    const { error: updateError } = await supabase
     .from("access_tokens")
     .update({email_sent:true})
     .eq("id",r.id)

    if (updateError) console.error("send update error", r.email, updateError)
   }catch(e){
    console.error("mail error",r.email,e)
   }

  }

  res.json({processed:rows.length})
 } catch (error) {
  console.error("send route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/resend",async(req,res)=>{
 try {
  const {email}=req.body || {}
  if (typeof email !== "string" || !email.trim()) {
   return res.status(400).json({ error: "email required" })
  }

  const {data,error}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("email",email.trim().toLowerCase())
   .single()

  if(error || !data) return res.status(404).json({error:"not found"})

  await sendMail(data.email,data.token)

  res.json({success:true})
 } catch (error) {
  console.error("resend route error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.post("/delete", async (req, res) => {
 try {
  const rawId = req.body?.id
  const id = String(rawId || "").trim()
  if (!UUID_V4_OR_V7_REGEX.test(id)) {
   return res.status(400).json({ error: "valid uuid id required" })
  }

  const { error } = await supabase
   .from("access_tokens")
   .delete()
   .eq("id", id)

  if (error) {
   console.error("delete route error", error)
   return res.status(500).json({ error: "server error" })
  }

  return res.json({ success: true })
 } catch (error) {
  console.error("delete route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

router.get("/list",async(req,res)=>{
 try {
  const page=Math.max(parseInt(req.query.page)||1,1)
  const rawLimit=parseInt(req.query.limit)||50
  const limit=Math.min(Math.max(rawLimit,1),200)
  const search=typeof req.query.search==="string" ? req.query.search : ""
  const status=req.query.status||"all"

  let query=supabase
   .from("access_tokens")
   .select("*",{count:"exact"})
   .order("id",{ascending:false})

  if(search) query=query.ilike("email",`%${search}%`)

  if(status==="sent") query=query.eq("email_sent",true)
  if(status==="activated") query=query.eq("used",true)

  const start=(page-1)*limit
  const end=start+limit-1

  const {data,count,error}=await query.range(start,end)
  if (error) {
   console.error("list route error", error)
   return res.status(500).json({ error: "server error" })
  }

  res.json({data,total:count})
 } catch (error) {
  console.error("list route unhandled error", error)
  return res.status(500).json({ error: "server error" })
 }
})

export default router
