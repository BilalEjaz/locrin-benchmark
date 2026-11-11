import { Resend } from "resend";
import "dotenv/config";

const resend = new Resend(process.env.RESEND_API_KEY);


export async function sendVerificationEmail(to: string, code: string) {
  const fromEmail = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const appName = process.env.APP_NAME || "Auth App";

  const { data, error } = await resend.emails.send({
    from: `${appName} <${fromEmail}>`,
    to,
    subject: "Verify your email address",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
        <div style="max-width: 500px; margin: auto; background: white; padding: 30px; border-radius: 8px;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Your verification code is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #4F46E5; background: #EEF2FF; padding: 10px 20px; display: inline-block; border-radius: 6px;">
            ${code}
          </h1>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">
            This code will expire in 5 minutes.
          </p>
        </div>
      </div>
    `,
    text: `Your verification code is: ${code}. This code expires in 5 minutes.`,
    replyTo: fromEmail,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}


export async function sendPasswordResetEmail(to: string, code: string) {
  const fromEmail = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const appName = process.env.APP_NAME || "Auth App";

  const { data, error } = await resend.emails.send({
    from: `${appName} <${fromEmail}>`,
    to,
    subject: "Password Reset Request",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
        <div style="max-width: 500px; margin: auto; background: white; padding: 30px; border-radius: 8px;">
          <h2 style="color: #333;">Password Reset</h2>
          <p>We received a request to reset your password. Your reset code is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #DC2626; background: #FEF2F2; padding: 10px 20px; display: inline-block; border-radius: 6px;">
            ${code}
          </h1>
          <p style="color: #666; font-size: 14px; margin-top: 20px;">
            This code will expire in 5 minutes. If you did not request this, you can ignore this email.
          </p>
        </div>
      </div>
    `,
    text: `Your password reset code is: ${code}. This code expires in 5 minutes.`,
    replyTo: fromEmail,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}