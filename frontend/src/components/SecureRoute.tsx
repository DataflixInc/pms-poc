import React from 'react';
import { Spin } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import Login from './Login';

interface SecureRouteProps {
  children: React.ReactNode;
}

const SecureRoute: React.FC<SecureRouteProps> = ({ children }) => {
  const { authState } = useAuth();

  if (authState.isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: 'var(--primary-gradient)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ 
            marginTop: '20px', 
            color: 'white', 
            fontSize: '16px',
            fontWeight: '500'
          }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (!authState.isAuthenticated) {
    // Show login page with both manual and Microsoft 365 options
    return <Login />;
  }

  return <>{children}</>;
};

export default SecureRoute; 