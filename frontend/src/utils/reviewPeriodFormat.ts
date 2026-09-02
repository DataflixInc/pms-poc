import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const MONTH_ABBREVIATIONS: Record<string, string> = {
  January: 'Jan',
  February: 'Feb',
  March: 'Mar',
  April: 'Apr',
  May: 'May',
  June: 'Jun',
  July: 'Jul',
  August: 'Aug',
  September: 'Sep',
  October: 'Oct',
  November: 'Nov',
  December: 'Dec',
};

const MONTH_NAME_PATTERN = new RegExp(Object.keys(MONTH_ABBREVIATIONS).join('|'), 'g');

// Display-only shortening of a review period label (e.g. "July 2026 -
// December 2026" -> "Jul 2026 - Dec 2026"). The full month-name label is
// also the Review Period question's actual stored answer and the value
// dropdowns/filters compare against (see HRDashboard.tsx's reviewPeriodId,
// ManagerEvaluationsList.tsx's selectedReviewPeriod) — so this must only
// wrap the text actually rendered to the user, never the value passed
// around for matching, filtering, or submission.
export const formatReviewPeriod = (period: string): string =>
  period.replace(MONTH_NAME_PATTERN, (month) => MONTH_ABBREVIATIONS[month]);

// Parses a review period label ("July 2026 - December 2026" / "January 2027
// - June 2027") into the first day of its start and end month. Every review
// period spans exactly 6 months (see _performance_cycle_review_periods in
// main.py), so the end month is derived as start + 5 months rather than
// re-parsed from the label's own second half — one source of truth for the
// span length instead of two halves that could drift apart. Returns null if
// the label is missing or doesn't match the expected "Month YYYY..." shape
// (callers should treat that as "no restriction" rather than blocking
// everything).
export const parseReviewPeriodBounds = (period?: string): { start: Dayjs; end: Dayjs } | null => {
  if (!period) return null;
  const match = period.match(/^([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;
  const start = dayjs(`${match[1]} ${match[2]}`, 'MMMM YYYY');
  if (!start.isValid()) return null;
  return { start, end: start.add(5, 'month') };
};
