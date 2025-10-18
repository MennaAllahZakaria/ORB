const{param , validationResult} = require('express-validator');

const validatorMiddleware = (req, res, next) => {
  if (["GET", "DELETE"].includes(req.method)) {
    return next();
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  next();
};

module.exports = validatorMiddleware;