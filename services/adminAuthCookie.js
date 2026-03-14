import crypto from "crypto"

const COOKIE_NAME = "discord_access_admin_auth"
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

function getSecret() {
 return process.env.SESSION_SECRET || ""
}

function base64url(value) {
 return Buffer.from(value).toString("base64url")
}

function sign(value) {
 return crypto
  .createHmac("sha256", getSecret())
  .update(value)
  .digest("base64url")
}

function timingSafeEqual(a, b) {
 const left = Buffer.from(String(a || ""))
 const right = Buffer.from(String(b || ""))
 if (left.length !== right.length) return false
 return crypto.timingSafeEqual(left, right)
}

export function createAdminAuthCookieValue() {
 const expiresAt = Date.now() + COOKIE_MAX_AGE_MS
 const payload = base64url(JSON.stringify({ exp: expiresAt }))
 const signature = sign(payload)
 return `${payload}.${signature}`
}

export function verifyAdminAuthCookieValue(value) {
 if (!value || typeof value !== "string" || !value.includes(".")) return false
 const [payload, signature] = value.split(".", 2)
 if (!payload || !signature) return false
 if (!timingSafeEqual(sign(payload), signature)) return false

 try {
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  return Number(decoded?.exp) > Date.now()
 } catch {
  return false
 }
}

export function parseCookies(cookieHeader) {
 const cookies = {}
 for (const part of String(cookieHeader || "").split(";")) {
  const trimmed = part.trim()
  if (!trimmed) continue
  const [name, ...rest] = trimmed.split("=")
  cookies[name] = decodeURIComponent(rest.join("=") || "")
 }
 return cookies
}

export function getAdminAuthCookieName() {
 return COOKIE_NAME
}

export function getAdminAuthCookieMaxAgeMs() {
 return COOKIE_MAX_AGE_MS
}
