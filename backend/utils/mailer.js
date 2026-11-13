const { emailLink } = require('./notifyLink');

// HOW MAIL SETTINGS ARE READ (this matters)
// The settings come from backend/.env. They are read when an email is SENT, never when this file is loaded:
// server.js loads the cron jobs (which load this file) before dotenv has read .env, so reading at load time
// found nothing and every email silently fell back to "print to the console" mode.
// The transport is built on first use and kept; nodemailer itself is also loaded then, so the tests can run
// without it.
//
//   EMAIL_USER          the Gmail address that SENDS (2-Step Verification on)
//   EMAIL_APP_PASSWORD  its 16-character App Password (spaces are ignored)
//   EMAIL_HOST / EMAIL_PORT / EMAIL_SECURE   optional; default smtp.gmail.com, 465, secure (TLS from the start).
//                       Try EMAIL_PORT=587 and EMAIL_SECURE=false if port 465 is blocked on the network.
//   EMAIL_NOTIFICATIONS=off   stop emailing notifications (in-app ones are unaffected)
let transport; // undefined = not built yet

// OPTIONAL: send through Brevo's HTTPS API instead of SMTP. Hosts such as Render's free tier block the SMTP ports (25, 465, 587)
// but allow HTTPS, so this is the way to email from there. It uses Node's built-in fetch (no extra package) and wins over SMTP
// when both are set. Nothing changes for a setup that only has EMAIL_USER / EMAIL_APP_PASSWORD.
//   BREVO_API_KEY        a Brevo API key whose only permission is "Transactional email: All"
//   BREVO_SENDER_EMAIL   a sender address that is VERIFIED in Brevo (Settings > Senders, domains, IPs > Senders)
//   BREVO_SENDER_NAME    optional, default "CCIS Sync"
let brevoFetch = (...args) => fetch(...args);
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function brevoConfig() {
  return {
    key: String(process.env.BREVO_API_KEY || '').trim(),
    email: String(process.env.BREVO_SENDER_EMAIL || '').trim(),
    name: String(process.env.BREVO_SENDER_NAME || 'CCIS Sync').trim() || 'CCIS Sync',
  };
}
const brevoReady = (c = brevoConfig()) => !!(c.key && c.email);

// Never includes the API key.
function explainBrevoError(status, body) {
  const detail = body && body.message ? String(body.message) : '';
  if (status === 401) return `Brevo rejected the API key (401). Create a new key in Brevo (SMTP & API) with Transactional email set to All, and put it in BREVO_API_KEY. ${detail}`.trim();
  if (status === 403) return `Brevo refused this request (403): the key may lack the Transactional email permission, or the account/IP is restricted. ${detail}`.trim();
  if (status === 400 && /sender/i.test(detail)) return `Brevo does not accept the sender ${brevoConfig().email}: verify it in Brevo (Settings > Senders, domains, IPs). ${detail}`.trim();
  if (status === 429) return `Brevo says the sending limit was reached (429). The free plan allows 300 emails a day. ${detail}`.trim();
  return `Brevo could not send the email (HTTP ${status}). ${detail}`.trim();
}

async function sendViaBrevo({ to, subject, html, text }) {
  const c = brevoConfig();
  const payload = { sender: { name: c.name, email: c.email }, to: [{ email: to }], subject, htmlContent: html };
  if (text) payload.textContent = text;
  let res;
  try {
    res = await brevoFetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': c.key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),   // never hang a request or a cron run
    });
  } catch (err) {
    const e = new Error(`Cannot reach Brevo (${err && err.name === 'TimeoutError' ? 'timed out after 15 s' : (err && err.message) || err}). Check the server's internet connection.`);
    e.cause = err;
    throw e;
  }
  let body = null;
  try { body = await res.json(); } catch (_) { /* some errors have no JSON body */ }
  if (!res.ok) { const e = new Error(explainBrevoError(res.status, body)); e.status = res.status; throw e; }
  return { preview: false, messageId: body && body.messageId };
}

