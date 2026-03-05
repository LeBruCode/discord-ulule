import { Queue,Worker } from "bullmq"
import IORedis from "ioredis"
import { sendMail } from "../services/mailer.js"
import { supabase } from "../services/supabase.js"

/*
IMPORTANT FIX FOR RENDER + BULLMQ
maxRetriesPerRequest must be null
enableReadyCheck false prevents startup issues on managed Redis
*/

const connection = new IORedis(process.env.REDIS_URL, {
 maxRetriesPerRequest: null,
 enableReadyCheck: false
})

export const mailQueue = new Queue("mail", { connection })

export const worker = new Worker(
 "mail",
 async job => {

  const {email,token,id} = job.data

  try{

   await sendMail(email,token)

   await supabase
    .from("access_tokens")
    .update({email_sent:true})
    .eq("id",id)

  }catch(e){

   console.error("Mail failed:", email, e.message)

  }

 },
 {
  connection,
  concurrency: 10
 }
)