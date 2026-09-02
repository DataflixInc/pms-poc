import React from 'react';
import { Typography } from 'antd';
import type { RatingSummary } from './ManagerEvaluation';
import RatingDistributionChart, { RatingDistributionSlice } from './RatingDistributionChart';
import '../styles/evaluationSummary.css';

const { Text } = Typography;

// Status tokens (good/warning/critical), not arbitrary chart colors — these
// three answers literally mean good/bad, so they wear the app's fixed status
// palette (same green/gold/red used by StatusBadge in teamStatusHelpers.tsx)
// rather than a generic categorical one, tuned for contrast against the
// card's dark surface.
const RATING_COLORS: Record<string, string> = {
  Outstanding: '#4ADE80',
  Meets: '#F0C97A',
  'Does not meet': '#F47272',
};

export interface EvaluationSummaryProps {
  // null until ManagerEvaluation reports its first tally (template still
  // loading) — rendered as a quiet placeholder rather than a spinner, since
  // this sidebar never fetches anything of its own.
  summary: RatingSummary | null;
  // This review's weight toward the combined Overall Score (see
  // OverallReviewTab): Manager Review counts for 80, HR Review for 20.
  // Omitted (or 100) shows the plain 0-100 percentage, unscaled — the
  // center label becomes "<weighted>/<weight>" instead of "<percent>%" so
  // it's never mistaken for a raw percentage once scaled down.
  weight?: number;
}

// Manager Evaluation tab's sidebar (see ManagerEmployeeReview.tsx): a compact
// donut of the live rating-question answers, with the rating quality score
// (points earned / points possible so far) centered in it, and a legend
// (count + share of answered) below.
const EvaluationSummary: React.FC<EvaluationSummaryProps> = ({ summary, weight = 100 }) => {
  const slices: RatingDistributionSlice[] =
    summary?.rows.map((row) => ({ label: row.label, value: row.count, color: RATING_COLORS[row.label] })) || [];

  const rawPercentage = summary?.scorePercentage ?? 0;
  const centerLabel =
    weight === 100 ? `${rawPercentage}%` : `${Math.round((rawPercentage / 100) * weight)}/${weight}`;

  return (
    <div className="evaluation-summary-card">
      <Text strong style={{ display: 'block', fontSize: 14, color: '#F4F1F8', marginBottom: 16 }}>
        Evaluation Summary
      </Text>

      {!summary || summary.totalEligible === 0 ? (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {summary ? 'No rating questions in this form.' : 'Loading…'}
        </Text>
      ) : summary.answered === 0 ? (
        // Distinct from the donut view below — a donut with nothing answered
        // yet would render as an all-gray ring with every legend row at 0%,
        // which reads as "everyone got a 0", not "nothing selected yet". Text
        // only until the first rating is actually selected.
        <div>
          <Text strong style={{ display: 'block', fontSize: 15, color: '#F4F1F8', marginBottom: 6 }}>
            No ratings yet
          </Text>
          <Text style={{ display: 'block', fontSize: 13, marginBottom: 20, color: '#FFFFFF' }}>
            The summary will update as you complete the evaluation.
          </Text>
          <Text style={{ display: 'block', fontSize: 12, color: '#8B86A2', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            Questions Rated
          </Text>
          <Text strong style={{ fontSize: 20, color: '#F4F1F8' }}>
            0 / {summary.totalEligible}
          </Text>
        </div>
      ) : (
        <>
          <RatingDistributionChart slices={slices} centerLabel={centerLabel} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
            {summary.rows.map((row) => (
              <div
                key={row.label}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: RATING_COLORS[row.label],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: '#F4F1F8', flex: 1 }}>{row.label}</span>
                <span style={{ fontSize: 13, color: '#F4F1F8', fontWeight: 600 }}>{row.count}</span>
                <span style={{ fontSize: 13, color: '#C5C0D6', minWidth: 32, textAlign: 'right' }}>
                  {row.percentage}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default EvaluationSummary;
