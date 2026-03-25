import crypto from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import { supabase } from "./supabase.js"
import { sendMail } from "./mailer.js"
import { removeDiscordMemberFromGuild } from "./discordBot.js"

const execFileAsync = promisify(execFile)
const APP_SETTINGS_TABLE = "app_settings"
const ULULE_SYNC_STATE_KEY = "ulule_sync_state"
const ULULE_IMPORTS_TABLE = "ulule_imports"
const ACCESS_TOKENS_TABLE = "access_tokens"
const ULULE_DEFAULT_PROJECT_ID = "216296"
const ULULE_INITIAL_SYNC_AT = "2026-03-15T00:00:00.000Z"
const ULULE_SYNC_INTERVAL_MS = 15 * 60 * 1000
const ULULE_API_BASE = "https://api.ulule.com/v1"
const ULULE_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
const DEFAULT_ELIGIBLE_REWARD_IDS = [
  5300152, 5314639, 5302261, 5314642, 5314645, 5302262, 5314649,
  5302314, 5304319, 5341221, 5302827, 5305328, 5302813
]
const KNOWN_ULULE_REWARD_LABELS = {
  5300152: "PACK RÉGIE",
  5314639: "PACK RÉGIE",
  5302261: "PACK SCÉNARISTE",
  5314642: "PACK SCÉNARISTE",
  5302262: "PACK MONTAGE",
  5314645: "PACK MONTAGE",
  5302314: "PACK STYLISME",
  5314649: "PACK STYLISME",
  5304319: "PACK SCRIPTE",
  5302813: "PACK CLAP (Série 1)",
  5341221: "PACK CLAP (Série 2)",
  5302827: "PACK PROJECTION",
  5305328: "PACK PRODUCTION"
}
const ELIGIBLE_ORDER_STATUSES = new Set([4, 7, "4", "7", "payment-done"])

const ululeSyncState = {
  running: false,
  currentEmail: null,
  scanned: 0,
  matched: 0,
  inserted: 0,
  skippedExisting: 0,
  sent: 0,
  failed: 0,
  lastError: null,
  reason: "idle",
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  nextScheduledAt: null,
  inviteCutoffAt: ULULE_INITIAL_SYNC_AT,
  initialCatchupDone: false
}

let schedulerStarted = false

function token() {
  return crypto.randomBytes(32).toString("hex")
}

function errorMessage(error) {
  return error?.message || "unknown error"
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase()
}

function getUluleProjectId() {
  return String(process.env.ULULE_PROJECT_ID || ULULE_DEFAULT_PROJECT_ID).trim()
}

function getUluleApiKey() {
  return String(process.env.ULULE_API_KEY || "").trim()
}

function getEligibleRewardIds() {
  const raw = String(process.env.ULULE_ELIGIBLE_REWARD_IDS || "").trim()
  if (!raw) return [...DEFAULT_ELIGIBLE_REWARD_IDS]
  return raw
    .split(",")
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value))
}

function pickRewardName(reward = {}) {
  const directCandidates = [
    reward?.title_fr,
    reward?.title_en,
    reward?.title,
    reward?.name,
    reward?.label
  ]
  for (const candidate of directCandidates) {
    if (candidate) return String(candidate).trim()
  }

  const description = reward?.description || reward?.description_fr || reward?.description_en || ""
  if (typeof description === "object" && description) {
    return String(description.fr || description.en || Object.values(description).find(Boolean) || "").trim()
  }

  return String(description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function normalizeStoredText(value, fallback = null) {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed && trimmed.toLowerCase() !== "[object object]") {
      return trimmed
    }
  }

  if (value && typeof value === "object") {
    const directCandidates = [
      value.title_fr,
      value.title_en,
      value.title,
      value.name,
      value.label,
      value.fr,
      value.en,
      value.value
    ]
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim()
      }
    }

    const description = value.description || value.description_fr || value.description_en || null
    if (typeof description === "string" && description.trim()) {
      return description.trim()
    }
    if (description && typeof description === "object") {
      const localized = description.fr || description.en || Object.values(description).find((entry) => typeof entry === "string" && entry.trim())
      if (typeof localized === "string" && localized.trim()) {
        return localized.trim()
      }
    }
  }

  return fallback
}

