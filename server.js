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

/* ================= DISCORD LOGIN ================= */

app.get("/login", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(403).send("Token manquant.");

  const { data } = await supabase
    .from("access_tokens")
    .select("*")
    .eq("token", token)
    .eq("used", false)
    .single();

  if (!data) return res.status(403).send("Token invalide.");

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

app.get("/callback", async (req, res) => {
  try {
    const { code, state: token } = req.query;

    const { data } = await supabase
      .from("access_tokens")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .single();

    if (!data) return res.status(403).send("Token invalide.");

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

    await axios.put(
      `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${user.id}`,
      { access_token: accessToken },
      { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
    );

    await axios.put(
      `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${user.id}/roles/${process.env.ROLE_ID}`,
      {},
      { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
    );

    await supabase
      .from("access_tokens")
      .update({
        used: true,
        discord_id: user.id,
        used_at: new Date().toISOString()
      })
      .eq("token", token);

    res.redirect(`https://discord.com/channels/${process.env.GUILD_ID}/${process.env.CHANNEL_ID}`);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Erreur activation.");
  }
});

/* ================= ADMIN ================= */

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

/* ================= API ================= */

app.get("/admin/api/data", requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from("access_tokens")
    .select("*")
    .order("created_at", { ascending: false });

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

app.post("/admin/send-emails", requireAdmin, async (req, res) => {

  const { data: pending } = await supabase
    .from("access_tokens")
    .select("*")
    .eq("email_sent", false)
    .limit(50);

  for (const row of pending) {

    const activationLink =
      `https://discord-oauth-ulule.onrender.com/login?token=${row.token}`;

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        to: [{ email: row.email }],
        templateId: 130,
        params: { activation_link: activationLink }
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    await supabase
      .from("access_tokens")
      .update({ email_sent: true })
      .eq("id", row.id);
  }

  res.json({ success: true });
});

app.post("/admin/resend-emails", requireAdmin, async (req, res) => {

  const { data: pending } = await supabase
    .from("access_tokens")
    .select("*")
    .eq("used", false)
    .eq("email_sent", true)
    .limit(50);

  for (const row of pending) {

    const activationLink =
      `https://discord-oauth-ulule.onrender.com/login?token=${row.token}`;

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        to: [{ email: row.email }],
        templateId: 130,
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

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
