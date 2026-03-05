import express from "express"
import session from "express-session"
import dotenv from "dotenv"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import path from "path"
import { fileURLToPath } from "url"

import adminRoutes from "./routes/admin.js"
import statsRoutes from "./routes/stats.js"

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(helmet())
app.use(express.json())
app.use(express.urlencoded({extended:true}))

app.use(rateLimit({
 windowMs:60*1000,
 max:200
}))

app.use(session({
 secret:process.env.SESSION_SECRET,
 resave:false,
 saveUninitialized:false
}))

app.use(express.static(path.join(__dirname,"public")))

app.get("/",(req,res)=>{
 res.sendFile(path.join(__dirname,"views/admin.html"))
})

app.use("/admin",adminRoutes)
app.use("/stats",statsRoutes)

const PORT=process.env.PORT||3000
app.listen(PORT,()=>console.log("running "+PORT))