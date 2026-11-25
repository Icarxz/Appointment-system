const mongoose = require('mongoose');
const { STUDENT_ID_REGEX, EMPLOYEE_ID_REGEX } = require('../utils/idValidator');
const { PROGRAMS } = require('../utils/programs');
const { EMPLOYMENT_TYPES } = require('../utils/employment');
const { activationAtForNewAccount } = require('../utils/activation');

const UserSchema = new mongoose.Schema({
  role: { 
    type: String, 
    enum: ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'], 
    required: true 
  },
  name: { type: String, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Prefer not to say'] }, // Male / Female are the only choices now; 'Prefer not to say' stays valid ONLY so accounts that already have it still save. Accounts created earlier may have none.
  email: { type: String, required: true, unique: true },
  
  // === NEW: Authentication & Security Fields ===
  password: { type: String },
  accountStatus: {
    type: String,
    enum: ['ACTIVE', 'PENDING_APPROVAL', 'ARCHIVED', 'RESTRICTED'],
    default: 'ACTIVE'
  },
  activatedAt: { type: Date, default: null },

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
      if (this.role !== 'FACULTY' && this.role !== 'DEAN') return true;
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
  credentialsConfirmedAt: { type: Date, default: null }, // set after a newly provisioned user confirms their account details
  googleSub: { type: String, unique: true, sparse: true }, // Google's stable account id
  room: { type: String }, 
  // The program a faculty member belongs to (optional). A Program Head's program is implied by the position (see utils/programs.js).
  program: { type: String, enum: PROGRAMS },
  // Full-time or part-time (optional; faculty only). Set on the faculty's own profile or by the Admin.
  employmentType: { type: String, enum: EMPLOYMENT_TYPES },
  // DEAN only: the Dean can switch on student consultation requests (see utils/consultable.js). Off by default, so nothing changes for a Dean who does not want them.
  acceptsConsultations: { type: Boolean, default: false },
  // Most consultation requests ONE student may make with this person in a Monday-Sunday week (utils/weeklyLimit.js). Empty = no limit (all faculty). The Dean starts at 5.
  weeklyRequestLimit: { type: Number, min: 1, max: 50 },
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

UserSchema.pre('save', function () {
  const activatedAt = activationAtForNewAccount(this);
  if (activatedAt) this.activatedAt = activatedAt;
});

module.exports = mongoose.model('User', UserSchema);