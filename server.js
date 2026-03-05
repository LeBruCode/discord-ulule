
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
app.set("trust proxy", 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.redirect("/admin/login");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* ---------------- DISCORD QUEUE ---------------- */
/* prevents hitting global rate limits */

const discordQueue = [];
let queueRunning = false;

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (discordQueue.length > 0) {
    const job = discordQueue.shift();

    try {
      await job();
    } catch (err) {
      console.error("Discord job error:", err.response?.data || err.message);
    }

    await new Promise(r => setTimeout(r, 300)); 
    // ~3 requests/sec safe margin
  }

  queueRunning = false;
}

function enqueueDiscordJob(fn) {
  discordQueue.push(fn);
  processQueue();
}

/* ---------------- DISCORD LOGIN ---------------- */

app.get("/login", async (req, res) => {

  const token = req.query.token;
  if (!token) return res.status(403).send("Token manquant.");

  const { data } = await supabase
    .from("access_tokens")
    .select("*")
    .eq("token", token)
    .single();

  if (!data || data.used) {
    return res.status(403).send("Token invalide.");
  }

  const redirect = encodeURIComponent(process.env.REDIRECT_URI);

  const url =
    "https://discord.com/oauth2/authorize" +
    `?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${redirect}` +
    `&response_type=code` +
    `&scope=identify guilds.join` +
    `&state=${token}`;

  res.redirect(url);
});

/* ---------------- CALLBACK ---------------- */

app.get("/callback", async (req, res) => {

  try {

    const { code, state: token } = req.query;

    const { data } = await supabase
      .from("access_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (!data || data.used) {
      return res.send("Lien déjà utilisé.");
    }

    const params = new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.REDIRECT_URI
    });

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      params.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const user = userRes.data;

    /* atomic token usage */
    const { data: updateCheck } = await supabase
      .from("access_tokens")
      .update({
        used: true,
        discord_id: user.id,
        used_at: new Date().toISOString()
      })
      .eq("token", token)
      .eq("used", false)
      .select();

    if (!updateCheck || updateCheck.length === 0) {
      return res.send("Lien déjà utilisé.");
    }

    enqueueDiscordJob(async () => {

      await axios.put(
        `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${user.id}`,
        {
          access_token: accessToken,
          roles: [process.env.ROLE_ID]
        },
        {
          headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }
        }
      );

    });

    res.redirect(
      `https://discord.com/channels/${process.env.GUILD_ID}/${process.env.CHANNEL_ID}`
    );

  } catch (err) {

    console.error("Discord error:", err.response?.data || err.message);
    res.status(500).send("Erreur activation.");

  }

});

/* ---------------- ADMIN ---------------- */

app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views/login.html"));
});

app.post("/admin/login", (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect("/admin");
  }
  res.send("Mot de passe incorrect.");
});

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views/admin.html"));
});

/* ---------------- API ---------------- */

app.get("/admin/api/list", requireAdmin, async (req, res) => {

  const { data } = await supabase
    .from("access_tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  res.json({ data });

});

app.post("/admin/import", requireAdmin, async (req, res) => {

  const emails = req.body.emails
    .split("\n")
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 3);

  for (const email of emails) {

    await supabase.from("access_tokens").insert({
      email,
      token: generateToken(),
      used: false,
      email_sent: false
    });

  }

  res.redirect("/admin");

});

/* ---------------- EMAILS ---------------- */

async function sendActivation(email, token) {

  const activationLink =
    `${process.env.PUBLIC_URL}/login?token=${token}`;

  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      to: [{ email }],
      templateId: Number(process.env.BREVO_TEMPLATE_ID),
      params: { activation_link: activationLink }
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

}

app.post("/admin/send-emails", requireAdmin, async (req, res) => {

  const { data } = await supabase
    .from("access_tokens")
    .select("*")
    .eq("email_sent", false)
    .limit(50);

  for (const row of data) {

    try {

      await sendActivation(row.email, row.token);

      await supabase
        .from("access_tokens")
        .update({ email_sent: true })
        .eq("id", row.id);

    } catch (err) {

      console.error("Email error:", err.response?.data || err.message);

    }

  }

  res.json({ success: true });

});

