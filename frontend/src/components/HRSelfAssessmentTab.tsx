import React, { useEffect, useRef, useState } from 'react';
import { Typography, Spin } from 'antd';
import ApiService, { FormQuestion } from '../services/apiService';
import { groupIntoSections } from '../hooks/useSectionedFormTemplate';
import { SelfAssessmentAnswers } from './SelfAssessmentAnswers';
import { StatusBadge } from '../utils/teamStatusHelpers';
import '../styles/hrEmployeeDetails.css';

const { Text } = Typography;

const SELF_EVALUATION_TEMPLATE_ID = 1001;

export interface HRSelfAssessmentTabProps {
  // Optional so this tab can also be reused by an employee viewing their own
  // review (MyReviewDetails) — omitted there, which resolves to "self" the
  // same way every other employee_id-less call in this app already does
  // (see _resolve_target_employee in main.py).
  employeeId?: string;
  // Whether the employee's one Self-Assessment submission is actually for
  // the review period currently selected on the HR Dashboard — computed
  // once by the parent (HREmployeeDetails, from data it already has), so
  // this tab doesn't re-derive it from a second fetch.
  submittedForPeriod: boolean;
  // HR's default ("This employee...") reads oddly on MyReviewDetails, where
  // the employee is looking at their own page — overridden there to speak
  // to the viewer directly instead.
  notSubmittedMessage?: string;
  // Set by MyReviewDetails, whose own getMyProfile() call already returns
  // the full Self Assessment questions + submitted answers (see
  // self_assessment_form in get_my_profile, main.py) — passing them down
  // skips this component's own getFormTemplate/getFormSubmission pair
  // entirely. Left undefined by HR/manager callers (HREmployeeDetails,
  // ManagerEmployeeReview), which have no such profile for an employee other
  // than themselves and still need to fetch independently.
  preloadedQuestions?: FormQuestion[];
  preloadedAnswers?: Record<string, any>;
  preloadedEmployeeName?: string;
  preloadedSubmittedAt?: string;
  preloadedHeaderTitle?: string;
}

// Read-only Self Assessment content for the Employee Review Details page's
// "Self Assessment" tab. Renders directly inside the tab — no navigation,
// no page chrome (header/sidebar/title) of its own. There is no <Form>, no
// editable fields, and no save/submit action anywhere in this component or
// in SelfAssessmentAnswers, so HR can only ever look, never change an
// answer, rating, or comment.
const HRSelfAssessmentTab: React.FC<HRSelfAssessmentTabProps> = ({
  employeeId,
  submittedForPeriod,
  notSubmittedMessage,
  preloadedQuestions,
  preloadedAnswers,
  preloadedEmployeeName,
  preloadedSubmittedAt,
  preloadedHeaderTitle,
}) => {
  const isPreloaded = preloadedQuestions !== undefined;
  const [loading, setLoading] = useState(submittedForPeriod && !isPreloaded);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<FormQuestion[] | null>(preloadedQuestions ?? null);
  const [answers, setAnswers] = useState<Record<string, any>>(preloadedAnswers ?? {});
  const [employeeName, setEmployeeName] = useState<string | undefined>(preloadedEmployeeName);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(preloadedSubmittedAt);
  const [headerTitle, setHeaderTitle] = useState<string | undefined>(preloadedHeaderTitle);
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef<string | null | undefined>(null);

  useEffect(() => {
    // Already have everything from the parent's own single fetch (see
    // preloadedQuestions above) — nothing to do.
    if (isPreloaded) return;
    // Nothing to fetch if the one submission that could exist isn't for the
    // selected period — the "not submitted" state below doesn't need the
    // full template/answers at all.
    if (!submittedForPeriod) return;
    if (hasFetchedRef.current === employeeId) return;
    hasFetchedRef.current = employeeId;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const { template: templateResponse, submission: submissionResponse } = await ApiService.getFormWithSubmission(
          SELF_EVALUATION_TEMPLATE_ID,
          employeeId
        );
        setQuestions(templateResponse.questions);
        setAnswers(submissionResponse.answers || {});
        setEmployeeName(submissionResponse.employee_name);
        setSubmittedAt(submissionResponse.submitted_at);
        setHeaderTitle(templateResponse.header_title);
      } catch (err: any) {
        setError(err?.message || 'Failed to load the self review');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [employeeId, submittedForPeriod, isPreloaded]);

  if (!submittedForPeriod) {
    return (
      <div style={{ padding: '32px 4px', textAlign: 'center' }}>
        <Text strong style={{ display: 'block', fontSize: 16, color: '#F4F1F8', marginBottom: 8 }}>
          Self Review
        </Text>
        <StatusBadge status="not_started" />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          {notSubmittedMessage || 'This employee has not submitted their self review for this review period.'}
        </Text>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '32px 4px', textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  if (!questions) {
    return null;
  }

  const sections = groupIntoSections(questions);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Text strong style={{ fontSize: 20, color: '#F4F1F8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Self Review
        </Text>
        <StatusBadge status="submitted" />
      </div>
      {headerTitle && (
        <Text style={{ display: 'block', fontSize: 16, color: '#C5C0D6', lineHeight: 1.6, marginTop: 8 }}>
          {headerTitle}
        </Text>
      )}
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
        {employeeName && (
          <div>
            <div className="hr-employee-info-label">Submitted by</div>
            <div className="hr-employee-info-value">{employeeName}</div>
          </div>
        )}
        {submittedAt && (
          <div>
            <div className="hr-employee-info-label">Submitted on</div>
            <div className="hr-employee-info-value">{new Date(submittedAt).toLocaleDateString()}</div>
          </div>
        )}
      </div>
      <SelfAssessmentAnswers sections={sections} answers={answers} />
    </div>
  );
};

export default HRSelfAssessmentTab;
