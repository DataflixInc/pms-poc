import React, { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Spin } from 'antd';

const LoginCallback: React.FC = () => {
  const { initAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // For Microsoft authentication, the redirect is handled automatically by MSAL
        // We just need to refresh the auth state
        await initAuth();
        navigate('/', { replace: true });
      } catch (error) {
        console.error('Login callback error:', error);
        // If there's an error, redirect to root and let SecureRoute handle it
        navigate('/', { replace: true });
      }
    };

    handleCallback();
  }, [navigate, initAuth]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh' 
    }}>
      <Spin size="large" />
    </div>
  );
};

export default LoginCallback;