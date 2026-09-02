import React from 'react';
import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FormOutlined,
  SolutionOutlined,
  IdcardOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { authState } = useAuth();
  const hasTeam = authState.user?.hasTeam || false;
  const isHR = authState.user?.isHR || false;
  const isCDO = authState.user?.isCDO || false;

  const getSelectedKeys = (): string[] => {
    const path = location.pathname;
    if (path === '/' || path === '/dashboard') return ['dashboard'];
    if (path.startsWith('/manager-evaluation')) return ['manager-Review'];
    if (path.startsWith('/hr-dashboard')) return ['hr-dashboard'];
    if (path.startsWith('/employees')) return ['employees'];
    return [];
  };

  const menuItems = [
    {
      key: 'dashboard',
      icon: <FormOutlined />,
      label: 'Self Review',
      onClick: () => {
        navigate('/dashboard');
      },
    },
    ...(hasTeam ? [{
      key: 'manager-Review',
      icon: <SolutionOutlined />,
      label: 'Manager Review',
      onClick: () => {
        navigate('/manager-evaluation');
      },
    }] : []),
    ...(isHR ? [{
      key: 'hr-dashboard',
      icon: <IdcardOutlined />,
      // Same page/route as regular HR — the CDO's real job there is final
      // approval (the Overall Review tab), so the label reflects that
      // instead of "HR Review", which reads oddly for someone who isn't HR.
      label: isCDO ? 'Overall Review' : 'HR Review',
      onClick: () => {
        navigate('/hr-dashboard');
      },
    }] : []),
    // CDO shares HR-level access but shouldn't see employee management —
    // that stays HR-only.
    ...(isHR && !isCDO ? [{
      key: 'employees',
      icon: <TeamOutlined />,
      label: 'Employees',
      onClick: () => {
        navigate('/employees');
      },
    }] : []),
  ];

  return (
    <Menu
      mode="inline"
      selectedKeys={getSelectedKeys()}
      className="main-sidebar"
      items={menuItems}
    />
  );
};

export default Sidebar;
