import React, { useEffect, useMemo, useState } from 'react';
import { Button, Result } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { onServerError, type ServerErrorEventDetail } from '../services/serverErrorBus';

type OverlayState = (ServerErrorEventDetail & { visible: true }) | { visible: false };

const overlayRootStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 3000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background:
    'radial-gradient(circle at 20% 20%, rgba(93,211,232,0.10), transparent 40%), radial-gradient(circle at 80% 30%, rgba(102,102,209,0.14), transparent 45%), #0A0817',
};

const cardStyle: React.CSSProperties = {
  width: 'min(640px, 92vw)',
  background: '#100D24',
  borderRadius: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
  border: '1px solid rgba(255,255,255,0.1)',
  padding: 8,
};

function ErrorIcon() {
  return (
    <div
      style={{
        width: 64,
        height: 64,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(255,77,79,0.12)',
        margin: '0 auto',
      }}
    >
      <WarningOutlined style={{ fontSize: 28, color: '#F47272' }} />
    </div>
  );
}

export default function ServerErrorOverlay() {
  const [state, setState] = useState<OverlayState>({ visible: false });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    return onServerError((detail) => {
      setState({ visible: true, ...detail });
    });
  }, []);

  const title = useMemo(() => (state.visible ? state.title : ''), [state]);
  const message = useMemo(() => (state.visible ? state.message : ''), [state]);

  if (!state.visible) return null;

  return (
    <div style={overlayRootStyle} role="alert" aria-live="assertive">
      <div style={cardStyle}>
        <Result
          icon={<ErrorIcon />}
          status="error"
          title={title}
          subTitle={
            <>
              {message}
            </>
          }
          extra={
            <Button
              type="primary"
              size="large"
              icon={<ReloadOutlined />}
              loading={retrying}
              onClick={() => {
                setRetrying(true);
                // Centralized retry that works across pages:
                // reloading will re-run the initial data fetches for the current route.
                window.location.reload();
              }}
              style={{
                minWidth: 160,
                borderRadius: 10,
                height: 44,
                boxShadow: '0 10px 24px rgba(24,144,255,0.25)',
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    </div>
  );
}

