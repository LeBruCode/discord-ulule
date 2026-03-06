import express from "express"
import crypto from "crypto"
import { supabase } from "../services/supabase.js"
import { sendMail } from "../services/mailer.js"

const router = express.Router()

function token(){
 return crypto.randomBytes(32).toString("hex")
}

router.post("/import",async(req,res)=>{

 const emails=req.body.emails.split("\n").map(e=>e.trim()).filter(e=>e)

 for(const email of emails){

  await supabase.from("access_tokens").insert({
   email,
   token:token(),
   used:false,
   email_sent:false,
   expires_at:new Date(Date.now()+1000*60*60*24*7) // 7 days
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

router.post("/resend",async(req,res)=>{

 const {email}=req.body

 const {data}=await supabase
  .from("access_tokens")
  .select("*")
  .eq("email",email)
  .single()

 if(!data) return res.status(404).json({error:"not found"})

 await sendMail(data.email,data.token)

 res.json({success:true})
})

router.get("/list", async (req,res)=>{

 const page = parseInt(req.query.page) || 1
 const limit = parseInt(req.query.limit) || 50
 const search = req.query.search || ""
 const status = req.query.status || "all"
 const sort = req.query.sort || "id"
 const order = req.query.order || "desc"

 let query = supabase
  .from("access_tokens")
  .select("*",{count:"exact"})
  .order(sort,{ascending:order==="asc"})

 if(search){
  query = query.ilike("email", `%${search}%`)
 }

 if(status==="sent"){
  query = query.eq("email_sent",true)
 }

 if(status==="activated"){
  query = query.eq("used",true)
 }

 const start = (page-1)*limit
 const end = start + limit - 1

 const {data,count} = await query.range(start,end)

 res.json({data,total:count})

})

router.post("/activate",async(req,res)=>{

 const {token}=req.body

 const {data}=await supabase
  .from("access_tokens")
  .select("*")
  .eq("token",token)
  .single()

 if(!data) return res.json({success:false})

 if(data.used) return res.json({success:false,message:"already used"})

 if(new Date(data.expires_at)<new Date())
  return res.json({success:false,message:"expired"})

 await supabase
  .from("access_tokens")
  .update({used:true})
  .eq("id",data.id)

 res.json({success:true})
})

export default router
