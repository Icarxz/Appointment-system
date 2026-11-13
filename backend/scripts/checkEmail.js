// Checks that email really works, from the backend folder:
//
//   node scripts/checkEmail.js                       settings + login check (sends nothing)
//   node scripts/checkEmail.js you@antiquespride.edu.ph   ...and sends ONE test message to that address
//   (or:  npm run check-email -- you@antiquespride.edu.ph)
//
// It never prints the app password (only how many characters it has) and it does not touch the database.
require('dotenv').config();
const { mailerStatus, verifyMailer, sendNotificationEmail } = require('../utils/mailer');

async function main() {
  const st = mailerStatus();
  console.log('--- Email settings (secrets hidden) ---');
  console.log(`Provider             : ${st.provider === 'brevo' ? 'Brevo API (HTTPS), wins over SMTP' : st.provider === 'smtp' ? 'Gmail/SMTP' : '(none configured)'}`);
  if (st.brevo.configured) console.log(`BREVO_SENDER_EMAIL   : ${st.brevo.senderEmail}   (BREVO_API_KEY set, ${st.brevo.keyLength} characters)`);
  console.log(`EMAIL_USER           : ${st.user || '(not set)'}`);
  console.log(`EMAIL_APP_PASSWORD   : ${st.passwordLength ? `set, ${st.passwordLength} characters` : '(not set)'}${st.passwordLength && st.passwordLength !== 16 ? '   <-- a Gmail app password is 16 characters (spaces ignored)' : ''}`);
  console.log(`Server               : ${st.host}:${st.port} (${st.secure ? 'TLS from the start' : 'STARTTLS'})`);
  console.log(`EMAIL_NOTIFICATIONS  : ${st.notificationsOff ? 'off (no notification emails are sent)' : 'on'}`);
  console.log(`FRONTEND_URL         : ${process.env.FRONTEND_URL || '(not set, links will use http://localhost:5173)'}`);

  console.log('\n--- Login check ---');
  const r = await verifyMailer();
  if (!r.ok) {
    console.error(`FAILED: ${r.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(r.untested ? 'Brevo is configured. It cannot be checked without sending: add an address below to send a real test.' : 'OK: the mail server accepted the login.');

  const to = process.argv[2];
  if (!to) { console.log('\nNo address given, so no message was sent. Add one to send a test:  node scripts/checkEmail.js you@example.com'); return; }

  console.log(`\n--- Sending one test message to ${to} ---`);
  try {
    const out = await sendNotificationEmail(to, {
      title: 'Test email',
      message: 'If you can read this, CCIS Sync can send email. It was sent by scripts/checkEmail.js.',
      link: null,
    });
    console.log(`SENT${out && out.messageId ? ` (id ${out.messageId})` : ''}. Check the inbox, and the spam folder too.`);
  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error('Unexpected error:', err.message); process.exitCode = 1; });
