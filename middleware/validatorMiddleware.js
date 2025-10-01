const{param , validationResult} = require('express-validator');

const validatorMiddleware= (req,res,next)=>{
    JSON.parse(JSON.stringify(req.body))
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    next();
}
module.exports = validatorMiddleware;