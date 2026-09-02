import React from 'react';
import { Avatar, Dropdown, Typography } from 'antd';
import { MenuOutlined, UserOutlined, MailOutlined, IdcardOutlined, NumberOutlined, SafetyOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import type { MenuProps } from 'antd';

interface TopBarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
}

const TopBar: React.FC<TopBarProps> = ({
  collapsed,
  setCollapsed,
  mobileMenuOpen,
  setMobileMenuOpen
}) => {
  const { authState, logout } = useAuth();

  const handleMenuToggle = () => {
    setCollapsed(!collapsed);
  };

  const handleMobileMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      disabled: true,
      className: 'profile-menu-item',
      label: (
        <div className="profile-dropdown-card">
          <div style={{ color: '#F4F1F8', fontSize: '14px', fontWeight: 500, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <UserOutlined style={{ fontSize: '14px' }} />
            <span>{authState.user?.name || 'User'}</span>
          </div>
          <div style={{ color: '#C5C0D6', fontSize: '12px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MailOutlined style={{ fontSize: '12px' }} />
            <span>{authState.user?.email || ''}</span>
          </div>
          {authState.user?.designation && (
            <div style={{ color: '#C5C0D6', fontSize: '12px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <IdcardOutlined style={{ fontSize: '12px' }} />
              <span>{authState.user.designation}</span>
            </div>
          )}
          {authState.user?.employeeId && (
            <div style={{ color: '#C5C0D6', fontSize: '12px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <NumberOutlined style={{ fontSize: '12px' }} />
              <span>{authState.user.employeeId}</span>
            </div>
          )}
          {authState.user?.authMethod && (
            <div style={{
              color: '#C5C0D6',
              fontSize: '12px',
              marginTop: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <SafetyOutlined style={{ fontSize: '12px' }} />
              <span style={{ textTransform: 'capitalize' }}>
                {authState.user.authMethod === 'manual' ? 'Manual' : 'Microsoft'} Authentication
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
          <LogoutOutlined style={{ fontSize: '14px' }} />
          <span>Sign Out</span>
        </div>
      ),
      onClick: logout,
    },
  ];

  return (    <div className="top-bar-container">
      <div className="top-bar-left">
        <button
          className="menu-trigger desktop-menu-btn"
          onClick={handleMenuToggle}
          aria-label="Toggle menu"
        >
          <MenuOutlined />
        </button>
        <button
          className="menu-trigger mobile-menu-btn"
          onClick={handleMobileMenuToggle}
          aria-label="Toggle mobile menu"
        >
          <MenuOutlined />
        </button>
        <div className="header-logo">
          <img
            src={`${process.env.PUBLIC_URL}/favicon.png`}
            alt=""
            style={{ width: '20px', height: '20px', marginRight: '8px' }}
          />
          <span className="logo-text">Performance Management System</span>
        </div>
      </div>
      <div className="top-bar-right">
        <Dropdown
          menu={{
            items: userMenuItems,
            className: 'user-dropdown-menu',
          }}
          placement="bottomRight"
          trigger={['click']}
        >
          <div className="user-profile" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Typography.Text style={{ color: 'white', fontSize: '14px', fontWeight: 500 }}>
              {authState.user?.name || 'User'}
            </Typography.Text>
            <Avatar icon={<UserOutlined />} style={{ backgroundColor: 'var(--color-primary, #6666D1)' }} />
          </div>
        </Dropdown>
      </div>
    </div>
  );
};

export default TopBar;