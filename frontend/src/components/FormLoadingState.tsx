import React from 'react';
import { Spin } from 'antd';

// Shared by SelfAssessment and ManagerEvaluation while their template is
// being fetched: a centered spinner with a "Loading..." caption, rather than
// a bare spinner pinned near the top of the page.
const FormLoadingState: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: 16,
    }}
  >
    <Spin size="large" />
    <div style={{ color: '#C5C0D6', fontSize: 16, fontWeight: 500 }}>Loading...</div>
  </div>
);

export default FormLoadingState;
