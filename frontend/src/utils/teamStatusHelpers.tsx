import React from 'react';

// "Sruthi Narala" -> "SN"; falls back to the first two letters for a
// single-word name, since there's no second word to take an initial from.
export const getInitials = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// "in_progress" and "rejected" are kept for a consistent look if a status
// like that is ever exposed by the API — "rejected" is now actually used,
// for HR/CDO's decision on a Manager Evaluation (see HRManagerEvaluationTab,
// ManagerEvaluation.tsx). "approved" is that same decision's other outcome.
export type StatusKind =
  | 'submitted'
  | 'draft'
  | 'in_progress'
  | 'not_started'
  | 'not_available'
  | 'ready'
  | 'approved'
  | 'rejected';

export const STATUS_CONFIG: Record<StatusKind, { label: string; color: string; background: string }> = {
  submitted: { label: 'Submitted', color: '#4ADE80', background: 'rgba(74, 222, 128, 0.15)' },
  draft: { label: 'Draft', color: '#F0C97A', background: 'rgba(240, 201, 122, 0.15)' },
  in_progress: { label: 'In Progress', color: '#F0C97A', background: 'rgba(240, 201, 122, 0.15)' },
  not_started: { label: 'Not Submitted', color: '#8B86A2', background: 'rgba(139, 134, 162, 0.15)' },
  not_available: { label: 'Not Available', color: '#6B6685', background: 'rgba(92, 87, 119, 0.2)' },
  ready: { label: 'Ready', color: '#5DD3E8', background: 'rgba(93, 211, 232, 0.15)' },
  approved: { label: 'Approved', color: '#4ADE80', background: 'rgba(74, 222, 128, 0.15)' },
  rejected: { label: 'Rejected', color: '#F47272', background: 'rgba(244, 114, 114, 0.15)' },
};

export const StatusBadge: React.FC<{ status: StatusKind }> = ({ status }) => {
  const config = STATUS_CONFIG[status];
  return (
    <span className="status-badge" style={{ color: config.color, backgroundColor: config.background }}>
      <span className="status-badge-dot" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  );
};
