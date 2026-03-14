import axios from "axios"

export async function sendMail(email, token, metadata = {}){
 if (!process.env.BREVO_API_KEY) throw new Error("BREVO_API_KEY is missing")
 if (!process.env.BREVO_TEMPLATE_ID) throw new Error("BREVO_TEMPLATE_ID is missing")
 if (!process.env.PUBLIC_URL) throw new Error("PUBLIC_URL is missing")

 const link = `${process.env.PUBLIC_URL}/activate?token=${token}`
 const accessTokenId = metadata.accessTokenId ? String(metadata.accessTokenId) : null

 const templateId = Number(process.env.BREVO_TEMPLATE_ID)
 if (!Number.isFinite(templateId)) throw new Error("BREVO_TEMPLATE_ID must be a number")

 try {
  const response = await axios.post(
   "https://api.brevo.com/v3/smtp/email",
   {
    to:[{email}],
    templateId,
    params:{activation_link:link},
    tags: accessTokenId ? [`access-token:${accessTokenId}`] : undefined
   },
   {
    headers:{
     "api-key":process.env.BREVO_API_KEY,
     "Content-Type":"application/json"
    }
   }
  )
  return response.data || {}
 } catch (error) {
  const status = error?.response?.status
  const providerMessage =
   error?.response?.data?.message ||
   error?.response?.data?.code ||
   error?.message ||
   "unknown provider error"
  throw new Error(`Brevo error${status ? ` (${status})` : ""}: ${providerMessage}`)
 }

}
