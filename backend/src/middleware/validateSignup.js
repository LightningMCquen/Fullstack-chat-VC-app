// middleware/validateSignup.js
import { body, validationResult } from 'express-validator';

export const validateSignup = [
  body('email').isEmail().normalizeEmail(),
  body('fullName').trim().isLength({ min: 2, max: 50 }),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];
