import express, { Router } from "express";
import {
  registerUser,
  loginUser,
  forgotPassword,
  logoutUser,
  verifyOtp,
  resendOtp,
  passwordReset,
  getMe,
} from "../controllers/auth.controller.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from "../config/validation.js";
import { validate } from "../middlewares/validate.middleware.js";
import { authenticate } from "../middlewares/auth.middleware.js";


const authRoutes: Router = express.Router();

authRoutes.post("/register", validate(registerSchema), registerUser);
authRoutes.post("/verify-email", validate(verifyOtpSchema), verifyOtp);
authRoutes.post("/resend-otp", validate(resendOtpSchema), resendOtp);
authRoutes.post("/login", validate(loginSchema), loginUser);
authRoutes.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
authRoutes.post("/reset-password", validate(resetPasswordSchema), passwordReset);
authRoutes.get("/me", authenticate, getMe);
authRoutes.post("/logout", logoutUser);

export default authRoutes;
