import express from "express"
import crypto from "crypto"
import dotenv from "dotenv"
import fs from "fs/promises"
import helmet from "helmet"
import path from "path"
import pg from "pg"
import session from "express-session"
import { fileURLToPath } from "url"
import vm from "vm"
import connectPgSimple from "connect-pg-simple"

import adminApi from "./routes/adminApi.js"
import statsRoutes from "./routes/stats.js"
import publicApi from "./routes/publicApi.js"
import authMiddleware from "./middleware/auth.js"
import { startDiscordMemberLeaveListener } from "./services/discordBot.js"
import { startUluleSyncScheduler } from "./services/ululeSync.js"
import {
 createAdminAuthCookieValue,
 getAdminAuthCookieMaxAgeMs,
 getAdminAuthCookieName
} from "./services/adminAuthCookie.js"
import { supabase } from "./services/supabase.js"

dotenv.config()

const requiredEnvs = [
 "SUPABASE_URL",
 "SUPABASE_SERVICE_KEY",
 "ADMIN_PASSWORD",
 "SESSION_SECRET"
]

const missingEnvs = requiredEnvs.filter((name) => !process.env[name])
if (missingEnvs.length) {
 throw new Error(`Missing required env vars: ${missingEnvs.join(", ")}`)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set("trust proxy", 1)

const isProd = process.env.NODE_ENV === "production"
const loginAttempts = new Map()
const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 7
const adminAuthCookieName = getAdminAuthCookieName()
const adminAuthCookieMaxAgeMs = getAdminAuthCookieMaxAgeMs()
const APP_SETTINGS_TABLE = "app_settings"
const DASHBOARD_BRANDING_KEY = "dashboard_branding"
const DASHBOARD_COPY_KEY = "dashboard_copy"
const dashboardCopyFilePath = path.join(__dirname, "public", "js", "dashboardCopy.js")
const PgSession = connectPgSimple(session)

function getSessionDatabaseUrl() {
 return String(process.env.SESSION_DATABASE_URL || process.env.DATABASE_URL || "").trim()
}

function shouldUseSessionSsl(connectionString) {
 if (!connectionString) return false
 return connectionString.includes("supabase.co") || connectionString.includes("sslmode=require")
}

function buildSessionStore() {
 const connectionString = getSessionDatabaseUrl()
 if (!connectionString) {
  console.warn("Session store fallback: SESSION_DATABASE_URL/DATABASE_URL missing, using MemoryStore")
  return undefined
 }

 const pool = new pg.Pool({
  connectionString,
  max: 5,
  ssl: shouldUseSessionSsl(connectionString) ? { rejectUnauthorized: false } : false
 })

  pool.on("error", (error) => {
  console.error("session pool error", error)
 })

 return new PgSession({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: true
 })
}

function safeEqualText(a, b) {
 const left = Buffer.from(String(a || ""), "utf8")
 const right = Buffer.from(String(b || ""), "utf8")
 if (left.length !== right.length) return false
 return crypto.timingSafeEqual(left, right)
}

async function readPublicBranding() {
 try {
  const { data, error } = await supabase
   .from(APP_SETTINGS_TABLE)
   .select("value,updated_at")
   .eq("key", DASHBOARD_BRANDING_KEY)
   .maybeSingle()

  if (error) throw error
  const value = data?.value || {}
  return {
   logoPath: typeof value.logoPath === "string" ? value.logoPath : null,
   logoDataUrl: typeof value.logoDataUrl === "string" ? value.logoDataUrl : null,
   logoWidth: Number.isFinite(Number(value.logoWidth)) ? Number(value.logoWidth) : 96,
   updatedAt: value.updatedAt || data?.updated_at || null
  }
 } catch (error) {
  console.warn("server landing branding read skipped", error?.message || error)
  return { logoPath: null, logoDataUrl: null, logoWidth: 96, updatedAt: null }
 }
}

async function readPublicCopyDefaults() {
 try {
  const source = await fs.readFile(dashboardCopyFilePath, "utf8")
  const context = { window: {} }
  vm.createContext(context)
  vm.runInContext(source, context)
  return context.window?.DASHBOARD_COPY || {}
 } catch (error) {
  console.warn("server landing copy defaults read skipped", error?.message || error)
  return {}
 }
}

async function readPublicCopy() {
 const defaults = await readPublicCopyDefaults()

 try {
  const { data, error } = await supabase
   .from(APP_SETTINGS_TABLE)
   .select("value")
   .eq("key", DASHBOARD_COPY_KEY)
   .maybeSingle()

  if (error) throw error
  if (data?.value && typeof data.value === "object") {
   return { ...defaults, ...data.value }
  }
 } catch (error) {
  console.warn("server landing copy read skipped", error?.message || error)
 }

 return defaults
}

function buildBrandingAssetUrl(branding = {}) {
 const rawSource = branding.logoDataUrl || branding.logoPath || ""
 if (!rawSource) return ""
 if (/^data:/i.test(rawSource)) return rawSource
 const updatedAt = branding.updatedAt || null
 return updatedAt ? `${rawSource}?v=${encodeURIComponent(updatedAt)}` : rawSource
}

app.use(helmet())
app.use(express.json({ limit: "2mb" }))
app.use(express.urlencoded({ extended: true, limit: "2mb" }))

app.use(session({
 name:"discord_access_admin",
 secret:process.env.SESSION_SECRET,
 store: buildSessionStore(),
 proxy: isProd,
 resave:false,
 saveUninitialized:false,
 rolling:true,
 cookie: {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  maxAge: sessionMaxAgeMs
 }
}))

app.use(express.static(path.join(__dirname,"public")))

app.get("/", async (req,res)=>{
 try {
  const landingTemplate = await fs.readFile(path.join(__dirname, "views", "landing.html"), "utf8")
  const branding = await readPublicBranding()
  const copy = await readPublicCopy()
  const logoUrl = buildBrandingAssetUrl(branding)
  const serializedCopy = JSON.stringify(copy)
   .replaceAll("</script>", "<\\/script>")
  const html = landingTemplate
   .replaceAll("__LANDING_LOGO_SRC__", logoUrl || "")
   .replaceAll("__LANDING_LOGO_CLASS__", logoUrl ? "" : "hidden")
   .replaceAll("__LANDING_LOGO_WIDTH__", String(Number(branding.logoWidth) || 96))
   .replaceAll("__LANDING_COPY_JSON__", serializedCopy)

  res.setHeader("Cache-Control", "no-store")
  res.send(html)
 } catch (error) {
  console.error("landing page render error", error)
  res.sendFile(path.join(__dirname,"views/landing.html"))
 }
})

app.get("/login",(req,res)=>{
 res.setHeader("Cache-Control", "no-store")
 res.setHeader("Pragma", "no-cache")
 res.setHeader("Expires", "0")
 res.sendFile(path.join(__dirname,"views/login.html"))
})

app.post("/login",(req,res)=>{
 const ip = req.ip || "unknown"
 const now = Date.now()
 const windowMs = 10 * 60 * 1000
 const maxAttempts = 10
 const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs }
 if (now > entry.resetAt) {
  entry.count = 0
  entry.resetAt = now + windowMs
 }
 if (entry.count >= maxAttempts) return res.status(429).send("Too many login attempts")

 const {password}=req.body
 if (typeof password !== "string") return res.redirect("/login?error=1")

 if(safeEqualText(password, process.env.ADMIN_PASSWORD)){
  loginAttempts.delete(ip)
  return req.session.regenerate((err) => {
   if (err) {
    console.error("session regenerate error", err)
    return res.status(500).send("Session error")
   }
   req.session.auth = true
   req.session.save((saveErr) => {
    if (saveErr) {
     console.error("session save error", saveErr)
     return res.status(500).send("Session error")
    }
    res.cookie(adminAuthCookieName, createAdminAuthCookieValue(), {
     httpOnly: true,
     secure: isProd,
     sameSite: "lax",
     maxAge: adminAuthCookieMaxAgeMs,
     path: "/"
    })
    return res.redirect("/admin")
   })
  })
 }

 entry.count += 1
 loginAttempts.set(ip, entry)
 res.redirect("/login?error=1")
})

app.get("/admin",authMiddleware,(req,res)=>{
 res.setHeader("Cache-Control", "no-store")
 res.setHeader("Pragma", "no-cache")
 res.setHeader("Expires", "0")
 res.sendFile(path.join(__dirname,"views/admin.html"))
})

app.post("/logout", authMiddleware, (req, res) => {
 req.session.destroy(() => {
  res.clearCookie("discord_access_admin")
  res.clearCookie(adminAuthCookieName)
  res.redirect("/login")
 })
})

app.use("/admin/api",authMiddleware,adminApi)
app.use("/stats",authMiddleware,statsRoutes)
app.use("/api", publicApi)
app.get("/callback", (req, res) => {
 const params = new URLSearchParams(req.query).toString()
 const suffix = params ? `?${params}` : ""
 return res.redirect(`/api/callback${suffix}`)
})

app.get("/activate",(req,res)=>{
 res.sendFile(path.join(__dirname,"views/activate.html"))
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>{
 console.log("Server running on",PORT)
 startDiscordMemberLeaveListener()
 startUluleSyncScheduler()
})