function rewardLabelFromId(rewardId) {
  const numericId = Number(rewardId || 0)
  return KNOWN_ULULE_REWARD_LABELS[numericId] || null
}

function pickSupporterIdentity(user = {}) {
  const firstName = String(user?.first_name || "").trim()
  const lastName = String(user?.last_name || "").trim()
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
  const fallbackFullName = String(user?.name || user?.username || user?.screenname || "").trim()

  return {
    firstName: firstName || null,
    lastName: lastName || null,
    fullName: fullName || fallbackFullName || null
  }
}

function isEligibleOrderStatus(order) {
  const status = order?.status
  return ELIGIBLE_ORDER_STATUSES.has(status)
}

function getEligibleItems(order) {
  const eligibleIds = new Set(getEligibleRewardIds())
  return (Array.isArray(order?.items) ? order.items : [])
    .map((item) => {
      const parentRewardId = Number(item?.reward?.parent?.id || 0)
      const variantRewardId = Number(item?.reward_id || item?.reward?.id || 0)
      const matchedRewardId = parentRewardId || variantRewardId
      if (!eligibleIds.has(matchedRewardId)) return null
      return {
        rewardId: matchedRewardId,
        rewardVariantId: variantRewardId || null,
        rewardName: pickRewardName(item?.reward?.parent || item?.reward || {}),
        quantity: Number(item?.quantity || 1) || 1
      }
    })
    .filter(Boolean)
}

async function fetchUluleJson(url) {
  const apiKey = getUluleApiKey()
  if (!apiKey) throw new Error("ULULE_API_KEY is missing")

  const { stdout } = await execFileAsync("curl", [
    "-sS",
    "-w",
    "\n%{http_code}",
    url,
    "-H", "Accept: application/json",
    "-H", `Authorization: APIKey ${apiKey}`,
    "-H", `User-Agent: ${ULULE_USER_AGENT}`
  ], { maxBuffer: 1024 * 1024 * 5 })

  const newlineIndex = stdout.lastIndexOf("\n")
  const body = newlineIndex >= 0 ? stdout.slice(0, newlineIndex) : stdout
  const status = parseInt(newlineIndex >= 0 ? stdout.slice(newlineIndex + 1).trim() : "0", 10)

  if (!Number.isFinite(status) || status >= 400) {
    throw new Error(`Ulule request failed (${status || "unknown"}): ${String(body || "").slice(0, 240)}`)
  }

  return JSON.parse(body)
}

async function readSyncSettings() {
  try {
    const { data, error } = await supabase
      .from(APP_SETTINGS_TABLE)
      .select("value")
      .eq("key", ULULE_SYNC_STATE_KEY)
      .maybeSingle()

    if (error) throw error
    return data?.value && typeof data.value === "object" ? data.value : {}
  } catch (error) {
    console.warn("ulule sync settings read error", errorMessage(error))
    return {}
  }
}

async function writeSyncSettings(value) {
  try {
    const { error } = await supabase
      .from(APP_SETTINGS_TABLE)
      .upsert({
        key: ULULE_SYNC_STATE_KEY,
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: "key" })

    if (error) throw error
  } catch (error) {
    console.warn("ulule sync settings write error", errorMessage(error))
  }
}

async function saveUluleImport(entry) {
  const payload = {
    email: entry.email,
    order_id: entry.orderId,
    reward_id: entry.rewardId,
    reward_name: normalizeStoredText(entry.rewardName, rewardLabelFromId(entry.rewardId)),
    supporter_first_name: normalizeStoredText(entry.supporterFirstName, null),
    supporter_last_name: normalizeStoredText(entry.supporterLastName, null),
    supporter_full_name: normalizeStoredText(entry.supporterFullName, null),
    order_created_at: entry.orderCreatedAt || null,
    access_token_id: entry.accessTokenId || null,
    outcome: entry.outcome,
    last_error: entry.lastError || null,
    last_seen_at: new Date().toISOString()
  }

  const { error } = await supabase
    .from(ULULE_IMPORTS_TABLE)
    .upsert(payload, { onConflict: "order_id,reward_id,email" })

  if (error) throw error
}

