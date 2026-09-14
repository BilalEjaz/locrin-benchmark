import 'server-only';
import sgMail, { MailDataRequired } from '@sendgrid/mail';

export type SendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  category?: string;
  sandbox?: boolean;
};

const API_KEY = process.env.SENDGRID_API_KEY;
if (!API_KEY) throw new Error('SENDGRID_API_KEY is not set');

sgMail.setApiKey(API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || 'noreplay@medstudy.cz';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Quiz Service';
const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO || 'sales@medstudy.cz';

async function sendWithRetry(message: MailDataRequired, attempts = 3): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await sgMail.send(message);
      return;
    } catch (err: any) {
      console.error(`[email] SendGrid attempt ${i} failed`, err?.response?.body || err);
      if (i === attempts) throw err;
      await new Promise(r => setTimeout(r, 300 * i * i));
    }
  }
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo = DEFAULT_REPLY_TO,
  category = 'quiz',
  sandbox = process.env.NODE_ENV !== 'production',
}: SendEmailParams): Promise<boolean> {
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length) throw new Error('Invalid recipient email');

  const msg: MailDataRequired = {
    to: recipients,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    replyTo,
    subject,
    html,
    ...(text ? { text } : {}),
    categories: [category],
    /*     mailSettings: {
          sandboxMode: { enable: Boolean(sandbox) },
        }, */
    mailSettings: { sandboxMode: { enable: false } },
    trackingSettings: {
      clickTracking: { enable: true, enableText: true },
      openTracking: { enable: true },
    },
  };

  try {
    await sendWithRetry(msg);
    return true;
  } catch {
    return false;
  }
}
