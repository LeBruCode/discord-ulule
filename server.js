import express from "express"
import dotenv from "dotenv"
import helmet from "helmet"
import path from "path"
import session from "express-session"
import { fileURLToPath } from "url"

import adminApi from "./routes/adminApi.js"
import statsRoutes from "./routes/stats.js"
import publicApi from "./routes/publicApi.js"
import authMiddleware from "./middleware/auth.js"

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

app.use(helmet())
app.use(express.json())
app.use(express.urlencoded({extended:true}))

app.use(session({
 secret:process.env.SESSION_SECRET,
 resave:false,
 saveUninitialized:false,
 cookie: {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  maxAge: 1000 * 60 * 60 * 8
 }
}))

app.use(express.static(path.join(__dirname,"public")))

app.get("/",(req,res)=>{
 res.redirect("/admin")
})

app.get("/login",(req,res)=>{
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

 if(password===process.env.ADMIN_PASSWORD){
  loginAttempts.delete(ip)
  req.session.auth=true
  return res.redirect("/admin")
 }

 entry.count += 1
 loginAttempts.set(ip, entry)
 res.redirect("/login?error=1")
})

app.get("/admin",authMiddleware,(req,res)=>{
 res.sendFile(path.join(__dirname,"views/admin.html"))
})

app.post("/logout", authMiddleware, (req, res) => {
 req.session.destroy(() => {
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
app.listen(PORT,()=>console.log("Server running on",PORT))
