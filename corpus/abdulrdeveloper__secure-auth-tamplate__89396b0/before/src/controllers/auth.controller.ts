import type { Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import "dotenv/config";

import userModel from "../models/user.model.js";
import redis from "../services/redis.service.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/mail.service.js";
import { registerSchema, loginSchema, verifyOtpSchema, resendOtpSchema, forgotPasswordSchema, resetPasswordSchema } from "../config/validation.js";


const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: 60 * 60 * 1000,
};


async function registerUser(req: Request, res: Response) {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { name, email, password } = validation.data;

    const existingUser = await userModel.findOne({ email });
    if (existingUser?.isEmailVerified) {
      return res.status(400).json({ message: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new userModel({
      name,
      email,
      password: hashedPassword,
      isEmailVerified: false,
    });
    await newUser.save();

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpKey = `auth:verify_otp:${newUser.email}`;
    const cooldownKey = `auth:otp_cooldown:${newUser.email}`;

    await redis.set(otpKey, otp, { ex: 300 });
    await redis.set(cooldownKey, "1", { ex: 60 });

    try {
      await sendVerificationEmail(newUser.email, otp);
    } catch (emailError) {
      console.error("Email send failed in registerUser:", emailError);
      await userModel.findByIdAndDelete(newUser._id);
      await redis.del(otpKey, cooldownKey);
      return res.status(500).json({ message: "Failed to send verification email. Please try again." });
    }

    if (existingUser) {
      await userModel.findByIdAndDelete(existingUser._id);
    }

    return res.status(201).json({
      message: "Registration successful. Please check your email for the verification OTP.",
      email: newUser.email,
    });

  } catch (error) {
    console.error("Error in registerUser:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function verifyOtp(req: Request, res: Response) {
  try {
    const validation = verifyOtpSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { email, otp } = validation.data;
    const otpKey = `auth:verify_otp:${email}`;
    const attemptsKey = `auth:verify_attempts:${email}`;
    const storedOtp = await redis.get<string>(otpKey);

    if (!storedOtp) {
      return res.status(400).json({ message: "Verification code has expired or is invalid" });
    }

    if (String(storedOtp).trim() !== String(otp).trim()) {
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) await redis.expire(attemptsKey, 300);
      if (attempts >= 5) {
        await redis.del(otpKey, attemptsKey);
        return res.status(400).json({ message: "Too many failed attempts. Please request a new code." });
      }
      return res.status(400).json({ message: "Invalid verification code" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await redis.del(otpKey, attemptsKey);

    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, COOKIE_OPTIONS);

    const passwordlessUser = user.toObject();
    delete passwordlessUser.password;

    return res.status(200).json({
      message: "Email verified successfully",
      user: passwordlessUser,
    });

  } catch (error) {
    console.error("Error in verifyOtp:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function resendOtp(req: Request, res: Response) {
  try {
    const validation = resendOtpSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { email } = validation.data;
    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: "Email is already verified. Please login." });
    }

    const cooldownKey = `auth:otp_cooldown:${email}`;
    const isCoolingDown = await redis.get(cooldownKey);
    if (isCoolingDown) {
      return res.status(429).json({
        message: "Please wait 60 seconds before requesting another verification code.",
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpKey = `auth:verify_otp:${email}`;

    await redis.set(otpKey, otp, { ex: 300 });
    await redis.set(cooldownKey, "1", { ex: 60 });
    await redis.del(`auth:verify_attempts:${email}`);

    await sendVerificationEmail(email, otp);

    return res.status(200).json({ message: "Verification OTP resent successfully" });

  } catch (error) {
    console.error("Error in resendOtp:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function loginUser(req: Request, res: Response) {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { email, password } = validation.data;

    const user = await userModel.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password as string);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: "Please verify your email address before logging in.",
        isEmailVerified: false,
      });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, COOKIE_OPTIONS);

    const passwordlessUser = user.toObject();
    delete passwordlessUser.password;

    return res.status(200).json({
      message: "Login successful",
      user: passwordlessUser,
    });

  } catch (error) {
    console.error("Error in loginUser:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function forgotPassword(req: Request, res: Response) {
  try {
    const validation = forgotPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { email } = validation.data;

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cooldownKey = `auth:reset_cooldown:${email}`;
    const isCoolingDown = await redis.get(cooldownKey);
    if (isCoolingDown) {
      return res.status(429).json({
        message: "Please wait 60 seconds before requesting another password reset code.",
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const redisKey = `auth:reset_otp:${email}`;

    await redis.set(redisKey, otp, { ex: 300 });
    await redis.set(cooldownKey, "1", { ex: 60 });
    await redis.del(`auth:reset_attempts:${email}`);

    await sendPasswordResetEmail(email, otp);

    return res.status(200).json({
      message: "Password reset OTP sent to your email",
    });

  } catch (error) {
    console.error("Error in forgotPassword:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function passwordReset(req: Request, res: Response) {
  try {
    const validation = resetPasswordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Invalid input",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const { email, otp, newPassword } = validation.data;

    const redisKey = `auth:reset_otp:${email}`;
    const attemptsKey = `auth:reset_attempts:${email}`;
    const storedOtp = await redis.get<string>(redisKey);

    if (!storedOtp) {
      return res.status(400).json({ message: "Reset OTP has expired or is invalid" });
    }

    if (String(storedOtp).trim() !== String(otp).trim()) {
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) await redis.expire(attemptsKey, 300);
      if (attempts >= 5) {
        await redis.del(redisKey, attemptsKey);
        return res.status(400).json({ message: "Too many failed attempts. Please request a new reset code." });
      }
      return res.status(400).json({ message: "Invalid reset OTP code" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await redis.del(redisKey, attemptsKey);

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({ message: "Password reset successful. Please login with your new password." });

  } catch (error) {
    console.error("Error in passwordReset:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function logoutUser(req: Request, res: Response) {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
      path: "/",
      maxAge: 0,
    });

    return res.status(200).json({ message: "Logout successful" });

  } catch (error) {
    console.error("Error in logoutUser:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


export { registerUser, verifyOtp, resendOtp, loginUser, forgotPassword, passwordReset, logoutUser };