app.post("/admin/resend-emails", requireAdmin, async (req, res) => {

  const { data } = await supabase
    .from("access_tokens")
    .select("*")
    .eq("used", false)
    .eq("email_sent", true)
    .limit(50);

  for (const row of data) {

    await sendActivation(row.email, row.token);

  }

  res.json({ success: true });

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});


app.post("/admin/delete-all", requireAdmin, async (req,res)=>{

  await supabase
    .from("access_tokens")
    .delete()
    .neq("id",0)

  res.json({success:true})

})

app.post("/admin/delete-selected", requireAdmin, async (req,res)=>{

  const ids=req.body.ids||[]

  if(ids.length===0) return res.json({success:true})

  await supabase
    .from("access_tokens")
    .delete()
    .in("id",ids)

  res.json({success:true})

})


/* ---- EXPORT ACTIVATED CSV ---- */

app.get("/admin/export-activated", requireAdmin, async (req,res)=>{

 const { data } = await supabase
  .from("access_tokens")
  .select("*")
  .eq("used",true)

 let csv="email,activated_at\n"

 data.forEach(r=>{
  csv+=`${r.email},${r.used_at}\n`
 })

 res.setHeader("Content-Type","text/csv")
 res.send(csv)

})

/* ---- RESEND SINGLE EMAIL ---- */

app.post("/admin/resend-one/:id", requireAdmin, async (req,res)=>{

 const id=req.params.id

 const { data } = await supabase
  .from("access_tokens")
  .select("*")
  .eq("id",id)
  .single()

 if(!data) return res.json({})

 const activationLink=`${process.env.PUBLIC_URL}/login?token=${data.token}`

 await axios.post(
  "https://api.brevo.com/v3/smtp/email",
  {
   to:[{email:data.email}],
   templateId:Number(process.env.BREVO_TEMPLATE_ID),
   params:{activation_link:activationLink}
  },
  {
   headers:{
    "api-key":process.env.BREVO_API_KEY,
    "Content-Type":"application/json"
   }
  }
 )

 res.json({success:true})

})

/* ================= PAGINATED LIST ================= */

app.get("/admin/api/list", requireAdmin, async (req,res)=>{

 const page=parseInt(req.query.page||"1")
 const limit=parseInt(req.query.limit||"50")

 const start=(page-1)*limit
 const end=start+limit-1

 const {data,count}=await supabase
  .from("access_tokens")
  .select("*",{count:"exact"})
  .order("created_at",{ascending:false})
  .range(start,end)

 res.json({data,total:count})

})

/* ================= STATS ================= */

app.get("/admin/api/stats", requireAdmin, async (req,res)=>{

 const {count:total}=await supabase
  .from("access_tokens")
  .select("*",{count:"exact",head:true})

 const {count:activated}=await supabase
  .from("access_tokens")
  .select("*",{count:"exact",head:true})
  .eq("used",true)

 const {data:timeline}=await supabase
  .from("access_tokens")
  .select("used_at")
  .not("used_at","is",null)

 res.json({total,activated,timeline})

})


/* ================= SEND ALL EMAILS BATCH ================= */

app.post("/admin/send-all", requireAdmin, async (req,res)=>{

 let processed=0

 while(true){

  const {data}=await supabase
   .from("access_tokens")
   .select("*")
   .eq("email_sent",false)
   .limit(100)

  if(!data || data.length===0) break

  for(const row of data){

   const activationLink=`${process.env.PUBLIC_URL}/login?token=${row.token}`

   try{

    await axios.post(
     "https://api.brevo.com/v3/smtp/email",
     {
      to:[{email:row.email}],
      templateId:Number(process.env.BREVO_TEMPLATE_ID),
      params:{activation_link:activationLink}
     },
     {
      headers:{
       "api-key":process.env.BREVO_API_KEY,
       "Content-Type":"application/json"
      }
     }
    )

    await supabase
     .from("access_tokens")
     .update({email_sent:true})
     .eq("id",row.id)

    processed++

   }catch(err){
    console.error("email error",row.email,err.response?.data||err.message)
   }

  }

 }

 res.json({processed})

})
