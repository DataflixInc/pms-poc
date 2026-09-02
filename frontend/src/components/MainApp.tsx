import React, { useState } from 'react';
import { Layout } from 'antd';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const { Sider, Header, Content } = Layout;

const MainApp: React.FC = () => {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const location = useLocation();

  return (
    <Layout className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <Header className="app-header">
        <TopBar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
        />
      </Header>
      <Layout className="site-layout">
        <Sider
          className={`app-sider ${mobileMenuOpen ? 'mobile-open' : ''}`}
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={220}
        >
          <Sidebar />
        </Sider>
        {/* Mobile overlay */}
        <div 
          className={`mobile-overlay ${mobileMenuOpen ? 'show' : ''}`}
          onClick={() => setMobileMenuOpen(false)}
        />
        <Content className={`app-content ${location.pathname.startsWith('/self-assessment/') || location.pathname.startsWith('/manager-evaluation/') || location.pathname === '/dashboard' ? 'allow-scroll' : ''}`}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainApp;