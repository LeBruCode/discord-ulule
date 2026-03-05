
import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import session from "express-session";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

app.use(session({
  secret:process.env.SESSION_SECRET || "dev-secret",
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true}
}));

const supabase=createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_KEY
);

function requireAdmin(req,res,next){
 if(req.session?.isAdmin) return next();
 res.redirect("/admin/login");
}

function generateToken(){
 return crypto.randomBytes(32).toString("hex");
}

/* LOGIN */

app.get("/admin/login",(req,res)=>{
 res.sendFile(path.join(__dirname,"views/login.html"));
});

app.post("/admin/login",(req,res)=>{
 if(req.body.password===process.env.ADMIN_PASSWORD){
  req.session.isAdmin=true;
  return res.redirect("/admin");
 }
 res.send("Wrong password");
});

app.get("/admin",requireAdmin,(req,res)=>{
 res.sendFile(path.join(__dirname,"views/admin.html"));
});

/* LIST EMAILS WITH PAGINATION */

app.get("/admin/api/list",requireAdmin,async(req,res)=>{

 try{

  const page=parseInt(req.query.page || 1);
  const limit=parseInt(req.query.limit || 50);

  const start=(page-1)*limit;
  const end=start+limit-1;

  const {data,count}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact"})
   .order("id",{ascending:false})
   .range(start,end);

  res.json({data,total:count});

 }catch(err){
  console.error(err);
  res.status(500).json({error:"list error"});
 }

});

/* STATS */

app.get("/admin/api/stats",requireAdmin,async(req,res)=>{

 try{

  const {count:total}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true});

  const {count:activated}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .eq("used",true);

  const {count:sent}=await supabase
   .from("access_tokens")
   .select("*",{count:"exact",head:true})
   .eq("email_sent",true);

  res.json({total,activated,sent});

 }catch(err){
  console.error(err);
  res.status(500).json({error:"stats error"});
 }

});

/* IMPORT */

app.post("/admin/import",requireAdmin,async(req,res)=>{

 try{

  const emails=req.body.emails
   .split("\n")
   .map(e=>e.trim().toLowerCase())
   .filter(e=>e.length>3);

  for(const email of emails){

   await supabase.from("access_tokens").insert({
    email,
    token:generateToken(),
    used:false,
    email_sent:false
   });

  }

  res.redirect("/admin");

 }catch(err){
  console.error(err);
  res.status(500).send("import error");
 }

});

/* EMAIL FUNCTION */

async function sendActivation(email,token){

 const link=`${process.env.PUBLIC_URL}/login?token=${token}`;

 await axios.post(
  "https://api.brevo.com/v3/smtp/email",
  {
   to:[{email}],
   templateId:Number(process.env.BREVO_TEMPLATE_ID),
   params:{activation_link:link}
  },
  {
   headers:{
    "api-key":process.env.BREVO_API_KEY,
    "Content-Type":"application/json"
   }
  }
 );

}

/* SEND NEW EMAILS (batch) */

app.post("/admin/api/send-all",requireAdmin,async(req,res)=>{

 try{

  const {data}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("email_sent",false)
   .limit(100);

  for(const row of data){

   try{

    await sendActivation(row.email,row.token);

    await supabase
     .from("access_tokens")
     .update({email_sent:true})
     .eq("id",row.id);

   }catch(e){
    console.error("email error",e.message);
   }

  }

  res.json({success:true});

 }catch(err){
  console.error(err);
  res.status(500).json({error:"send error"});
 }

});

/* RESEND */

app.post("/admin/api/resend/:id",requireAdmin,async(req,res)=>{

 try{

  const id=req.params.id;

  const {data}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("id",id)
   .single();

  if(!data) return res.json({});

  await sendActivation(data.email,data.token);

  res.json({success:true});

 }catch(err){
  console.error(err);
  res.status(500).json({error:"resend error"});
 }

});

/* DELETE */

app.post("/admin/api/delete-all",requireAdmin,async(req,res)=>{

 try{

  await supabase.from("access_tokens")
   .delete()
   .not("id","is",null);

  res.json({success:true});

 }catch(err){
  console.error(err);
  res.status(500).json({error:"delete error"});
 }

});

app.post("/admin/api/delete-selected",requireAdmin,async(req,res)=>{

 try{

  const ids=req.body.ids || [];

  if(ids.length===0) return res.json({});

  await supabase
   .from("access_tokens")
   .delete()
   .in("id",ids);

  res.json({success:true});

 }catch(err){
  console.error(err);
  res.status(500).json({error:"delete error"});
 }

});

/* EXPORT */

app.get("/admin/api/export",requireAdmin,async(req,res)=>{

 try{

  const {data}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("used",true);

  let csv="email,used_at\n";

  data.forEach(r=>{
   csv+=`${r.email},${r.used_at}\n`;
  });

  res.setHeader("Content-Type","text/csv");
  res.send(csv);

 }catch(err){
  console.error(err);
  res.status(500).send("export error");
 }

});

const PORT=process.env.PORT || 3000;
app.listen(PORT,()=>console.log("Server running on",PORT));
