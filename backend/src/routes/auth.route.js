import express from "express";
import {
  checkAuth,
  login,
  logout,
  signup,
  updateProfile,
} from "../controllers/auth.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { validateSignup } from "../middleware/validateSignup.js";
import { authLimiter } from "../middleware/rateLimiter.js"; // ✅ Import limiter

const router = express.Router();

// ✅ Apply rate limiter ONLY to login & signup routes
router.post("/signup", authLimiter, validateSignup, signup);
router.post("/login", authLimiter, login);
router.post("/logout", logout);

router.put("/update-profile", protectRoute, updateProfile);
router.get("/check", protectRoute, checkAuth);

export default router;
