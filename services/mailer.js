import axios from "axios"

export async function sendMail(email,token){

 const link = `${process.env.PUBLIC_URL}/login?token=${token}`

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
 )

}