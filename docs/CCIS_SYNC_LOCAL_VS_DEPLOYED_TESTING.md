# CCIS Sync: keeping local testing and the deployed site separate

Written Sun Nov 22, 2026. For the owner's Windows laptop (PowerShell). **No passwords, keys or full connection strings belong in this file or in chat.**

## 1. The problem

Your laptop and the deployed site (Render backend + Vercel frontend) were connected through shared settings. The biggest link was the **database**: with the same `MONGO_URI`, anything done on the laptop (a role change, a test account, an appointment) is saved in the data the live site uses.

## 2. The databases (Atlas, project Appointment-system, `Cluster0`)

| Database | Used by | Notes |
|---|---|---|
| `test` | **The deployed site (live data).** | The live connection address has no database name, so MongoDB uses `test`. Do not change Render's address casually. It holds the app's collections (appointments, announcements, consultation hours, notifications, users...). |
| `faculty_attendance` | Nothing now (an older database from August with 7 old accounts). | Leave it alone; do not delete without checking. |
| `ua_sync_dev` | **Your laptop, for testing.** | Created automatically on the first save. Starts empty. |

Rule: **only the Render environment points to `test`; only your laptop `.env` points to `ua_sync_dev`.**

## 3. What links local and deployed (and how each is separated)

| Setting | Local (`backend/.env`, `frontend/.env`) | Deployed (Render / Vercel dashboard) |
|---|---|---|
| `MONGO_URI` | database name `ua_sync_dev` | no name = `test` (live) |
| `JWT_SECRET` | its own value, different from Render's | Render's value |
| `FRONTEND_URL` | `http://localhost:5173` | the Vercel URL |
| `VITE_API_URL` (frontend) | `http://localhost:5000` | the Render URL (set in Vercel; a change needs a Vercel redeploy) |
| `VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` | same Google client is fine | same |
| `ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAIN` | local copy | Render copy |
| Email keys (`BREVO_*`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`) | **commented out with `#`** so nothing is sent to real people | set on Render only |
| Google OAuth "Authorized JavaScript origins" | add `http://localhost:5173` | add the Vercel URL |

Google rejects any address that is not listed (`localhost` and `127.0.0.1` are different addresses, and so is another port). That is the "The given origin is not allowed for the given client ID" error.

## 4. One-time setup on the laptop

Run these once, in the `backend` folder.

**Point the laptop at `ua_sync_dev`** (also saves a copy of the original `.env` outside the repo; run the whole block only once, because a second run overwrites that copy):
```powershell
cd C:\Users\chris\Desktop\Appointment-system\backend
Copy-Item .env "$HOME\ccis-env-backup.txt"
$c = Get-Content .env | ForEach-Object { if ($_ -match '^MONGO_URI=') { $_ -replace '(mongodb(\+srv)?://[^/]+)/[^?]*(\?.*)?$','$1/ua_sync_dev$3' } else { $_ } }
Set-Content .env $c
(Get-Content .env | Select-String '^MONGO_URI').ToString() -replace '//[^@]*@','//***@'
```
The last line prints the address with the password hidden. It must end with `/ua_sync_dev?` and then some options.

**Turn off real emails on the laptop** (comments out the email keys; the original is in the backup file):
```powershell
(Get-Content .env) | ForEach-Object { if ($_ -match '^(BREVO_|EMAIL_USER|EMAIL_APP_PASSWORD)') { '# ' + $_ } else { $_ } } | Set-Content .env
```

**Also edit by hand in `backend/.env`:** set `JWT_SECRET` to a value different from Render's, and `FRONTEND_URL=http://localhost:5173`.

**List the variable names without showing values** (safe to paste):
```powershell
(Get-Content .env) -replace '=.*','=…'
```

If the database user cannot create `ua_sync_dev` ("not authorized"), in Atlas > Database Access edit the user and give it the role "Read and write to any database".

## 5. Every testing session

1. Backend window:
```powershell
cd C:\Users\chris\Desktop\Appointment-system\backend
npm run dev
```
It must print `Connected to MongoDB Atlas Cloud`, the job lines, an `[email]` line that does **not** say "Brevo API selected", and `Server is running on port 5000`.
2. Frontend window:
```powershell
cd C:\Users\chris\Desktop\Appointment-system\frontend
npm run dev
```
3. Open `http://localhost:5173`. Check the address bar: `localhost` = local data, `vercel.app` = live data.
4. First sign-in on an empty database: use an email in `ADMIN_EMAILS`; it becomes Admin. The "Complete your profile" form asks the Admin for an Academic Position (a known flaw): choose **Faculty** (not Dean or a Program Head), tick the Privacy Policy and continue. It gives no permissions and the Admin is not listed as faculty.
5. Create test accounts in Admin > Provision Account (real school Google accounts that can sign in). Students cannot be provisioned yet (planned, see `CCIS_SYNC_PROVISIONING_PLAN.md`); a test student signs up through Sign up > Student with another school account.
6. Test the branch you are checking (`git fetch origin`, `git checkout BRANCH-NAME`; back with `git checkout main`).
7. Test the **deployed link** only for work that is merged to `main` and redeployed, and only with test accounts. Check the Render Events tab shows a deploy of the latest commit (if Auto-Deploy is off, use Manual Deploy > Deploy latest commit), and hard refresh with Ctrl+Shift+R.

## 6. Troubleshooting

| What you see | Cause and fix |
|---|---|
| `Failed to fetch`, `net::ERR_CONNECTION_REFUSED` to `localhost:5000` | The backend is not running. Start it (`npm run dev` in `backend`). |
| `The given origin is not allowed for the given client ID` | Add the exact browser address (for example `http://localhost:5173`) to the Google OAuth client's Authorized JavaScript origins and wait a few minutes. |
| `rs : The term 'rs' is not recognized` | `rs` only works inside nodemon's window. At a normal prompt just run `npm run dev`; the backend reads `.env` fresh on every start (nodemon does not watch `.env`). |
| Backend prints nothing after "starting node server.js" | It only listens after the database connects. Wait 20-30 seconds, then read the `Cloud Connection Error:` line. "bad auth" = wrong password in the address (compare with the backup file); "not authorized" = give the database user "Read and write to any database"; timeout = Atlas Network Access must allow `0.0.0.0/0`. |
| `EADDRINUSE` / address already in use | An older backend is still running (and may still be using the live `test` data). Find it: `Get-NetTCPConnection -LocalPort 5000 -State Listen \| Select-Object OwningProcess`, then `Stop-Process -Id` followed by that number. |
| `[email] Brevo API selected` on the laptop | The email keys are still active. Comment them out (section 4) and restart the backend. |
| Google asks a school account to change its password / 2-step verification | That is Google Workspace's own setting for that account ("ask for a password change at next sign-in"), set by whoever manages the school Google accounts. It is not part of CCIS Sync. |
| Log in says "No account found" | Log in only works for existing accounts, `ADMIN_EMAILS` and roster emails. Check the spelling and case of the email, or provision the account first. |

## 7. Safety rules

- Never paste a real `.env`, a connection string with a password, or an API key into chat or a file in the repo. Use the "hide the password" and "names only" commands above.
- Never run the old `backend/seed.js` on live data.
- Never point the laptop at `test` and never point Render at `ua_sync_dev`.
- If you changed anything on the live data while the laptop was still pointing at `test` (for example a test role change), check the live Admin page and switch it back.
- Optional later: add `/test` to Render's address to make the live database name explicit (same data). Do it only when someone can confirm the live site still works afterwards.
