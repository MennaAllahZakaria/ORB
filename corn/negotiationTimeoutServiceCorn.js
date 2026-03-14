const Thread = require("../models/LessonNegotiationThreadModel")
const {getIO} = require("../config/socket")

async function checkNegotiationTimeout(){

 const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

 const threads = await Thread.find({
   status:"negotiating",
   lastOfferAt:{ $lte: fiveMinutesAgo }
 })

 const io = getIO()

 for(const thread of threads){

   thread.status="timeout"
   await thread.save()

   if(io){
     io.to(thread._id.toString()).emit("negotiationTimeout",{
       threadId:thread._id
     })
   }
 }

}

module.exports = {checkNegotiationTimeout}