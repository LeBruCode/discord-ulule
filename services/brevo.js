import axios from "axios"

const BREVO_API_BASE = "https://api.brevo.com/v3"
const BREVO_MIN_INTERVAL_MS = 650
let lastBrevoRequestAt = 0

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

function getRateLimitResetMs(error) {
 const resetHeader = error?.response?.headers?.["x-sib-ratelimit-reset"]
 const resetSeconds = Number(resetHeader)
 if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) return 0
 return Math.ceil(resetSeconds * 1000)
}

function sleep(ms) {
 return new Promise((resolve) => setTimeout(resolve, ms))
}

async function throttleBrevoRequest() {
 const now = Date.now()
 const waitMs = Math.max(0, BREVO_MIN_INTERVAL_MS - (now - lastBrevoRequestAt))
 if (waitMs > 0) await sleep(waitMs)
 lastBrevoRequestAt = Date.now()
}

async function brevoGet(url, params = {}, maxRetries = 4) {
 let attempt = 0
 let lastError = null

 while (attempt <= maxRetries) {
  try {
   await throttleBrevoRequest()
   const response = await axios.get(url, {
    headers: brevoHeaders(),
    params
   })
   return response.data || {}
  } catch (error) {
   lastError = error
   const status = error?.response?.status
   const shouldRetry = status === 429 || status === 500 || status === 502 || status === 503 || status === 504
   if (!shouldRetry || attempt === maxRetries) break

   const resetMs = getRateLimitResetMs(error)
   const backoffMs = 800 * (2 ** attempt)
   const jitterMs = Math.floor(Math.random() * 250)
   await sleep(Math.max(resetMs, backoffMs) + jitterMs)
   attempt += 1
  }
 }

 throw lastError
}

export async function getTransactionalEmails(params = {}) {
 return brevoGet(`${BREVO_API_BASE}/smtp/emails`, params)
}

export async function getTransactionalEmailDetail(uuid) {
 return brevoGet(`${BREVO_API_BASE}/smtp/emails/${encodeURIComponent(uuid)}`)
}
