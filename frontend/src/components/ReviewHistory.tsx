import React from 'react';
import { Timeline } from 'antd';
import { ReviewHistoryEvent } from '../services/apiService';
import { STATUS_CONFIG } from '../utils/teamStatusHelpers';
import '../styles/reviewHistory.css';

const EVENT_LABEL: Record<ReviewHistoryEvent['event'], string> = {
  submitted: 'Submitted',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

// Reuses the same colors StatusBadge already uses for these same outcomes
// elsewhere in the app (approved/rejected badges, the Submitted pill), so a
// rejection reads the same shade of red here as it does there. Resubmitted
// borrows the "ready"/cyan tone so it reads distinctly from a first-time
// Submitted without inventing a new color.
const EVENT_COLOR: Record<ReviewHistoryEvent['event'], string> = {
  submitted: STATUS_CONFIG.submitted.color,
  resubmitted: STATUS_CONFIG.ready.color,
  approved: STATUS_CONFIG.approved.color,
  rejected: STATUS_CONFIG.rejected.color,
};

export interface ReviewHistoryProps {
  events: ReviewHistoryEvent[];
  // e.g. "Manager Review" -> "Manager Review Rejected". Parametrized (rather
  // than hardcoded) so this same component can back an HR/CDO history later
  // without changes, even though only Manager Evaluation actually produces
  // rejection events today.
  reviewLabel: string;
}

// No existing "Review History" timeline component exists elsewhere in the
// app to extend — this is a new one, styled to match the app's established
// dark theme (StatusBadge colors, hrEmployeeDetails.css's label/value
// pattern) rather than inventing a new visual language.
const ReviewHistory: React.FC<ReviewHistoryProps> = ({ events, reviewLabel }) => {
  if (!events || events.length === 0) return null;

  return (
    <div className="review-history">
      <div className="review-history-title">Review History</div>
      <Timeline
        items={events.map((event, index) => ({
          key: index,
          color: EVENT_COLOR[event.event],
          children: (
            <div className="review-history-entry">
              <div className="review-history-entry-title">
                {reviewLabel} {EVENT_LABEL[event.event]}
              </div>
              <div className="review-history-entry-meta">
                {event.by && <span>By {event.by} &middot; </span>}
                <span>{new Date(event.at).toLocaleDateString()}</span>
              </div>
              {event.reason && <div className="review-history-entry-reason">Reason: {event.reason}</div>}
            </div>
          ),
        }))}
      />
    </div>
  );
};

export default ReviewHistory;
