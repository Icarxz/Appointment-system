# Deploying CCIS Sync (first-time hosting guide)

Plan: **MongoDB Atlas** (database, already used by the app) + **Render** (Express backend) + **Vercel** (React frontend).
The code already supports this: `FRONTEND_URL` is the CORS allow-list, `VITE_API_URL` points the browser at the API, and
`frontend/vercel.json` makes page refreshes work (the app uses `BrowserRouter`, so `/faculty-dashboard` must serve `index.html`).
Decided with the owner: the PDF importer's OCR runs **only on the owner's laptop**; on the hosted site PDF upload shows a clear
"schedule reader is not installed" message (503) and everything else works.

> Do this at least 3 days before the defense (Nov 16-19) and do not change anything the day before.

## 0. Know these limits before you start (checked against Render's docs on Nov 13, 2026: https://render.com/docs/free)
| Limit on Render free | What it means for this app |
|---|---|
| Sleeps after 15 minutes without traffic; waking takes about a minute | First request after idle is slow. The app's `node-cron` jobs (status updater, pending-request expiry, reminders, schedule-import activation) **do not run while it sleeps**. |
| 750 free instance hours per month | One always-on service (about 744 h/month) fits, but only one. |
| **Outbound ports 25, 465 and 587 are blocked** | **Gmail email (SMTP) will not send from Render free.** In-app notifications still work. Emails fall back to failing in the log. |
| Ephemeral filesystem | Nothing is stored on disk by the app (the importer deletes temp files), so this is fine. |
| No Python/Tesseract | OCR import unavailable on the hosted server (by decision). |

Fixes: (a) keep it awake with a free uptime monitor pinging the backend URL every 5 minutes (UptimeRobot or similar; the root route `/` answers);
(b) for emails either demo them from your laptop backend, set `EMAIL_NOTIFICATIONS=off` on Render, or move the backend to a host that allows SMTP.
Run `npm run check-email` locally to see what works on your own machine.

## 1. Database (MongoDB Atlas)
1. Use the existing cluster (the server logs "Connected to MongoDB Atlas Cloud"). The free M0 tier has 512 MB.
2. Atlas > Network Access > add `0.0.0.0/0` (Render's IP addresses change). This is why the database password must be strong.
3. Atlas > Database Access: a database user with a long random password. Copy the `mongodb+srv://...` string into `MONGO_URI`.
4. **Use a separate database for the hosted demo** (end the URI with a different name, e.g. `/ccis-sync-demo`), not your development data.
   Never run `backend/seed.js` on real data. Demo data comes from the app's own demo tools.

## 2. Backend on Render (Web Service)
- New > Web Service > connect the GitHub repo `Icarxz/Appointment-system`.
- Root Directory: `backend`   |   Build Command: `npm ci`   |   Start Command: `node server.js`   |   Instance: Free.
- Node: 20 or newer (set env `NODE_VERSION=20` if the build picks an old one).
- Environment variables (names from `backend/.env.example`):

| Name | Value |
|---|---|
| `MONGO_URI` | the Atlas string from step 1 |
| `JWT_SECRET` | a new long random string (do not reuse the local one) |
| `FRONTEND_URL` | your Vercel URL, exactly, with **no trailing slash**, e.g. `https://ccis-sync.vercel.app`. Several URLs: comma-separated |
| `GOOGLE_CLIENT_ID` | same OAuth client ID as the frontend |
| `ALLOWED_EMAIL_DOMAIN` | `antiquespride.edu.ph` |
| `ADMIN_EMAILS` | the admin school address(es) |
| `NODE_ENV` | `production` |
| `EMAIL_NOTIFICATIONS` | `off` on Render free (SMTP is blocked); leave `EMAIL_USER` / `EMAIL_APP_PASSWORD` unset or set them if you move hosts |

Render sets `PORT` itself; the server already uses it. After deploy open `https://<your-service>.onrender.com/`: it should answer.

## 3. Frontend on Vercel
- Add New > Project > import the repo. Root Directory: `frontend`. Framework: Vite. Build `npm run build`, output `dist`.
- Environment variables (set them **before** the first build, they are baked in at build time):
  `VITE_API_URL` = the Render URL with no trailing slash, `VITE_GOOGLE_CLIENT_ID` = the OAuth client ID.
- Then copy the Vercel URL into Render's `FRONTEND_URL` and redeploy the backend (CORS).

## 4. Google sign-in
Google Cloud Console > APIs & Services > Credentials > your OAuth Web client:
add the Vercel URL under **Authorized JavaScript origins** (keep `http://localhost:5173` for local work). Without this, sign-in fails with "origin not allowed".

## 5. Smoke test after every deploy (about 15 minutes)
Use real browsers, a phone too. Test with accounts for each role.
1. Landing page loads; refresh on `/faculty-dashboard` does not give a 404.
2. Sign in with a school Google account (Student). A non-school email is refused.
3. Student: Faculty list > a faculty > book a slot > the request appears under My Requests.
4. Faculty (second account): the request shows up (alerts bell); approve with a time; the student sees it.
5. Faculty: Master Schedule shows classes; Consultation Log and Analytics open; Print / Save as PDF works.
6. Dean: Reports and Records open; Executive Broadcast is hidden. Admin: Provision Account, Class Schedules, Appointments (read-only).
7. Admin > Class Schedules > Import Schedule PDF: upload gives the "not installed" message (expected on the hosted site); the draft-JSON fallback loads
   `ocr/fixtures/percy.extracted.json`, Check schedule passes after ticking the name box, Confirm replaces the classes, Show import history > Undo restores them.
8. Wait 20 minutes with no traffic, open the site: first load is slow (cold start) but works. Open Render logs and confirm no crash loop.

## 6. Defense-day tips
- Open the site 10 minutes early to wake the backend, or keep the uptime monitor running.
- Have the laptop backend ready as a fallback (`npm run dev` in `backend` and `frontend`), with the Atlas IP allow-list including your venue network (or `0.0.0.0/0`).
- Do OCR demos on the laptop only: install Tesseract + poppler + `pip install opencv-python numpy pytesseract pymupdf`, set `OCR_PYTHON` if Python is not `python3`.
- Never put real secrets in the repo; rotate `JWT_SECRET` and the DB password after the defense if they were shared.

## What I could not verify
I cannot reach your hosting accounts or run `npm run build` from my sandbox, so none of the steps above has been executed. Vercel's current free-plan
limits were not checked; read them on vercel.com/pricing before relying on them.
