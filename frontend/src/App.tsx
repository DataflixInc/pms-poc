import React from 'react';
import { ConfigProvider } from 'antd';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import SecureRoute from './components/SecureRoute';
import ErrorBoundary from './components/ErrorBoundary';
import ServerErrorOverlay from './components/ServerErrorOverlay';
import MainApp from './components/MainApp';
import Login from './components/Login';
import LoginCallback from './components/LoginCallback';
import DashboardContent from './components/DashboardContent';
import SelfAssessment from './components/selfassesment';
import ManagerEvaluationsList from './components/ManagerEvaluationsList';
import ManagerEmployeeReview from './components/ManagerEmployeeReview';
import HRDashboard from './components/HRDashboard';
import HREmployeeDetails from './components/HREmployeeDetails';
import MyReviewDetails from './components/MyReviewDetails';
import Employees from './components/Employees';
import antdTheme from './styles/antdTheme';
import './App.css';
import './styles/gradient-theme.css';

// Protected Layout Wrapper component
const ProtectedLayout: React.FC = () => {
  return (
    <SecureRoute>
      <MainApp />
    </SecureRoute>
  );
};

const App: React.FC = () => {
  return (
    <ConfigProvider theme={antdTheme}>
      <ErrorBoundary>
      <AuthProvider>
        <ServerErrorOverlay />
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/login/callback" element={<LoginCallback />} />

          {/* Protected routes */}
          <Route element={<ProtectedLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardContent />} />
            <Route path="self-assessment/:templateId" element={<SelfAssessment />} />
            <Route path="my-reviews" element={<MyReviewDetails />} />
            <Route path="manager-evaluation" element={<ManagerEvaluationsList />} />
            <Route path="manager-evaluation/:employeeId" element={<ManagerEmployeeReview />} />
            <Route path="hr-dashboard" element={<HRDashboard />} />
            <Route path="hr-dashboard/:employeeId" element={<HREmployeeDetails />} />
            <Route path="employees" element={<Employees />} />
          </Route>

          {/* Catch all route - redirect to dashboard (but only if not a public route) */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
      </ErrorBoundary>
    </ConfigProvider>
  );
};

export default App;
