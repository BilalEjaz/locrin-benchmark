import express, { Router } from 'express';
import {registerUser, loginUser, forgotPassword, logoutUser, verifyOtp, resendOtp, passwordReset } from '../controllers/auth.controller.js'

const authRoutes:Router = express.Router();


authRoutes.post('/register', registerUser);
authRoutes.post('/login', loginUser);
authRoutes.post('/forgot-password', forgotPassword);
authRoutes.post('/reset-password', passwordReset);
authRoutes.post("/verify-email", verifyOtp);
authRoutes.post("/resend-otp", resendOtp);
authRoutes.post('/logout', logoutUser);


export default authRoutes;
