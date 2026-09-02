import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Typography, Button } from 'antd';
import { ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import ApiService, { FormQuestion } from '../services/apiService';
import { useSectionedFormTemplate } from '../hooks/useSectionedFormTemplate';
import { renderField, renderQuestionLabel, indentedFieldStyle, buildQuestionDisplayNumbers } from '../utils/formFieldRendering';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import { useAuth } from '../contexts/AuthContext';
import FormLoadingState from './FormLoadingState';
import { ManagerEvaluationAnswers } from './ManagerEvaluationAnswers';
import HRSelfAssessmentTab from './HRSelfAssessmentTab';
import ReviewHistory from './ReviewHistory';
import { StatusBadge } from '../utils/teamStatusHelpers';
import { computeRatingSummary, ratingSummaryKey, NEUTRAL_RATING_LABEL, type RatingSummary } from '../utils/ratingSummary';
import '../styles/evaluationForm.css';
import '../styles/hrEmployeeDetails.css';

const { Title, Text } = Typography;
const { TextArea } = Input;

const MANAGER_EVALUATION_TEMPLATE_ID = 1002;
const SELF_EVALUATION_TEMPLATE_ID = 1001;

// Matches renderQuestionLabel's font so a comment field's label doesn't look
// like it fell back to antd's default label styling next to a real question.
const COMMENT_LABEL_STYLE: React.CSSProperties = { fontSize: 16, fontWeight: 600, color: '#F4F1F8' };

const commentFieldName = (question: FormQuestion) => `${question.question_number}_comment`;

// These already have a known answer (see getInitialValue below) and
// shouldn't be shown as fields to fill in — excluded from fillableSections
// below, AND filtered out of the submitted read-only view too (see
// readOnlySections below) rather than shown as answered questions there.
// Matched by exact question text, same approach main.py uses for "Review
// Period" and selfassesment.tsx uses for its own equivalent set. Exported so
// HRManagerEvaluationTab.tsx (same template, same read-only component) can
// filter its own submitted view identically without a second, separately
// maintained copy of this set.
export const AUTO_FILLED_QUESTION_TEXTS = new Set(['Employee Name', 'Review Period']);
export const isAutoFilledQuestion = (question: FormQuestion) => AUTO_FILLED_QUESTION_TEXTS.has(question.question);

export type { RatingSummary, RatingSummaryRow } from '../utils/ratingSummary';

interface ManagerEvaluationProps {
  // When true, renders just the form/read-only-answers content — no outer
  // page card, Back button, title, or the Self Assessment reference block —
  // so this can be nested as a tab's content inside ManagerEmployeeReview
  // (which already shows its own title/info-grid and a separate Self
  // Assessment tab, making all of that redundant here). Standalone use as the
  // routed /manager-evaluation/:employeeId page (embedded left false/unset)
  // is unaffected.
  embedded?: boolean;
  // Reports the live rating-question tally (see computation below) up to a
  // parent that wants to render it elsewhere — e.g. ManagerEmployeeReview's
  // Evaluation Summary sidebar. Purely a read of state this component
  // already has; never triggers a fetch of its own.
  onSummaryChange?: (summary: RatingSummary) => void;
  // When the parent already knows this (ManagerEmployeeReview's own
  // getTeamSubmissions fetch already covers every one of its reports,
  // including this one), pass it down so this component skips its own
  // redundant getFormSubmission(SELF_EVALUATION_TEMPLATE_ID) call — the same
  // fact, fetched a second time via a second endpoint. Falls back to
  // fetching it itself when omitted (standalone, non-embedded usage).
  selfAssessmentSubmitted?: boolean;
  // Reports this template's own resolved review_period once its template
  // loads, so a parent that only wants that one field (e.g.
  // ManagerEmployeeReview's info-grid) can read it here instead of making
  // its own separate getFormTemplate call just to learn it.
  onReviewPeriodChange?: (reviewPeriod: string | undefined) => void;
}

const ManagerEvaluation: React.FC<ManagerEvaluationProps> = ({
  embedded = false,
  onSummaryChange,
  selfAssessmentSubmitted: selfAssessmentSubmittedProp,
  onReviewPeriodChange,
}) => {
  // Reached via /manager-evaluation/:employeeId from ManagerEvaluationsList —
  // identifies which assigned employee this evaluation is about, threaded
  // through to the shared hook so its submission fetch/submit/draft calls
  // operate on that employee instead of the manager's own identity. Still
  // read via useParams even when embedded, since ManagerEmployeeReview is
  // rendered at that same route — the param is there either way.
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  // Called unconditionally (before any of the early returns below) — hooks
  // can't be called conditionally. Falls back to {} while there's nothing to
  // watch yet; the rating-distribution computation below only uses it once
  // `template` is confirmed non-null.
  const liveValues = (Form.useWatch([], form) || {}) as Record<string, any>;
  const {
    template,
    loading,
    error,
    sections,
    fillableSections,
    currentSectionIndex,
    isFirstSection,
    isLastSection,
    isCurrentSectionComplete,
    submitting,
    submittedAnswers,
    submittedAt,
    approvalStatus,
    history,
    targetName,
    handleNext,
    handlePrevious,
    handleSubmit,
    handleValuesChange,
  } = useSectionedFormTemplate(form, MANAGER_EVALUATION_TEMPLATE_ID, employeeId, isAutoFilledQuestion);

  // The only way this ever becomes true: HR/CDO rejected it (see
  // HRManagerEvaluationTab.tsx's Reject button) — this is the sole
  // remaining path back into an editable form for an already-submitted
  // Manager Evaluation, scoped to the manager who owns it (enforced
  // server-side too — see submit_form's approval_status carve-out in
  // main.py). Never available for a fresh, never-yet-reviewed submission,
  // and never for HR themselves (their own edit carve-out for this
  // template was removed entirely).
  const [isEditing, setIsEditing] = useState(false);

  // Prefill the form with the previously submitted answers when revising a
  // rejected evaluation — same rehydration approach useSectionedFormTemplate
  // already uses to restore a server-persisted draft (dayjs conversion for
  // date fields), just seeded from the real submission instead of a draft.
  useEffect(() => {
    if (!isEditing || !submittedAnswers || !template) return;
    const dateFieldNames = new Set(
      template.questions.filter((q) => q.type === 'date').map((q) => String(q.question_number))
    );
    const restored: Record<string, any> = {};
    for (const [key, value] of Object.entries(submittedAnswers)) {
      restored[key] = dateFieldNames.has(key) && value ? dayjs(value as string) : value;
    }
    form.setFieldsValue(restored);
  }, [isEditing, submittedAnswers, template, form]);

  // Flips back to the read-only view once a resubmit attempt made while
  // revising has actually finished — same pattern (and caveats) as
  // selfassesment.tsx's identical isEditing flip.
  const wasSubmittingRef = useRef(false);
  useEffect(() => {
    if (wasSubmittingRef.current && !submitting && isEditing) {
      setIsEditing(false);
    }
    wasSubmittingRef.current = submitting;
  }, [submitting, isEditing]);

  // "Employee Name" pre-fills with the employee identified by the URL's
  // employeeId (matched by exact question text, same approach main.py uses
  // for "Review Period"); "Review Period" pre-fills with the current period,
  // same as selfassesment.tsx. Both are now rendered as always-mounted hidden
  // fields (see the Form.Item block below) rather than editable ones.
  const getInitialValue = (question: FormQuestion) => {
    if (question.question === 'Employee Name' && targetName) return targetName;
    if (question.question === 'Review Period' && template?.review_period) return template.review_period;
    // Plain `question.answer || undefined` would wrongly reset a slider
    // answer of 0 (a valid, common min value) since 0 is falsy — check for
    // absence instead (mirrors the identical fix already applied to
    // formatAnswer's read-only rendering).
    return question.answer === undefined || question.answer === null || question.answer === ('' as any)
      ? undefined
      : question.answer;
  };

  // Employee Name's value depends on `targetName`, which resolves
  // asynchronously — antd's Form.Item `initialValue` is only ever applied
  // once, at first registration, and is never reactively re-applied if the
  // prop's value changes on a later render (a known antd sharp edge for
  // exactly this "value arrives after mount" shape). Real submitted data has
  // been observed with this same field corrupted on the Self Assessment form
  // (see selfassesment.tsx's identical fix) — explicitly re-syncing via
  // setFieldValue whenever targetName resolves closes that gap here too.
  useEffect(() => {
    if (!template || !targetName) return;
    const employeeNameQuestion = template.questions.find((q) => q.question === 'Employee Name');
    if (!employeeNameQuestion) return;
    form.setFieldValue(String(employeeNameQuestion.question_number), targetName);
  }, [template, targetName, form]);

  const { authState } = useAuth();

  // So the manager can reference the employee's own self-assessment while
  // evaluating them (or reviewing an evaluation they already submitted) —
  // reuses HRSelfAssessmentTab as-is, which does its own template+submission
  // fetch given just employeeId. Only need to know here whether a submission
  // exists at all (no review-period selector on this page, unlike HR's).
  // Skipped entirely when the parent already provides this (see
  // selfAssessmentSubmittedProp) — the embedded case, where
  // ManagerEmployeeReview's own team-submissions fetch already has the exact
  // same fact for every one of its reports.
  const [selfAssessmentSubmittedFetched, setSelfAssessmentSubmittedFetched] = useState(false);
  const hasFetchedSelfAssessmentRef = useRef<string | null>(null);
  useEffect(() => {
    if (selfAssessmentSubmittedProp !== undefined) return;
    if (!employeeId) return;
    if (hasFetchedSelfAssessmentRef.current === employeeId) return;
    hasFetchedSelfAssessmentRef.current = employeeId;

    ApiService.getFormSubmission(SELF_EVALUATION_TEMPLATE_ID, employeeId)
      .then((submission) => setSelfAssessmentSubmittedFetched(submission.submitted))
      .catch(() => setSelfAssessmentSubmittedFetched(false));
  }, [employeeId, selfAssessmentSubmittedProp]);

  const selfAssessmentSubmitted = selfAssessmentSubmittedProp ?? selfAssessmentSubmittedFetched;

  // Tells a parent (e.g. ManagerEmployeeReview) this template's resolved
  // review_period, once known, so it can skip its own separate
  // getFormTemplate call just to read this one field.
  useEffect(() => {
    if (template?.review_period) onReviewPeriodChange?.(template.review_period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.review_period]);

  // Recomputed on every keystroke/selection (Form.useWatch re-renders this
  // component) so the Evaluation Summary sidebar tracks the rating radio
  // questions live as they're answered — sections stay mounted (just hidden)
  // while paging through the form, so this always reflects every section's
  // answers, not just the currently visible one. Once a submission exists,
  // the interactive Form itself isn't mounted with those values (the
  // read-only view below renders straight from submittedAnswers instead) —
  // so the tally reads from whichever of the two actually holds real answers
  // right now. Called unconditionally (before the early returns below) since
  // it calls useEffect — template may still be null/loading at this point,
  // hence the `template?.questions ?? []`. While revising a rejected
  // evaluation (isEditing), the interactive Form holds the real values again
  // instead.
  const ratingAnswerSource: Record<string, any> = submittedAnswers && !isEditing ? submittedAnswers : liveValues;
  const ratingSummary = computeRatingSummary(template?.questions ?? [], ratingAnswerSource);
  const summaryKey = ratingSummaryKey(ratingSummary);

  // "Employee Name"/"Review Period" are auto-filled (never something the
  // manager actually answers), so they're skipped in the read-only submitted
  // view too, not just the editable form — same technique HREvaluationTab.tsx
  // already uses for its own auto-filled "Review Period". Dropping the
  // questions from each section rather than the section itself, since other
  // real questions in that section still need to show.
  const readOnlySections = sections
    .map((section) => ({ ...section, questions: section.questions.filter((q) => !isAutoFilledQuestion(q)) }))
    .filter((section) => section.questions.length > 0);

  useEffect(() => {
    // Skip while template is still loading — computeRatingSummary falls back
    // to `[]` questions above, which would otherwise report a premature
    // totalEligible: 0 tally (misread by EvaluationSummary as "no rating
    // questions in this form" instead of "still loading").
    if (!template) return;
    onSummaryChange?.(ratingSummary);
    // Fires only when the actual tally changes, not on every unrelated
    // re-render (e.g. typing in a comment field) — ratingSummary is a fresh
    // object every render, so depending on it directly would fire constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey, template]);

  if (loading) {
    return <FormLoadingState />;
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  if (!template) {
    return null;
  }

  // Same treatment as selfassesment.tsx: the backend bakes an academic-year
  // suffix into the title (e.g. "Manager Evaluation Form (2026-2027)") —
  // swap that for the actual review period in the same short "Jan 2027 -
  // Jun 2027" style used everywhere else, so this heading always names the
  // specific half-year the form is for rather than the whole two-period cycle.
  const displayTitle = template.review_period
    ? `${template.title.replace(/\s*\(\d{4}-\d{4}\)\s*$/, '')} (${formatReviewPeriod(template.review_period)})`
    : template.title;

  // Gapless 1, 2, 3... over only the fillable (visible) questions — see
  // buildQuestionDisplayNumbers for why this differs from question_number.
  const questionDisplayNumbers = buildQuestionDisplayNumbers(fillableSections);

  if (submittedAnswers && !isEditing) {
    const content = (
      <>
        {!embedded && (
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/manager-evaluation')}
            style={{ marginBottom: 16 }}
          >
            Back
          </Button>
        )}
        <Title level={3} style={{ fontSize: 20, fontWeight: 700, color: '#F4F1F8', marginBottom: 20 }}>{displayTitle}</Title>
        {template.header_title && (
          <div><Text style={{ fontSize: 16, color: '#C5C0D6', lineHeight: 1.6 }}>{template.header_title}</Text></div>
        )}

        {/* Same read-only treatment HR sees for this same data
            (HRManagerEvaluationTab) — status pill + a Submitted by/on row —
            instead of a plain sentence, so the manager's own "view" of an
            evaluation they already filled out looks like every other place
            this app shows a submitted Manager Evaluation. Read-only for
            everyone, including HR — the only way back into an editable form
            is HR/CDO explicitly rejecting it (see the Revise button below
            and submit_form's approval_status carve-out in main.py). */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusBadge status="submitted" />
            {approvalStatus && <StatusBadge status={approvalStatus} />}
          </div>
          {approvalStatus === 'rejected' && (
            <Button type="primary" size="small" onClick={() => setIsEditing(true)}>
              Revise &amp; Resubmit
            </Button>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 32,
            marginTop: 16,
            marginBottom: 28,
            paddingBottom: 24,
            flexWrap: 'wrap',
            borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.12))',
          }}
        >
          {authState.user?.name && (
            <div>
              <div className="hr-employee-info-label">Submitted by</div>
              <div className="hr-employee-info-value">{authState.user.name}</div>
            </div>
          )}
          {submittedAt && (
            <div>
              <div className="hr-employee-info-label">Submitted on</div>
              <div className="hr-employee-info-value">{new Date(submittedAt).toLocaleDateString()}</div>
            </div>
          )}
        </div>

        <ReviewHistory events={history || []} reviewLabel="Manager Review" />

        {/* Standalone use only — ManagerEmployeeReview already shows Self
            Assessment as its own separate tab, so this would just duplicate
            it when embedded there. */}
        {!embedded && employeeId && (
          <div style={{ marginBottom: 32, paddingBottom: 32, borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.12))' }}>
            <HRSelfAssessmentTab employeeId={employeeId} submittedForPeriod={selfAssessmentSubmitted} />
          </div>
        )}

        <ManagerEvaluationAnswers sections={readOnlySections} answers={submittedAnswers} />
      </>
    );

    if (embedded) {
      return content;
    }

    return (
      <div className="evaluation-form-page">
        <div className="evaluation-form-card">{content}</div>
      </div>
    );
  }

  const fillOutContent = (
    <>
      {!embedded && (
        <>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/manager-evaluation')}
            style={{ marginBottom: 16 }}
          >
            Back
          </Button>

          {/* Standalone use only — ManagerEmployeeReview already shows Self
              Assessment as its own separate tab, so this would just duplicate
              it when embedded. */}
          {isFirstSection && employeeId && (
            <div style={{ marginTop: 24, marginBottom: 8, paddingBottom: 32, borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.12))' }}>
              <HRSelfAssessmentTab employeeId={employeeId} submittedForPeriod={selfAssessmentSubmitted} />
            </div>
          )}
        </>
      )}
      <Title level={3} style={{ fontSize: 22, fontWeight: 700, color: '#F4F1F8', marginBottom: 20 }}>{displayTitle}</Title>
      {isFirstSection && template.header_title && (
        <div><Text style={{ fontSize: 16, color: '#C5C0D6', lineHeight: 1.6 }}>{template.header_title}</Text></div>
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        onValuesChange={handleValuesChange}
        onKeyDown={(e) => {
          const target = e.target as HTMLElement;
          if (e.key === 'Enter' && target.tagName !== 'TEXTAREA' && target.getAttribute('type') !== 'submit') {
            e.preventDefault();
          }
        }}
        style={{ marginTop: 32 }}
        requiredMark={(label, { required }) => (
          <span style={{ position: 'relative', display: 'block', width: '100%', paddingRight: required ? 14 : 0 }}>
            {label}
            {required && (
              <span style={{ position: 'absolute', top: 0, right: 0, color: '#F47272' }}>*</span>
            )}
          </span>
        )}
      >
        {/* Always mounted (regardless of which page is showing) so their
            known values are part of the form's submitted values without ever
            being visible to the manager — see AUTO_FILLED_QUESTION_TEXTS. */}
        {template.questions.filter(isAutoFilledQuestion).map((question) => (
          <Form.Item key={question.question_number} name={String(question.question_number)} hidden initialValue={getInitialValue(question)}>
            {renderField(question, { fontSize: 15 })}
          </Form.Item>
        ))}

        {fillableSections.map((section, index) => (
          <div key={index} style={{ display: index === currentSectionIndex ? undefined : 'none' }}>
            {section.name && <Title level={4} style={{ marginBottom: 32 }}>{section.name}</Title>}
            {section.questions.map((question) => (
              <React.Fragment key={question.question_number}>
                <Form.Item
                  name={String(question.question_number)}
                  label={
                    question.type === 'slider'
                      ? undefined
                      : renderQuestionLabel(question, 16, { fontWeight: 600, color: '#F4F1F8' }, questionDisplayNumbers.get(question.question_number))
                  }
                  initialValue={getInitialValue(question)}
                  rules={[
                    {
                      required: true,
                      message: question.type === 'slider' ? 'Please provide a rating.' : 'This field is required',
                    },
                  ]}
                  style={{ marginBottom: 24 }}
                >
                  {renderField(question, { fontSize: 15 }, questionDisplayNumbers.get(question.question_number))}
                </Form.Item>
                {question.has_comment && (
                  question.type === 'radio' ? (
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) =>
                        prev[String(question.question_number)] !== cur[String(question.question_number)]
                      }
                    >
                      {() => {
                        const selected = form.getFieldValue(String(question.question_number));
                        return selected && selected !== NEUTRAL_RATING_LABEL ? (
                          <Form.Item
                            name={commentFieldName(question)}
                            label={<span style={COMMENT_LABEL_STYLE}>{question.comment_label}</span>}
                            initialValue={question.comment_answer || undefined}
                            rules={[{ required: true, message: 'This field is required' }]}
                            style={{ marginBottom: 24 }}
                          >
                            <TextArea rows={2} className="styled-form-input" style={{ ...indentedFieldStyle, fontSize: 15 }} />
                          </Form.Item>
                        ) : null;
                      }}
                    </Form.Item>
                  ) : (
                    <Form.Item
                      name={commentFieldName(question)}
                      label={<span style={COMMENT_LABEL_STYLE}>{question.comment_label}</span>}
                      initialValue={question.comment_answer || undefined}
                      style={{ marginBottom: 24 }}
                    >
                      <TextArea rows={2} className="styled-form-input" style={{ ...indentedFieldStyle, fontSize: 15 }} />
                    </Form.Item>
                  )
                )}
              </React.Fragment>
            ))}
          </div>
        ))}

        <Form.Item className="evaluation-form-actions">
          {isEditing && (
            <Button onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          )}
          {!isFirstSection && (
            <Button className="evaluation-secondary-btn" onClick={handlePrevious}>
              Previous
            </Button>
          )}
          {isLastSection ? (
            <Button type="primary" onClick={() => form.submit()} loading={submitting}>
              Submit
            </Button>
          ) : (
            <Button type="primary" onClick={handleNext} disabled={!isCurrentSectionComplete}>
              Next <ArrowRightOutlined />
            </Button>
          )}
        </Form.Item>
      </Form>
    </>
  );

  if (embedded) {
    return fillOutContent;
  }

  return (
    <div className="evaluation-form-page">
      <div className="evaluation-form-card">{fillOutContent}</div>
    </div>
  );
};

export default ManagerEvaluation;