async function findAccessTokenByEmail(email) {
  const { data, error } = await supabase
    .from(ACCESS_TOKENS_TABLE)
    .select("id,discord_id,import_source")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function createAccessToken(email) {
  const { data, error } = await supabase
    .from(ACCESS_TOKENS_TABLE)
    .insert({
      email,
      token: token(),
      used: false,
      email_sent: false,
      import_source: "ulule"
    })
    .select("id,email,token")
    .maybeSingle()

  if (error) throw error
  return data
}

async function queueInvitation(accessTokenRow) {
  const sendResponse = await sendMail(accessTokenRow.email, accessTokenRow.token, { accessTokenId: accessTokenRow.id })
  const messageId = String(sendResponse?.messageId || sendResponse?.message_id || "").trim() || null

  const { error } = await supabase
    .from(ACCESS_TOKENS_TABLE)
    .update({
      email_sent: false,
      email_sent_at: null,
      brevo_message_id: messageId,
      brevo_status: "queued",
      brevo_event_at: new Date().toISOString(),
      email_error: null
    })
    .eq("id", accessTokenRow.id)

  if (error) throw error
}

async function revokeRefundedAccess(order, item) {
  const email = normalizeEmail(order?.user?.email)
  const orderId = Number(order?.id || 0)
  const orderCreatedAt = order?.created_at || null
  const rewardId = item.rewardId
  const rewardName = item.rewardName

  if (!email) {
    await saveUluleImport({
      email: "",
      orderId,
      rewardId,
      rewardName,
      orderCreatedAt,
      outcome: "missing_email",
      lastError: "missing email on refunded Ulule order"
    })
    return { inserted: 0, skippedExisting: 0, sent: 0, failed: 1 }
  }

  ululeSyncState.currentEmail = email
  const existing = await findAccessTokenByEmail(email)
  if (!existing?.id) {
    await saveUluleImport({
      email,
      orderId,
      rewardId,
      rewardName,
      orderCreatedAt,
      outcome: "refunded_no_access"
    })
    return { inserted: 0, skippedExisting: 1, sent: 0, failed: 0 }
  }

  try {
    const hadDiscordAccess = Boolean(existing.discord_id)

    if (existing.discord_id) {
      await removeDiscordMemberFromGuild(existing.discord_id)
    }

    const { error } = await supabase
      .from(ACCESS_TOKENS_TABLE)
      .update({
        token: token(),
        used: false,
        used_at: null,
        discord_id: null,
        resend_excluded: true,
        email_error: "Commande Ulule remboursée"
      })
      .eq("id", existing.id)

    if (error) throw error

    await saveUluleImport({
      email,
      orderId,
      rewardId,
      rewardName,
      orderCreatedAt,
      accessTokenId: existing.id,
      outcome: hadDiscordAccess ? "refunded_discord_revoked" : "refunded_local_only"
    })
    return { inserted: 0, skippedExisting: 1, sent: 0, failed: 0 }
  } catch (error) {
    await saveUluleImport({
      email,
      orderId,
      rewardId,
      rewardName,
      orderCreatedAt,
      accessTokenId: existing.id,
      outcome: "refunded_discord_remove_failed",
      lastError: errorMessage(error)
    })
    return { inserted: 0, skippedExisting: 0, sent: 0, failed: 1 }
  }
}

async function processEligibleOrder(order, item, { allowInvite = true } = {}) {
  const email = normalizeEmail(order?.user?.email)
  const orderId = Number(order?.id || 0)
  const orderCreatedAt = order?.created_at || null
  const rewardId = item.rewardId
  const rewardName = item.rewardName
  const supporter = pickSupporterIdentity(order?.user)

  if (!email) {
    await saveUluleImport({
      email: "",
      orderId,
      rewardId,
      rewardName,
      supporterFirstName: supporter.firstName,
      supporterLastName: supporter.lastName,
      supporterFullName: supporter.fullName,
      orderCreatedAt,
      outcome: "missing_email",
      lastError: "missing email on Ulule order"
    })
    return { inserted: 0, skippedExisting: 0, sent: 0, failed: 1 }
  }

  ululeSyncState.currentEmail = email

  const existing = await findAccessTokenByEmail(email)
  if (existing?.id) {
    if (existing.import_source === "ulule") {
      await saveUluleImport({
        email,
        orderId,
        rewardId,
        rewardName,
        supporterFirstName: supporter.firstName,
        supporterLastName: supporter.lastName,
        supporterFullName: supporter.fullName,
        orderCreatedAt,
        accessTokenId: existing.id,
        outcome: "existing_in_base"
      })
    }
    return { inserted: 0, skippedExisting: 1, sent: 0, failed: 0 }
  }

  if (!allowInvite) {
    return { inserted: 0, skippedExisting: 0, sent: 0, failed: 0 }
  }

  let accessTokenRow = null
  try {
    accessTokenRow = await createAccessToken(email)
  } catch (error) {
    await saveUluleImport({
      email,
      orderId,
      rewardId,
      rewardName,
      supporterFirstName: supporter.firstName,
      supporterLastName: supporter.lastName,
      supporterFullName: supporter.fullName,
      orderCreatedAt,
      outcome: "insert_failed",
      lastError: errorMessage(error)
    })
    return { inserted: 0, skippedExisting: 0, sent: 0, failed: 1 }
  }

  try {
    await queueInvitation(accessTokenRow)
    await saveUluleImport({
      email,
      orderId,
      rewardId,
      rewardName,
      supporterFirstName: supporter.firstName,
      supporterLastName: supporter.lastName,
      supporterFullName: supporter.fullName,
      orderCreatedAt,
      accessTokenId: accessTokenRow.id,
      outcome: "inserted_and_sent"
    })
    return { inserted: 1, skippedExisting: 0, sent: 1, failed: 0 }
  } catch (error) {
    await supabase
      .from(ACCESS_TOKENS_TABLE)
      .update({ email_error: errorMessage(error) })
      .eq("id", accessTokenRow.id)

    await saveUluleImport({
      email,
      orderId,
      rewardId,
      rewardName,
      supporterFirstName: supporter.firstName,
      supporterLastName: supporter.lastName,
      supporterFullName: supporter.fullName,
      orderCreatedAt,
      accessTokenId: accessTokenRow.id,
      outcome: "send_failed",
      lastError: errorMessage(error)
    })
    return { inserted: 1, skippedExisting: 0, sent: 0, failed: 1 }
  }
}

function buildOrdersUrl(projectId, next = "") {
  if (next) {
    return next.startsWith("http") ? next : `${ULULE_API_BASE}/projects/${projectId}/orders${next}`
  }
  return `${ULULE_API_BASE}/projects/${projectId}/orders?limit=100&show_anonymous=true`
}

async function runUluleSync({ reason = "manual" } = {}) {
  if (ululeSyncState.running) {
    return { started: false, state: getUluleSyncStatus() }
  }

  const projectId = getUluleProjectId()
  if (!projectId) throw new Error("ULULE_PROJECT_ID is missing")
  if (!getUluleApiKey()) throw new Error("ULULE_API_KEY is missing")

  ululeSyncState.running = true
  ululeSyncState.currentEmail = null
  ululeSyncState.scanned = 0
  ululeSyncState.matched = 0
  ululeSyncState.inserted = 0
  ululeSyncState.skippedExisting = 0
  ululeSyncState.sent = 0
  ululeSyncState.failed = 0
  ululeSyncState.lastError = null
  ululeSyncState.reason = reason
  ululeSyncState.lastStartedAt = new Date().toISOString()
  ululeSyncState.lastFinishedAt = null

  try {
    const storedSettings = await readSyncSettings()
    const initialStartAt = new Date(ULULE_INITIAL_SYNC_AT)
    const initialCatchupDone = Boolean(storedSettings?.lastSuccessAt)
    const cutoff = initialCatchupDone
      ? new Date(Date.now() - (24 * 60 * 60 * 1000))
      : initialStartAt

    ululeSyncState.initialCatchupDone = initialCatchupDone
    ululeSyncState.inviteCutoffAt = cutoff.toISOString()

    let url = buildOrdersUrl(projectId)
    let pageGuard = 0

    while (url && pageGuard < 200) {
      pageGuard += 1
      const payload = await fetchUluleJson(url)
      const orders = Array.isArray(payload?.orders) ? payload.orders : []
      if (!orders.length) break

      for (const order of orders) {
        const orderCreatedAt = order?.created_at ? new Date(order.created_at) : null
        const eligibleItems = getEligibleItems(order)
        if (!eligibleItems.length) continue
        const isRefunded = order?.refunded === true
        const isRecentOrder = !(orderCreatedAt && orderCreatedAt < cutoff)

        if (!isRefunded && !isRecentOrder) continue

        ululeSyncState.scanned += 1

        for (const item of eligibleItems) {
          ululeSyncState.matched += 1
          const result = isRefunded
            ? await revokeRefundedAccess(order, item)
            : isEligibleOrderStatus(order)
              ? await processEligibleOrder(order, item, { allowInvite: isRecentOrder })
              : { inserted: 0, skippedExisting: 0, sent: 0, failed: 0 }
          ululeSyncState.inserted += result.inserted
          ululeSyncState.skippedExisting += result.skippedExisting
          ululeSyncState.sent += result.sent
          ululeSyncState.failed += result.failed
        }
      }

      url = buildOrdersUrl(projectId, payload?.meta?.next || "")
      if (!payload?.meta?.next) break
    }

    ululeSyncState.lastSuccessAt = new Date().toISOString()
    ululeSyncState.initialCatchupDone = true
    await writeSyncSettings({
      lastSuccessAt: ululeSyncState.lastSuccessAt,
      projectId,
      eligibleRewardIds: getEligibleRewardIds(),
      initialStartAt: ULULE_INITIAL_SYNC_AT,
      inviteWindowHours: 24
    })

    return { started: true, state: getUluleSyncStatus() }
  } catch (error) {
    ululeSyncState.lastError = errorMessage(error)
    throw error
  } finally {
    ululeSyncState.running = false
    ululeSyncState.currentEmail = null
    ululeSyncState.lastFinishedAt = new Date().toISOString()
  }
}

function getUluleSyncStatus() {
  return {
    ...ululeSyncState,
    projectId: getUluleProjectId(),
    eligibleRewardIds: getEligibleRewardIds(),
    initialStartAt: ULULE_INITIAL_SYNC_AT,
    inviteWindowHours: 24,
    schedulerIntervalMinutes: ULULE_SYNC_INTERVAL_MS / 60000
  }
}

async function listUluleImports(limit = 40, { refundedOnly = false } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100)
  let query = supabase
    .from(ULULE_IMPORTS_TABLE)
    .select("id,email,order_id,reward_id,reward_name,order_created_at,access_token_id,outcome,last_error,created_at,last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(safeLimit)

  if (refundedOnly) {
    query = query.in("outcome", ["refunded_discord_revoked", "refunded_discord_remove_failed"])
  }

  const { data, error } = await query

  if (error) throw error
  return (data || []).map((item) => ({
    ...item,
    reward_name: normalizeStoredText(item.reward_name, rewardLabelFromId(item.reward_id) || (item.reward_id ? `#${item.reward_id}` : null)),
    supporter_first_name: normalizeStoredText(item.supporter_first_name, null),
    supporter_last_name: normalizeStoredText(item.supporter_last_name, null),
    supporter_full_name: normalizeStoredText(item.supporter_full_name, null)
  }))
}

function startUluleSyncScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  if (!getUluleApiKey()) {
    console.log("Ulule sync scheduler disabled: ULULE_API_KEY missing")
    return
  }

  const scheduleNextRunAt = (delayMs) => {
    ululeSyncState.nextScheduledAt = new Date(Date.now() + delayMs).toISOString()
  }

  const runScheduled = async () => {
    try {
      await runUluleSync({ reason: "scheduled" })
    } catch (error) {
      console.error("ulule scheduled sync error", errorMessage(error))
    } finally {
      scheduleNextRunAt(ULULE_SYNC_INTERVAL_MS)
    }
  }

  scheduleNextRunAt(20 * 1000)
  setTimeout(runScheduled, 20 * 1000)
  setInterval(runScheduled, ULULE_SYNC_INTERVAL_MS)
  console.log("Ulule sync scheduler ready")
}

export {
  getUluleSyncStatus,
  listUluleImports,
  runUluleSync,
  startUluleSyncScheduler
}
