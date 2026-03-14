import {
 getAdminAuthCookieName,
 parseCookies,
 verifyAdminAuthCookieValue
} from "../services/adminAuthCookie.js"

export default function(req,res,next){

 if(req.session && req.session.auth){
  return next()
 }

 const cookies = parseCookies(req.headers.cookie)
 const authCookie = cookies[getAdminAuthCookieName()]
 if (verifyAdminAuthCookieValue(authCookie)) {
  if (req.session) req.session.auth = true
  return next()
 }

 res.redirect("/login")

}
