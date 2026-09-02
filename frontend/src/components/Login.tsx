import React, { useState, useRef, useEffect } from 'react';
import { Card, Button, Typography, notification, Tabs, Form, Input, InputRef } from 'antd';
import { SafetyOutlined, UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import Swal from 'sweetalert2';
import './Login.css';

const { Title, Text } = Typography;

interface LoginFormData {
  username: string;
  password: string;
}

const Login: React.FC = () => {
  const { login: microsoftLogin, manualLogin } = useAuth();
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const passwordRef = useRef<InputRef>(null);

  const handleMicrosoftLogin = async () => {
    setMicrosoftLoading(true);
    try {
      await microsoftLogin();
      // Redirect to main page after successful login
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 100);
    } catch (error: any) {
      notification.error({
        message: 'Microsoft Login Failed',
        description: error.message || 'Failed to initiate Microsoft login.',
      });
      setMicrosoftLoading(false);
    }
  };

  const handleManualLogin = async (values: LoginFormData) => {
    setLoading(true);
    try {
      await manualLogin(values.username, values.password);
      await Swal.fire({
        icon: 'success',
        title: 'Login Successful',
        text: 'Welcome back!',
        timer: 1500,
        showConfirmButton: false,
      });
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 100);
    } catch (error: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Login Failed',
        text: error.message || 'Invalid username or password. Please try again.',
      });
      setLoading(false);
    }
  };

  // Handle password autofill UI
  useEffect(() => {
    const checkPasswordAutofill = () => {
      if (passwordRef.current?.input) {
        const inputElement = passwordRef.current.input;
        const isAutofilled = window.getComputedStyle(inputElement, null).getPropertyValue('background-color') !== 'rgba(0, 0, 0, 0)' &&
          window.getComputedStyle(inputElement, null).getPropertyValue('background-color') !== 'transparent';
        
        if (isAutofilled) {
          inputElement.style.backgroundColor = '#100D24';
        }
      }
    };

    // Check immediately
    checkPasswordAutofill();

    // Check after a short delay to catch autofill
    const timeout = setTimeout(checkPasswordAutofill, 100);
    return () => clearTimeout(timeout);
  }, []);








  return (
    <>
      <style>
        {`
          @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(180deg); }
          }
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .login-card {
            animation: fadeInUp 0.6s ease-out;
          }
          .microsoft-login-btn {
            background: var(--primary-gradient) !important;
            border: none !important;
            color: white !important;
            box-shadow: var(--primary-shadow) !important;
            height: 45px !important;
            width: 100% !important;
            border-radius: 8px !important;
            font-size: 14px !important;
          }
          .microsoft-login-btn:hover {
            background: var(--primary-gradient-hover) !important;
            transform: translateY(-2px) !important;
            box-shadow: var(--primary-shadow-hover) !important;
          }
          .microsoft-login-btn:focus {
            background: var(--primary-gradient) !important;
            box-shadow: var(--primary-shadow) !important;
          }
        `}
      </style>
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'var(--hero-gradient)',
        padding: '20px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Background decoration */}
        <div style={{
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)',
          animation: 'float 6s ease-in-out infinite'
        }} />
      
      <Card
        className="login-card"
        style={{
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.45)',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
          background: 'rgba(16, 13, 36, 0.92)',
          position: 'relative',
          zIndex: 1
        }}
        styles={{ body: { padding: '0' } }}
      >
        <div style={{ padding: '30px 40px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <Title level={2} style={{
              color: '#F4F1F8',
              marginBottom: '8px',
              fontWeight: '700',
              fontSize: '28px'
            }}>
              Welcome Back
            </Title>
          </div>
        </div>

        <div style={{ padding: '0 40px 20px' }}>
          <Tabs
            defaultActiveKey="microsoft"
            items={[
              {
                key: 'microsoft',
                label: 'Microsoft 365',
                children: (
                  <div style={{ padding: '10px 0' }}>
                    <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                      <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '20px',
                        background: 'var(--hero-gradient)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 15px',
                        boxShadow: 'var(--primary-shadow-hover)'
                      }}>
                        <SafetyOutlined style={{ fontSize: '32px', color: '#fff' }} />
                      </div>
                      <Title level={3} style={{ color: '#F4F1F8', marginBottom: '5px', fontWeight: '600' }}>
                        Microsoft 365
                      </Title>
                      <Text type="secondary" style={{ fontSize: '14px', color: '#C5C0D6' }}>
                        Sign in with your Microsoft account
                      </Text>
                    </div>
                    
                    <Button
                      className="microsoft-login-btn"
                      onClick={handleMicrosoftLogin}
                      loading={microsoftLoading}
                      block
                      size="large"
                      type="primary"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <SafetyOutlined style={{ marginRight: '8px', fontSize: '18px' }} />
                      Continue with Microsoft 365
                    </Button>
                    
                    <div style={{ textAlign: 'center', marginTop: '15px' }}>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        You'll be redirected to your organization's login page
                      </Text>
                    </div>
                  </div>
                ),
              },
              {
                key: 'manual',
                label: 'Manual Login',
                children: (
                  <Form
                    form={form}
                    onFinish={handleManualLogin}
                    layout="vertical"
                    style={{ padding: '10px 0' }}
                  >
                    <Form.Item
                      name="username"
                      rules={[{ required: true, message: 'Please enter your username' }]}
                    >
                      <Input
                        prefix={<UserOutlined />}
                        placeholder="Username"
                        size="large"
                        style={{ height: '45px', borderRadius: '8px' }}
                      />
                    </Form.Item>
                    <Form.Item
                      name="password"
                      rules={[{ required: true, message: 'Please enter your password' }]}
                    >
                      <Input.Password
                        ref={passwordRef}
                        prefix={<LockOutlined />}
                        placeholder="Password"
                        size="large"
                        style={{ height: '45px', borderRadius: '8px' }}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={loading}
                        block
                        size="large"
                        style={{
                          height: '45px',
                          borderRadius: '8px',
                          fontWeight: '600',
                        }}
                      >
                        Sign In
                      </Button>
                    </Form.Item>
                  </Form>
                ),
              },
            ]}
          />
        </div>

        <div style={{
          textAlign: 'center',
          padding: '20px 40px 30px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          marginTop: '0',
          background: 'linear-gradient(135deg, #100D24 0%, #16122E 100%)',
          borderRadius: '0 0 20px 20px'
        }}>
          <Text type="secondary" style={{
            fontSize: '14px',
            color: '#C5C0D6',
            fontWeight: '500'
          }}>
            Having trouble? Contact your administrator
          </Text>
        </div>
      </Card>
      </div>
    </>
  );
};

export default Login;