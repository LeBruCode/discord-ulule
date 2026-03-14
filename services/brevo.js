import axios from "axios"

const BREVO_API_BASE = "https://api.brevo.com/v3"

function getBrevoApiKey() {
 const apiKey = String(process.env.BREVO_API_KEY || "").trim()
 if (!apiKey) throw new Error("BREVO_API_KEY is missing")
 return apiKey
}

function brevoHeaders() {
 return {
  "api-key": getBrevoApiKey()
 }
}

export function normalizeBrevoEventStatus(value) {
 const status = String(value || "").trim().toLowerCase()
 if (!status) return null
 if (status === "invalid_email") return "invalid"
 return status
}

export async function getTransactionalEmails(params = {}) {
 const response = await axios.get(`${BREVO_API_BASE}/smtp/emails`, {
  headers: brevoHeaders(),
  params
 })
 return response.data || {}
}

export async function getTransactionalEmailDetail(uuid) {
 const response = await axios.get(`${BREVO_API_BASE}/smtp/emails/${encodeURIComponent(uuid)}`, {
  headers: brevoHeaders()
 })
 return response.data || {}
}
