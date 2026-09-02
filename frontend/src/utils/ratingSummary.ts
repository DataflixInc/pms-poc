import { FormQuestion } from '../services/apiService';

// Same rating scale as backend's RATING_OPTION_POINTS in main.py, which is
// what actually decides whether a radio question counts as a "rating"
// question (see _score_submission there) — mirrored here rather than
// trusting every radio question in a template to be one, since a radio
// question with a different option set (e.g. Review Period) isn't a rating.
// Display order (best to worst) for the Evaluation Summary sidebar — no
// numeric mapping (1/2/3) attached to these; that scoring doesn't exist
// anywhere in this form's business logic, only in the separately-computed
// Manager Evaluation *score* shown on ManagerEvaluationsList (a different
// feature — see _score_submission in main.py).
export const RATING_OPTIONS_DISPLAY_ORDER = ['Outstanding', 'Meets', 'Does not meet'];

// The middle/passing rating — a comment justifying the rating is only
// required for the two non-"Meets" options (Does not meet / Outstanding),
// so this is the one value that should NOT reveal a rating question's
// comment box.
export const NEUTRAL_RATING_LABEL = 'Meets';

// Same point scale as backend's RATING_OPTION_POINTS in main.py (_score_submission)
// — mirrored here so the live Evaluation Summary donut can show a quality
// score (not just how many questions have been answered) without waiting on
// a submission to exist to ask the backend for it.
const RATING_POINTS: Record<string, number> = { 'Does not meet': 1, Meets: 2, Outstanding: 3 };
const MAX_POINTS_PER_QUESTION = 3;
const POINTS_TO_LABEL: Record<number, string> = { 1: 'Does not meet', 2: 'Meets', 3: 'Outstanding' };

const isRatingRadioQuestion = (question: FormQuestion) =>
  question.type === 'radio' &&
  !!question.options &&
  question.options.length === RATING_OPTIONS_DISPLAY_ORDER.length &&
  RATING_OPTIONS_DISPLAY_ORDER.every((option) => question.options!.includes(option));

// A slider question (e.g. a 0-10 "overall rating" scale) is eligible too —
// its value is bucketed into the same three labels by sliderRatingLabel
// below, splitting its min-max range into even thirds.
export const isRatingQuestion = (question: FormQuestion) =>
  isRatingRadioQuestion(question) || question.type === 'slider';

// Buckets a slider answer into Does not meet/Meets/Outstanding by splitting
// its min-max range into even thirds (e.g. a 0-10 slider: 0-3.3 = Does not
// meet, 3.4-6.6 = Meets, 6.7-10 = Outstanding) — mirrored in main.py's
// _slider_rating_points so the backend score (ManagerEvaluationsList) and
// this live donut agree on slider questions too. Undefined when unanswered
// or the question has no usable range, so it's excluded like any other
// unanswered rating question.
function sliderRatingLabel(question: FormQuestion, answer: any): string | undefined {
  const value = Number(answer);
  const lo = question.min ?? 0;
  const hi = question.max ?? 10;
  if (answer === undefined || answer === null || answer === '' || Number.isNaN(value) || hi <= lo) {
    return undefined;
  }
  const fraction = Math.min(Math.max((value - lo) / (hi - lo), 0), 1);
  return POINTS_TO_LABEL[fraction < 1 / 3 ? 1 : fraction < 2 / 3 ? 2 : 3];
}

export interface RatingSummaryRow {
  label: string;
  count: number;
  percentage: number;
}

export interface RatingSummary {
  totalEligible: number;
  answered: number;
  // Quality of the ratings given so far (points earned / points possible for
  // just the *answered* questions, e.g. all "Outstanding" so far = 100%) —
  // distinct from completion (answered / totalEligible), which this summary
  // deliberately does not surface as its headline number. Undefined (not 0)
  // when nothing's been answered yet, since 0% would misleadingly read as
  // "worst possible" rather than "nothing to score yet".
  scorePercentage: number | undefined;
  rows: RatingSummaryRow[];
}

// Shared by ManagerEvaluation.tsx (the manager's own fill-out/view) and
// HRManagerEvaluationTab.tsx (HR's read-only/edit view of the same
// template) — both need the identical eligibility rule and tally so the two
// surfaces can never quietly drift apart on what counts as "a rating" or how
// its percentage is computed.
export function computeRatingSummary(
  questions: FormQuestion[],
  answerSource: Record<string, any>
): RatingSummary {
  const ratingQuestions = questions.filter(isRatingQuestion);
  const ratingCounts: Record<string, number> = { 'Does not meet': 0, Meets: 0, Outstanding: 0 };
  let answered = 0;
  let earnedPoints = 0;
  for (const question of ratingQuestions) {
    const rawAnswer = answerSource[String(question.question_number)];
    const label = question.type === 'slider' ? sliderRatingLabel(question, rawAnswer) : rawAnswer;
    if (label && label in ratingCounts) {
      ratingCounts[label] += 1;
      answered += 1;
      earnedPoints += RATING_POINTS[label];
    }
  }
  // Percentages are of *answered* rating questions only (never the total,
  // and never the whole form) — an unanswered question doesn't belong to any
  // of the three categories yet, so it can't be part of a category's share.
  return {
    totalEligible: ratingQuestions.length,
    answered,
    scorePercentage:
      answered > 0 ? Math.round((earnedPoints / (answered * MAX_POINTS_PER_QUESTION)) * 100) : undefined,
    rows: RATING_OPTIONS_DISPLAY_ORDER.map((label) => ({
      label,
      count: ratingCounts[label],
      percentage: answered > 0 ? Math.round((ratingCounts[label] / answered) * 100) : 0,
    })),
  };
}

// Small, stable string derived from a RatingSummary's actual visible values —
// useful as a useEffect/useMemo dependency instead of the summary object
// itself (a fresh object every render), so effects fire only when the tally
// truly changes.
export function ratingSummaryKey(summary: RatingSummary): string {
  return `${summary.totalEligible}:${summary.answered}:${summary.rows.map((row) => `${row.label}=${row.count}`).join(',')}`;
}
