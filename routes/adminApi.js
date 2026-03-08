import express from "express"
import crypto from "crypto"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router = express.Router()
const UUID_V4_OR_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function token(){
 return crypto.randomBytes(32).toString("hex")
}

function errorMessage(error) {
 return error?.message || "unknown error"
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

  let inserted = 0
  let failed = 0
  for(const email of emails){
   const { error } = await supabase.from("access_tokens").insert({
    email,
    token:token(),
    used:false,
    email_sent:false
   })

   if (error) {
    console.error("import error", email, error)
    failed += 1
   } else {
    inserted += 1
   }
 }

  res.json({imported:inserted, failed})
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
   .or("email_sent.eq.false,email_sent.is.null")
   .limit(500)

  if (error) {
   console.error("send fetch error", error)
   return res.status(500).json({ error: "server error" })
  }

  const rows = Array.isArray(data) ? data : []
  let sent = 0
  let failed = 0
  for(const r of rows){

   try{
    await sendMail(r.email,r.token)

    const { error: updateError } = await supabase
     .from("access_tokens")
     .update({
      email_sent:true,
      email_sent_at:new Date().toISOString(),
      email_error:null
     })
     .eq("id",r.id)

    if (updateError) console.error("send update error", r.email, updateError)
    sent += 1
   }catch(e){
    console.error("mail error",r.email,e)
    failed += 1
    await supabase
     .from("access_tokens")
     .update({ email_error: errorMessage(e) })
     .eq("id", r.id)
   }

  }

  res.json({processed:rows.length, sent, failed})
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
   .order("created_at",{ascending:false})
   .limit(1)
   .maybeSingle()

  if(error || !data) return res.status(404).json({error:"not found"})

  try {
   await sendMail(data.email,data.token)
  } catch (mailError) {
   await supabase
    .from("access_tokens")
    .update({ email_error: errorMessage(mailError) })
    .eq("id", data.id)
   return res.status(502).json({
    error: "mail provider error",
    details: errorMessage(mailError)
   })
  }

  await supabase
   .from("access_tokens")
   .update({
    email_sent:true,
    email_sent_at:new Date().toISOString(),
    email_error:null
   })
   .eq("id",data.id)

  res.json({success:true})
 } catch (error) {
  console.error("resend route error", error)
  return res.status(500).json({ error: "server error", details: errorMessage(error) })
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
  const sort=typeof req.query.sort==="string" ? req.query.sort : "last_import_desc"

  let query=supabase
   .from("access_tokens")
   .select("*",{count:"exact"})

  if(search) query=query.ilike("email",`%${search}%`)

  if(status==="sent") query=query.eq("email_sent",true)
  if(status==="activated") query=query.eq("used",true)

  if (sort === "last_import_asc") {
   query = query.order("created_at", { ascending: true })
  } else if (sort === "email_asc") {
   query = query.order("email", { ascending: true })
  } else if (sort === "email_desc") {
   query = query.order("email", { ascending: false })
  } else {
   query = query.order("created_at", { ascending: false })
  }

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
