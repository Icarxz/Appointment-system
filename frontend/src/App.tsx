import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import FacultyDashboard from './components/FacultyDashboard';
import AdminDashboard from './components/AdminDashboard';
import DeanDashboard from './components/DeanDashboard';
import StudentDashboard from './components/StudentDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import VerifyEmail from './components/VerifyEmail';
import ResetPassword from './components/ResetPassword';
import ImportSessionProvider from './context/ImportSessionContext';
// import StudentCheckIn from './components/StudentCheckIn';


export default function App() {
  return (
    <Router>
      <ImportSessionProvider>
        <Routes>
        {/* Public Login */}
        <Route path="/" element={<LandingPage />} />
        
        {/* The Student View: STRICTLY STUDENT ONLY */}
        <Route 
          path="/student-dashboard" 
          element={
            <ProtectedRoute allowedRoles={['STUDENT']}>
              <StudentDashboard /> 
            </ProtectedRoute>
          } 
        />
        
        {/* The Faculty View: STRICTLY FACULTY ONLY */}
        <Route 
          path="/faculty-dashboard" 
          element={
            <ProtectedRoute allowedRoles={['FACULTY']}>
              <FacultyDashboard />
            </ProtectedRoute>
          } 
        />

        {/* The Admin View: STRICTLY ADMIN ONLY */}
        <Route 
          path="/admin-dashboard" 
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />

        {/* The Dean View: STRICTLY DEAN ONLY */}
        <Route 
          path="/dean-dashboard" 
          element={
            <ProtectedRoute allowedRoles={['DEAN']}>
              <DeanDashboard />
            </ProtectedRoute>
          } 
        />

        {/* <Route element={<StudentCheckIn />} path="/attend/:token" /> */}

        {/* Public: links clicked from the verification / password-reset emails */}
        <Route path="/verify-email/:token" element={<VerifyEmail />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />

        {/* Catch-all: If they type a weird URL or try to bypass, send them to login */}
        <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </ImportSessionProvider>
    </Router>
  );
}