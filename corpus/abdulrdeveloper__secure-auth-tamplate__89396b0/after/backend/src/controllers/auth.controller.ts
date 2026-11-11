import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import "dotenv/config";

import userModel from "../models/user.model.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../services/mail.service.js";
import {
  checkCooldown,
  clearOtp,
  generateAndStoreOtp,
  verifyOtpWithRateLimit,
} from "../services/otp.service.js";


const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as
    | "none"
    | "lax",
  path: "/",
  maxAge: 60 * 60 * 1000,
};


async function registerUser(req: Request, res: Response) {
  try {
    const { name, email, password } = req.body;

    const existingUser = await userModel.findOne({ email });
    if (existingUser?.isEmailVerified) {
      return res
        .status(400)
        .json({ message: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new userModel({
      name,
      email,
      password: hashedPassword,
      isEmailVerified: false,
    });
    await newUser.save();

    const otp = await generateAndStoreOtp(newUser.email, "verify");

    try {
      await sendVerificationEmail(newUser.email, otp);
    } catch (emailError) {
      console.error("Email send failed in registerUser:", emailError);
      await userModel.findByIdAndDelete(newUser._id);
      await clearOtp(newUser.email, "verify");
      return res
        .status(500)
        .json({
          message: "Failed to send verification email. Please try again.",
        });
    }

    if (existingUser) {
      await userModel.findByIdAndDelete(existingUser._id);
    }

    return res.status(201).json({
      message:
        "Registration successful. Please check your email for the verification OTP.",
      email: newUser.email,
    });
  } catch (error) {
    console.error("Error in registerUser:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function verifyOtp(req: Request, res: Response) {
  try {
    const { email, otp } = req.body;
    const verification = await verifyOtpWithRateLimit(email, otp, "verify");
    if (!verification.success && verification.reason === "expired") {
      return res
        .status(400)
        .json({ message: "Verification code has expired or is invalid" });
    }

    if (!verification.success) {
      if (verification.reason === "too_many_attempts") {
        return res
          .status(400)
          .json({
            message: "Too many failed attempts. Please request a new code.",
          });
      }

      return res.status(400).json({ message: "Invalid verification code" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" },
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
    const { email } = req.body;
    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isEmailVerified) {
      return res
        .status(400)
        .json({ message: "Email is already verified. Please login." });
    }

    if (await checkCooldown(email, "verify")) {
      return res.status(429).json({
        message:
          "Please wait 60 seconds before requesting another verification code.",
      });
    }

    const otp = await generateAndStoreOtp(email, "verify");

    try {
      await sendVerificationEmail(email, otp);
    } catch (emailError) {
      console.error("Email send failed in resendOtp:", emailError);
      await clearOtp(email, "verify");
      throw emailError;
    }

    return res
      .status(200)
      .json({ message: "Verification OTP resent successfully" });
  } catch (error) {
    console.error("Error in resendOtp:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function loginUser(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    const user = await userModel.findOne({ email }).select("+password");
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password as string,
    );
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
      { expiresIn: "1h" },
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
    const { email } = req.body;

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (await checkCooldown(email, "reset")) {
      return res.status(429).json({
        message:
          "Please wait 60 seconds before requesting another password reset code.",
      });
    }

    const otp = await generateAndStoreOtp(email, "reset");

    try {
      await sendPasswordResetEmail(email, otp);
    } catch (emailError) {
      console.error("Email send failed in forgotPassword:", emailError);
      await clearOtp(email, "reset");
      throw emailError;
    }

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
    const { email, otp, newPassword } = req.body;

    const verification = await verifyOtpWithRateLimit(email, otp, "reset");
    if (!verification.success && verification.reason === "expired") {
      return res
        .status(400)
        .json({ message: "Reset OTP has expired or is invalid" });
    }

    if (!verification.success) {
      if (verification.reason === "too_many_attempts") {
        return res
          .status(400)
          .json({
            message:
              "Too many failed attempts. Please request a new reset code.",
          });
      }

      return res.status(400).json({ message: "Invalid reset OTP code" });
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    return res
      .status(200)
      .json({
        message:
          "Password reset successful. Please login with your new password.",
      });
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
      sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as
        | "none"
        | "lax",
      path: "/",
      maxAge: 0,
    });

    return res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    console.error("Error in logoutUser:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


async function getMe(req: Request, res: Response) {
  try {
    const user = await userModel.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const passwordlessUser = user.toObject();
    delete passwordlessUser.password;

    return res.status(200).json({
      user: passwordlessUser,
    });
  } catch (error) {
    console.error("Error in getMe:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}


export {
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  forgotPassword,
  passwordReset,
  logoutUser,
  getMe,
};
