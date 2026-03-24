function buildBrandingAssetUrl(branding = {}) {
 const rawSource = branding.logoDataUrl || branding.logoPath || ""
 if (!rawSource) return ""
 if (/^data:/i.test(rawSource)) return rawSource
 const updatedAt = branding.updatedAt || null
 return updatedAt ? `${rawSource}?v=${encodeURIComponent(updatedAt)}` : rawSource
}

async function refreshLandingBranding() {
 try {
  const response = await fetch("/api/landing-config", { cache: "no-store" })
  const payload = await response.json()
  if (!response.ok) return

  const branding = payload.branding || {}
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

async function handleLandingSubmit(event) {
 const form = event.currentTarget
 const emailInput = document.getElementById("landingEmail")
 const status = document.getElementById("landingStatus")
 const submitButton = document.getElementById("landingSubmitBtn")

 event.preventDefault()
 const email = String(emailInput?.value || "").trim().toLowerCase()
 if (!email) {
  status.textContent = "Ajoute ton adresse e-mail pour qu'on puisse te retrouver."
  return
 }

 submitButton.disabled = true
 status.textContent = "On regarde si ton adresse est déjà dans la liste..."

 try {
  const response = await fetch("/api/request-access-link", {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ email })
  })
  const payload = await response.json()

  if (!response.ok) {
   status.textContent = payload.error === "email required"
    ? "Ajoute une adresse e-mail valide."
    : "Ça coince pour l'instant. Réessaie dans quelques minutes."
   return
  }

  form.reset()
  status.textContent = payload.message || "Si ton adresse existe déjà dans la liste, tu vas recevoir un lien dans quelques instants."
 } catch (error) {
  console.error("landing request error", error)
  status.textContent = "Ça coince pour l'instant. Réessaie dans quelques minutes."
 } finally {
  submitButton.disabled = false
 }
}

document.getElementById("landingForm")?.addEventListener("submit", handleLandingSubmit)
refreshLandingBranding()
