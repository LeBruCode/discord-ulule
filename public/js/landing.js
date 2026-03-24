function buildBrandingAssetUrl(branding = {}) {
 const rawSource = branding.logoDataUrl || branding.logoPath || ""
 if (!rawSource) return ""
 if (/^data:/i.test(rawSource)) return rawSource
 const updatedAt = branding.updatedAt || null
 return updatedAt ? `${rawSource}?v=${encodeURIComponent(updatedAt)}` : rawSource
}

const t = window.dashboardT || ((key) => key)
const LANDING_CONFIG_REFRESH_MS = 20000

if (typeof window.applyDashboardCopy === "function") {
 window.applyDashboardCopy()
}

function setLandingStatus(statusKey, fallbackText = "") {
 const status = document.getElementById("landingStatus")
 if (!status) return

 status.dataset.statusKey = statusKey || ""
 if (statusKey && typeof window.dashboardT === "function") {
  status.textContent = window.dashboardT(statusKey)
  return
 }

 status.textContent = fallbackText
}

function refreshLandingBrandingFromConfig(branding = {}) {
 try {
  const logo = document.getElementById("landingLogo")
  const logoUrl = buildBrandingAssetUrl(branding)
  if (!logo || !logoUrl) return

  logo.src = logoUrl
  logo.style.width = `${Number(branding.logoWidth) || 96}px`
  logo.classList.remove("hidden")
 } catch (error) {
  console.error("landing branding error", error)
 }
}

async function refreshLandingConfig() {
 try {
  const status = document.getElementById("landingStatus")
  const currentStatusKey = status?.dataset.statusKey || "landing_status_idle"
  const response = await fetch("/api/landing-config", { cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) return

  if (payload.copy && typeof payload.copy === "object") {
   window.DASHBOARD_COPY = { ...(window.DASHBOARD_COPY || {}), ...payload.copy }
   if (typeof window.applyDashboardCopy === "function") {
    window.applyDashboardCopy()
   }
  }

  refreshLandingBrandingFromConfig(payload.branding || {})
  if (currentStatusKey && currentStatusKey !== "landing_status_idle") {
   setLandingStatus(currentStatusKey)
  }
 } catch (error) {
  console.error("landing config refresh error", error)
 }
}

async function handleLandingSubmit(event) {
 const form = event.currentTarget
 const emailInput = document.getElementById("landingEmail")
 const submitButton = document.getElementById("landingSubmitBtn")

 event.preventDefault()
 const email = String(emailInput?.value || "").trim().toLowerCase()
 if (!email) {
  setLandingStatus("landing_status_missing_email")
  return
 }

 submitButton.disabled = true
 setLandingStatus("landing_status_lookup")

 try {
  const response = await fetch("/api/request-access-link", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ email })
  })
  const payload = await response.json()

  if (!response.ok) {
   setLandingStatus(
    payload.error === "email required" ? "landing_status_invalid_email" : "landing_status_error"
   )
   return
  }

  form.reset()
  setLandingStatus("landing_status_success", payload.message || t("landing_status_success"))
  const status = document.getElementById("landingStatus")
  if (status && payload.message) {
   status.textContent = payload.message
  }
 } catch (error) {
  console.error("landing request error", error)
  setLandingStatus("landing_status_error")
 } finally {
  submitButton.disabled = false
 }
}

document.getElementById("landingForm")?.addEventListener("submit", handleLandingSubmit)
refreshLandingConfig()

window.setInterval(() => {
 if (document.hidden) return
 refreshLandingConfig()
}, LANDING_CONFIG_REFRESH_MS)
