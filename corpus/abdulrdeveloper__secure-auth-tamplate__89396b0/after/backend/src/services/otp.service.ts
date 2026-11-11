import crypto from "crypto";
import redis from "./redis.service.js";

export type OtpType = "verify" | "reset";

type VerificationResult = { success: true } | {
      success: false;
      reason: "expired" | "invalid" | "too_many_attempts";
    };

const OTP_EXPIRY = 300;
const COOLDOWN = 60;
const MAX_ATTEMPTS = 5;


const getKeys = (email: string, type: OtpType) => {
  const prefix = type === "verify" ? "verify" : "reset";

  return {
    otp: `auth:${prefix}_otp:${email}`,
    cooldown: `auth:${prefix === "verify" ? "otp" : "reset"}_cooldown:${email}`,
    attempts: `auth:${prefix}_attempts:${email}`,
  };
};

export const checkCooldown = async (email: string, type: OtpType) =>
  Boolean(await redis.get(getKeys(email, type).cooldown));


export const generateAndStoreOtp = async (email: string, type: OtpType) => {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const keys = getKeys(email, type);

  await redis.set(keys.otp, otp, { ex: OTP_EXPIRY });
  await redis.set(keys.cooldown, "1", { ex: COOLDOWN });
  await redis.del(keys.attempts);

  return otp;
};


export const verifyOtpWithRateLimit = async (
  email: string,
  otp: string,
  type: OtpType,
): Promise<VerificationResult> => {
  const keys = getKeys(email, type);
  const storedOtp = await redis.get<string>(keys.otp);

  if (!storedOtp) {
    return { success: false, reason: "expired" };
  }

  if (String(storedOtp).trim() === String(otp).trim()) {
    await redis.del(keys.otp, keys.attempts);
    return { success: true };
  }

  const attempts = await redis.incr(keys.attempts);
  if (attempts === 1) {
    await redis.expire(keys.attempts, OTP_EXPIRY);
  }

  if (attempts >= MAX_ATTEMPTS) {
    await redis.del(keys.otp, keys.attempts);
    return { success: false, reason: "too_many_attempts" };
  }

  return { success: false, reason: "invalid" };
};


export const clearOtp = async (email: string, type: OtpType) => {
  const keys = getKeys(email, type);
  await redis.del(keys.otp, keys.cooldown, keys.attempts);
};
