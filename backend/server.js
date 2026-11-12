// Load backend/.env BEFORE anything else: the job files below load the mailer, which needs EMAIL_USER and
// EMAIL_APP_PASSWORD. (Loading .env later left the mailer without credentials, so no email was ever sent.)
require('dotenv').config();
const startStatusUpdater = require('./jobs/statusUpdater');
const startConsultationReminder = require('./jobs/consultationReminder');
const startMissedAppointments = require('./jobs/missedAppointments');
const startPendingExpiry = require('./jobs/pendingExpiry');
const startScheduleImportActivation = require('./jobs/scheduleImportActivation');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Initialize the Express app
const app = express();

// Middleware
// Only the frontend URL(s) listed in .env may call this API from a browser.
// FRONTEND_URL can be a single URL ("http://localhost:5173") or a comma-separated
// list ("http://localhost:5173,https://your-deployed-site.vercel.app").
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server) and
    // any origin explicitly listed in FRONTEND_URL.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json()); // Allows the server to accept JSON data in requests

// ROUTES
const facultyRoutes = require('./routes/faculty');
app.use('/api/faculty', facultyRoutes);

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes); // This adds the /api/auth prefix

const scheduleImportRoutes = require('./routes/scheduleImport');
app.use('/api/schedule-import', scheduleImportRoutes); // Faculty Schedule PDF Importer: review and check a draft (Faculty own / Admin)

const analyticsRoutes = require('./routes/analytics');
app.use('/api/analytics', analyticsRoutes); // Reports & Analytics (Admin/Dean only)

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas Cloud');

    startStatusUpdater();
    startConsultationReminder();
    startMissedAppointments();
    startPendingExpiry();
    startScheduleImportActivation();

    // Say plainly at startup whether email works (it never blocks or stops the server).
    require('./utils/mailer').logMailerStatus().catch(err => console.error('[email] status check failed:', err.message));

    // Only start listening for requests AFTER the database connects
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Cloud Connection Error:', error.message);
  });

// A simple test route to make sure the server is alive
app.get('/', (req, res) => {
  res.send('Faculty Attendance API is running...');
});