function mailConfig() {
  const port = Number(process.env.EMAIL_PORT) || 465;
  const secureEnv = String(process.env.EMAIL_SECURE || '').trim().toLowerCase();
  return {
    user: String(process.env.EMAIL_USER || '').trim(),
    pass: String(process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, ''), // Google shows the app password in 4 groups with spaces
    host: String(process.env.EMAIL_HOST || 'smtp.gmail.com').trim(),
    port,
    secure: secureEnv ? secureEnv !== 'false' && secureEnv !== '0' : port === 465,
  };
}
const isConfigured = (c = mailConfig()) => !!(c.user && c.pass);

function getTransport() {
  if (transport !== undefined) return transport;
  const c = mailConfig();
  if (!isConfigured(c)) return null; // not cached: .env may simply not be loaded yet
  transport = require('nodemailer').createTransport({
    host: c.host, port: c.port, secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    // Never hang a request or a cron run on a dead network.
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return transport;
}

// Turn nodemailer's terse codes into something the person running the server can act on. Keeps the code.
function explainMailError(err) {
  const c = mailConfig();
  const code = err && err.code ? String(err.code) : '';
  const raw = (err && err.message) || String(err);
  let why = raw;
  if (code === 'EAUTH' || /535|Username and Password not accepted|Invalid login/i.test(raw)) {
    why = `Gmail rejected the login for ${c.user || '(no EMAIL_USER)'}. EMAIL_APP_PASSWORD must be a 16-character App Password (Google Account > Security > 2-Step Verification > App passwords), not the normal account password. (${raw})`;
  } else if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS'].includes(code)) {
    why = `Cannot reach ${c.host}:${c.port}. Check the internet connection and any firewall; if port ${c.port} is blocked try EMAIL_PORT=587 with EMAIL_SECURE=false. (${raw})`;
  } else if (code === 'EENVELOPE' || /^55[0-4]/.test(raw)) {
    why = `The mail server refused the recipient or sender address. (${raw})`;
  }
  const e = new Error(why);
  e.code = code || undefined;
  e.cause = err;
  return e;
}

// With no SMTP credentials (and not in production) nothing is emailed. sendMail() then returns
// { preview: true } so the calling route can hand the link to the page to show in a window.
const isLocalPreview = () => !isConfigured() && !brevoReady() && process.env.NODE_ENV !== 'production';

let warnedUnconfigured = false;

async function sendMail({ to, subject, html, text }) {
  if (brevoReady()) return sendViaBrevo({ to, subject, html, text });
  const t = getTransport();
  if (!t) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[email] EMAIL_USER / EMAIL_APP_PASSWORD are not set (or .env was not loaded): emails are only PRINTED below, nobody receives them.');
    }
    console.log('\n[DEV MODE: no EMAIL_USER/EMAIL_APP_PASSWORD set in .env]');
    console.log(`Would send email to: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`${html}\n`);
    return { preview: isLocalPreview() };
  }

  try {
    const info = await t.sendMail({ from: `"CCIS Sync" <${mailConfig().user}>`, to, subject, html, text });
    return { preview: false, messageId: info && info.messageId };
  } catch (err) {
    throw explainMailError(err);
  }
}

// A safe summary of the settings (the password is never shown, only how long it is).
function mailerStatus() {
  const c = mailConfig();
  const b = brevoConfig();
  return {
    provider: brevoReady(b) ? 'brevo' : isConfigured(c) ? 'smtp' : 'none',
    brevo: { configured: brevoReady(b), senderEmail: b.email, keyLength: b.key.length },   // the key itself is never exposed
    configured: isConfigured(c) || brevoReady(b), user: c.user, host: c.host, port: c.port, secure: c.secure,
    passwordLength: c.pass.length, notificationsOff: process.env.EMAIL_NOTIFICATIONS === 'off',
  };
}

// Ask the mail server whether these settings work (logs in, sends nothing).
async function verifyMailer() {
  // Brevo: there is no free "login check" for a key limited to Transactional email, so the first real message is the test.
  if (brevoReady()) return { ok: true, configured: true, provider: 'brevo', untested: true };
  if (!isConfigured()) return { ok: false, configured: false, reason: 'EMAIL_USER / EMAIL_APP_PASSWORD are not set.' };
  try {
    await getTransport().verify();
    return { ok: true, configured: true };
  } catch (err) {
    return { ok: false, configured: true, reason: explainMailError(err).message };
  }
}

// One clear line at server start, so a mail problem is visible immediately and not weeks later.
async function logMailerStatus() {
  const st = mailerStatus();
  if (st.notificationsOff) return console.warn('[email] EMAIL_NOTIFICATIONS=off: notifications are in-app only, no emails are sent.');
  const r = await verifyMailer();
  if (r.ok && r.provider === 'brevo') return console.log(`[email] Brevo API configured: sending as ${st.brevo.senderEmail} (checked only when the first email is sent).`);
  if (r.ok) console.log(`[email] ready: sending as ${st.user} through ${st.host}:${st.port}.`);
  else if (!r.configured) console.warn(`[email] NOT configured: ${r.reason} Emails will only be printed in this console.`);
  else console.error(`[email] NOT working: ${r.reason}`);
}

// For the tests only: put a fake transport in place (undefined puts the real, lazy one back).
function _setTransportForTests(t) { transport = t; warnedUnconfigured = false; }
function _setFetchForTests(f) { brevoFetch = f || ((...args) => fetch(...args)); }

async function sendVerificationEmail(to, link) {
  return sendMail({
    to,
    subject: 'Verify your email address',
    html: `<p>Welcome! Please confirm this is your email address by clicking the link below.</p>
           <p><a href="${link}">${link}</a></p>
           <p>This link expires in 24 hours.</p>`
  });
}

// Sent when an Admin approves a pending account. If the person still has to confirm their email
// address, `verifyLink` carries a fresh one-time link; otherwise `loginLink` just sends them to login.
async function sendApprovedEmail(to, { verifyLink, loginLink }) {
  const next = verifyLink
    ? `<p>One last step: confirm this is your email address by clicking the link below, then you can log in.</p>
           <p><a href="${verifyLink}">${verifyLink}</a></p>
           <p>This link expires in 24 hours. If it expires, use "Resend" on the login page to get a new one.</p>`
    : `<p>You can now log in here:</p>
           <p><a href="${loginLink}">${loginLink}</a></p>`;
  return sendMail({
    to,
    subject: 'Your account has been approved',
    html: `<p>Good news — an administrator has approved your account.</p>
           ${next}`
  });
}

async function sendResetEmail(to, link) {
  return sendMail({
    to,
    subject: 'Password reset request',
    html: `<p>A password reset was requested for this account. Click below to choose a new password.</p>
           <p><a href="${link}">${link}</a></p>
           <p>This link expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`
  });
}

const esc = (v) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A plain email copy of an in-app notification (approved, declined, cancelled, reminder, appeal...).
async function sendNotificationEmail(to, { title, message, link }) {
  const appUrl = emailLink(link); // the exact page when the link is safe, otherwise the app's home page
  return sendMail({
    to,
    subject: `CCIS Sync: ${title}`,
    // A plain-text version next to the HTML helps mail apps and spam filters.
    text: `${title}\n\n${message}\n\n${link ? 'View in CCIS Sync' : 'Open CCIS Sync'}: ${appUrl}\n\nYou are receiving this because it is also in your CCIS Sync notifications.\n`,
    html: `<p><b>${esc(title)}</b></p>
           <p>${esc(message)}</p>
           <p><a href="${esc(appUrl)}">${link ? 'View in CCIS Sync' : 'Open CCIS Sync'}</a></p>
           <p style="color:#888;font-size:12px">You are receiving this because it is also in your CCIS Sync notifications.</p>`
  });
}

module.exports = { sendMail, sendVerificationEmail, sendApprovedEmail, sendResetEmail, sendNotificationEmail, mailerStatus, verifyMailer, logMailerStatus, _setTransportForTests, _setFetchForTests };
