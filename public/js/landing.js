function buildBrandingAssetUrl(branding = {}) {
 const rawSource = branding.logoDataUrl || branding.logoPath || ""
 if (!rawSource) return ""
 if (/^data:/i.test(rawSource)) return rawSource
 const updatedAt = branding.updatedAt || null
 return updatedAt ? `${rawSource}?v=${encodeURIComponent(updatedAt)}` : rawSource
}

const t = window.dashboardT || ((key) => key)

if (typeof window.applyDashboardCopy === "function") {
 window.applyDashboardCopy()
}

async function refreshLandingBranding() {
 try {
  const logo = document.getElementById("landingLogo")
  if (logo && logo.getAttribute("src")) return

  const response = await fetch("/api/landing-config", { cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) return

  const branding = payload.branding || {}
  const logoUrl = buildBrandingAssetUrl(branding)
  if (!logo || !logoUrl) return

  logo.src = logoUrl
  logo.style.width = `${Number(branding.logoWidth) || 96}px`
  logo.classList.remove("hidden")
 } catch (error) {
  console.error("landing branding error", error)
 }
}

async function handleLandingSubmit(event) {
 const form = event.currentTarget
 const emailInput = document.getElementById("landingEmail")
 const status = document.getElementById("landingStatus")
 const submitButton = document.getElementById("landingSubmitBtn")

 event.preventDefault()
 const email = String(emailInput?.value || "").trim().toLowerCase()
 if (!email) {
  status.textContent = t("landing_status_missing_email")
  return
 }

 submitButton.disabled = true
 status.textContent = t("landing_status_lookup")

 try {
  const response = await fetch("/api/request-access-link", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ email })
  })
  const payload = await response.json()

  if (!response.ok) {
   status.textContent = payload.error === "email required"
    ? t("landing_status_invalid_email")
    : t("landing_status_error")
   return
  }

  form.reset()
  status.textContent = payload.message || t("landing_status_success")
 } catch (error) {
  console.error("landing request error", error)
  status.textContent = t("landing_status_error")
 } finally {
  submitButton.disabled = false
 }
}

document.getElementById("landingForm")?.addEventListener("submit", handleLandingSubmit)
refreshLandingBranding()
