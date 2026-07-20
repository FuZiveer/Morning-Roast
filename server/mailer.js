/**
 * Email delivery for account verification via Gmail SMTP.
 *
 * Env:
 *   GMAIL_USER=you@gmail.com
 *   GMAIL_APP_PASSWORD=<16-char Google App Password> (NOT your login password)
 *   MAIL_FROM="Morning Roast <you@gmail.com>" (optional)
 */
const nodemailer = require("nodemailer");

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const MAIL_FROM = process.env.MAIL_FROM || (GMAIL_USER ? `Morning Roast <${GMAIL_USER}>` : "");

let transporter = null;

function isEnabled() {
  return Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (!isEnabled()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendVerifyEmail(email, username, link) {
  const tx = getTransporter();
  if (!tx) throw new Error("Mailer not configured (missing Gmail credentials)");

  const safeName = escapeHtml(username);
  const safeLink = escapeHtml(link);

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 12px">Verify your Morning Roast account</h2>
      <p style="margin:0 0 16px">Hi ${safeName}, confirm your email to start chatting.</p>
      <p style="margin:0 0 24px">
        <a href="${safeLink}" style="display:inline-block;background:#ea0177;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Verify email</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">Or paste this link into your browser:</p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${safeLink}">${safeLink}</a></p>
      <p style="margin:0;font-size:12px;color:#888">This link expires in 24 hours. If you did not sign up, ignore this email.</p>
    </div>
  `;

  await tx.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Verify your Morning Roast account",
    text: `Hi ${username}, verify your Morning Roast account:\n\n${link}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
    html,
  });
}

module.exports = { isEnabled, sendVerifyEmail };
