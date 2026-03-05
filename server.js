
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import session from "express-session";
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
 secret: process.env.SESSION_SECRET || "dev",
 resave:false,
 saveUninitialized:false,
 cookie:{httpOnly:true}
}));

function requireAdmin(req,res,next){
 if(req.session?.isAdmin) return next();
 res.redirect("/admin/login");
}

const supabase=createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_KEY
);

function token(){
 return crypto.randomBytes(32).toString("hex");
}

/* ===== LOGIN ===== */

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

/* ===== LIST ===== */

app.get("/admin/api/list",requireAdmin,async(req,res)=>{

 const page=parseInt(req.query.page||1);
 const limit=parseInt(req.query.limit||50);

 const start=(page-1)*limit;
 const end=start+limit-1;

 const {data,count}=await supabase
  .from("access_tokens")
  .select("*",{count:"exact"})
  .order("id",{ascending:false})
  .range(start,end);

 res.json({data,total:count});
});

/* ===== STATS ===== */

app.get("/admin/api/stats",requireAdmin,async(req,res)=>{

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
});

/* ===== IMPORT ===== */

app.post("/admin/import",requireAdmin,async(req,res)=>{

 const emails=req.body.emails
  .split("\n")
  .map(e=>e.trim().toLowerCase())
  .filter(e=>e.length>3);

 for(const email of emails){

  await supabase.from("access_tokens").insert({
   email,
   token:token(),
   used:false,
   email_sent:false
  });

 }

 res.redirect("/admin");
});

/* ===== EMAIL ===== */

async function sendActivation(email,tokenValue){

 const link=`${process.env.PUBLIC_URL}/login?token=${tokenValue}`;

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

/* ===== PARALLEL SENDER ===== */

const CONCURRENCY = 10;

async function sendBatch(rows){

 const chunks=[];
 for(let i=0;i<rows.length;i+=CONCURRENCY){
  chunks.push(rows.slice(i,i+CONCURRENCY));
 }

 for(const chunk of chunks){

  await Promise.all(chunk.map(async row=>{

   try{

    await sendActivation(row.email,row.token);

    await supabase
     .from("access_tokens")
     .update({email_sent:true})
     .eq("id",row.id);

   }catch(e){
    console.error("email error",row.email,e.message);
   }

  }));

 }

}

/* ===== SEND ALL ===== */

app.post("/admin/send-all",requireAdmin,async(req,res)=>{

 let processed=0;

 while(true){

  const {data}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("email_sent",false)
   .limit(200);

  if(!data || data.length===0) break;

  await sendBatch(data);

  processed+=data.length;

 }

 res.json({processed});
});

/* ===== DELETE ===== */

app.post("/admin/delete-all",requireAdmin,async(req,res)=>{

 await supabase
  .from("access_tokens")
  .delete()
  .not("id","is",null);

 res.json({success:true});
});

app.post("/admin/delete-selected",requireAdmin,async(req,res)=>{

 const ids=req.body.ids||[];

 if(ids.length===0) return res.json({});

 await supabase
  .from("access_tokens")
  .delete()
  .in("id",ids);

 res.json({success:true});
});

/* ===== EXPORT ===== */

app.get("/admin/export",requireAdmin,async(req,res)=>{

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
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log("Server running"));
