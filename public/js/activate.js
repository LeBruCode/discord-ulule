async function runActivation() {
 const statusEl = document.getElementById("status")
 const token = new URLSearchParams(window.location.search).get("token")

 if (!token) {
  statusEl.innerText = "Missing token."
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
    statusEl.innerText = "Discord OAuth is not configured on server."
    return
   }
   statusEl.innerText = "Access activated. Redirecting..."
   setTimeout(() => {
    window.location.href = targetUrl
   }, 2000)
   return
  }

  statusEl.innerText = activation.message ? `Link ${activation.message}.` : "Link invalid or expired."
 } catch (error) {
  console.error("activation error", error)
  statusEl.innerText = "Server error. Please retry."
 }
}

runActivation()
