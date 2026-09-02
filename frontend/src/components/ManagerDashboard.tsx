import React from 'react';
import { Card, Typography, Divider } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import '../styles/managerDashboard.css';

const { Text } = Typography;

// Reusable summary-card surface for this page (dark background, purple
// border, 18px radius, hover elevation, soft shadow, 24px padding, equal
// height within its row) — kept as its own component so later work can drop
// real content into `children` (or add more cards) without touching the
// card's own visual recipe, which lives entirely in managerDashboard.css.
export const ManagerOverviewCard: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <Card className="manager-overview-card" bordered={false}>
    {children}
  </Card>
);

export interface SummaryStatCardProps {
  // A ReactNode (not a fixed icon component) so every future summary card
  // can reuse this same layout with its own icon, rather than this
  // component hardcoding one icon for every stat it might ever show.
  icon: React.ReactNode;
  // The stat itself is the one thing callers must never hardcode at the
  // call site — it always comes from real data (a prop), even before that
  // data is wired up to a real API.
  value: number | string;
  title: string;
  // Optional — this card reads fine as just "icon + number + title" alone
  // (that's how Total Reportees renders it), so callers that don't have a
  // subtitle worth showing aren't forced to invent one.
  subtitle?: string;
  iconColor?: string;
  iconBackground?: string;
}

// Generic "icon + big number + title (+ optional subtitle)" summary card —
// left-aligned throughout, reused by every plain-stat card on this
// dashboard. Only the props differ per card, never this component's own
// markup/CSS.
export const SummaryStatCard: React.FC<SummaryStatCardProps> = ({
  icon,
  value,
  title,
  subtitle,
  iconColor = '#FFFFFF',
  iconBackground = '#3B82F6',
}) => (
  <ManagerOverviewCard>
    <div className="summary-stat-card-icon" style={{ color: iconColor, backgroundColor: iconBackground }}>
      {icon}
    </div>
    <div className="summary-stat-card-value">{value}</div>
    <div className="summary-stat-card-title">{title}</div>
    {subtitle && <Text className="summary-stat-card-subtitle">{subtitle}</Text>}
  </ManagerOverviewCard>
);

// One "icon + label + count" line within a ReviewStatusCard (e.g. "Submitted
// 16") — internal to this file since it's never meaningful on its own
// outside that card. The count is colored the same as its row's own icon
// (green for submitted/completed, orange for pending) rather than a flat
// neutral text color, so the number itself carries the status at a glance.
const ReviewStatusRow: React.FC<{
  icon: React.ReactNode;
  color: string;
  label: string;
  count: number | string;
}> = ({ icon, color, label, count }) => (
  <div className="review-status-row">
    <span className="review-status-row-icon" style={{ color }}>{icon}</span>
    <span className="review-status-row-label">{label}</span>
    <span className="review-status-row-count" style={{ color }}>{count}</span>
  </div>
);

export interface ReviewStatusCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  iconColor?: string;
  iconBackground?: string;
  submittedCount: number | string;
  submittedLabel?: string;
  pendingCount: number | string;
  pendingLabel?: string;
}

// Generic "submitted vs. not submitted" breakdown card — header (icon,
// title, subtitle), a divider, then two plain rows (no progress bar/
// percentage/chart, by design). Reused by every review-status card on this
// dashboard (Self Reviews, Manager Reviews) with different props, never a
// copy of this markup/CSS.
export const ReviewStatusCard: React.FC<ReviewStatusCardProps> = ({
  icon,
  title,
  subtitle,
  iconColor = '#FFFFFF',
  iconBackground = '#3B82F6',
  submittedCount,
  submittedLabel = 'Submitted',
  pendingCount,
  pendingLabel = 'Not Submitted',
}) => (
  <ManagerOverviewCard>
    <div className="review-status-header">
      <div className="summary-stat-card-icon" style={{ color: iconColor, backgroundColor: iconBackground }}>
        {icon}
      </div>
      <div>
        <div className="review-status-card-title">{title}</div>
        <Text className="review-status-card-subtitle">{subtitle}</Text>
      </div>
    </div>
    <Divider className="review-status-divider" />
    <div className="review-status-rows">
      <ReviewStatusRow
        icon={<CheckCircleOutlined />}
        color="var(--color-success, #4ADE80)"
        label={submittedLabel}
        count={submittedCount}
      />
      <ReviewStatusRow
        icon={<ClockCircleOutlined />}
        color="var(--color-warning, #F0C97A)"
        label={pendingLabel}
        count={pendingCount}
      />
    </div>
  </ManagerOverviewCard>
);
