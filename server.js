import express from "express"
import dotenv from "dotenv"
import helmet from "helmet"
import path from "path"
import session from "express-session"
import { fileURLToPath } from "url"

import adminApi from "./routes/adminApi.js"
import statsRoutes from "./routes/stats.js"
import authMiddleware from "./middleware/auth.js"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(helmet())
app.use(express.json())
app.use(express.urlencoded({extended:true}))

app.use(session({
 secret:process.env.SESSION_SECRET || "secret",
 resave:false,
 saveUninitialized:false
}))

app.use(express.static(path.join(__dirname,"public")))

app.get("/",(req,res)=>{
 res.redirect("/admin")
})

app.get("/login",(req,res)=>{
 res.sendFile(path.join(__dirname,"views/login.html"))
})

app.post("/login",(req,res)=>{

 const {password}=req.body

 if(password===process.env.ADMIN_PASSWORD){
  req.session.auth=true
  return res.redirect("/admin")
 }

 res.redirect("/login?error=1")
})

app.get("/admin",authMiddleware,(req,res)=>{
 res.sendFile(path.join(__dirname,"views/admin.html"))
})

app.use("/admin/api",authMiddleware,adminApi)
app.use("/stats",authMiddleware,statsRoutes)

app.get("/activate",(req,res)=>{
 res.sendFile(path.join(__dirname,"views/activate.html"))
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>console.log("Server running on",PORT))