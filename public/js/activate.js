async function runActivation() {
 const statusEl = document.getElementById("status")
 const token = new URLSearchParams(window.location.search).get("token")
 const translateMessage = (message) => {
  if (!message) return ""
  const lower = String(message).toLowerCase()
  if (lower.includes("already used")) return "Lien déjà utilisé."
  if (lower.includes("expired")) return "Lien expiré."
  if (lower.includes("invalid")) return "Lien invalide."
  if (lower.includes("server error")) return "Erreur serveur."
  return String(message)
 }

 if (!token) {
  statusEl.innerText = "Jeton manquant."
  return
 }

 try {
  const [activationRes, configRes] = await Promise.all([
   fetch("/api/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
   }),
   fetch("/api/config")
  ])

  const activation = await activationRes.json()
  let targetUrl = ""

  if (configRes.ok) {
   const config = await configRes.json()
   if (config.discordOauthReady) {
    targetUrl = `/api/discord/authorize?token=${encodeURIComponent(token)}`
   }
  }

  if (activation.success) {
   if (!targetUrl) {
    statusEl.innerText = "OAuth Discord n'est pas configuré sur le serveur."
    return
   }
   statusEl.innerText = "Accès activé. Redirection en cours..."
   setTimeout(() => {
    window.location.href = targetUrl
   }, 2000)
   return
  }

  statusEl.innerText = activation.message ? translateMessage(activation.message) : "Lien invalide ou expiré."
 } catch (error) {
  console.error("activation error", error)
  statusEl.innerText = "Erreur serveur. Merci de réessayer."
 }
}

runActivation()
