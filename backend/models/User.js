const mongoose = require('mongoose');
const { STUDENT_ID_REGEX, EMPLOYEE_ID_REGEX } = require('../utils/idValidator');

const UserSchema = new mongoose.Schema({
  role: { 
    type: String, 
    enum: ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'], 
    required: true 
  },
  name: { type: String, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Prefer not to say'] }, // collected at registration; accounts created earlier won't have it
  email: { type: String, required: true, unique: true },
  
  // === NEW: Authentication & Security Fields ===
  password: { type: String },
  accountStatus: {
    type: String,
    enum: ['ACTIVE', 'PENDING_APPROVAL', 'ARCHIVED', 'RESTRICTED'],
    default: 'ACTIVE'
  },

  // Email verification
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String, select: false },
  verificationTokenExpires: { type: Date, select: false },
  privacyAcceptedAt: { type: Date, default: null }, // when they agreed to the Privacy Policy at registration

  // Forgot-password flow
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },

  // Profile photo: a small (<= ~64 KB) square JPEG/PNG/WebP data URL set by the person in My Profile.
  // select:false keeps it out of lists (users/all, faculty status); only /api/auth/me returns it.
  avatar: { type: String, select: false },

  noIdYet: { type: Boolean, default: false }, // registered without a School/Faculty ID; an Admin adds it later in User Management

  schoolId: {
  type: String,
  required: false,
  unique: true,
  sparse: true,
  set: (v) => v ? v.toUpperCase() : v,
  validate: {
    validator: function(v) {
      if (!v) return true; // no ID yet — allowed, will be flagged instead
      if (this.role !== 'STUDENT') return true;
      return STUDENT_ID_REGEX.test(v);
    },
    message: props => `${props.value} is not a valid Student ID format. Use 2025-S00001 or 2025-1234-A.`
  }
},

facultyId: {
  type: String,
  required: false,
  unique: true,
  sparse: true,
  set: (v) => v ? v.toUpperCase() : v,
  validate: {
    validator: function(v) {
      if (!v) return true; // no ID yet — allowed, will be flagged instead
      if (this.role !== 'FACULTY') return true;
      return EMPLOYEE_ID_REGEX.test(v);
    },
    message: props => `${props.value} is not a valid Faculty ID format. Use 2025S-00001.`
  }
},

  // MODIFIED: Removed 'required: true' so users can register without crashing the DB
  qrHash: { type: String, unique: true, sparse: true }, 
  
  // Required once the user has finished onboarding. Accounts created by Google sign-in start
  // without it and are asked for it on first login (see routes/auth.js -> /onboarding).
  programPosition: { type: String, required: function () { return this.onboardingComplete !== false; } },
  onboardingComplete: { type: Boolean, default: true }, // existing accounts are already complete
  googleSub: { type: String, unique: true, sparse: true }, // Google's stable account id
  room: { type: String }, 
  currentStatus: {
      type: String,
      enum: ['AVAILABLE', 'IN_CLASS', 'IN_CONSULTATION', 'IN_MEETING', 'ON_BREAK', 'OUT_OF_OFFICE', 'ON_LEAVE', 'ABSENT', 'NOT_UPDATED'],
      default: 'OUT_OF_OFFICE'
  },
  // True when faculty manually set their own status via the dashboard.
  // The cron respects this until the NEXT scheduled block (class or consultation) starts,
  // then clears it and resumes automatic status.
  isManualOverride: { type: Boolean, default: false },
  currentLocation: { type: String }, 
  statusUpdatedAt: { type: Date, default: null },
  noticeMessage: { type: String, default: '' },
  flaggedDate: { type: String, default: '' },
  flaggedReason: { type: String, default: '' },
  statusNote: { type: String, default: '' },
  isDemo: { type: Boolean }, // set only on records made by scripts/demoData.js, so they can be removed
}, { timestamps: true });



module.exports = mongoose.model('User', UserSchema);