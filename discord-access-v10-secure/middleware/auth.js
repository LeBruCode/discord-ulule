export default function(req,res,next){

 if(req.session && req.session.auth){
  return next()
 }

 res.redirect("/login")

}