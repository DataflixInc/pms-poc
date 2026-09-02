import React, { useEffect, useRef, useState } from 'react';
import { Typography, Spin, Button, Input, message } from 'antd';
import ApiService from '../services/apiService';
import { useAuth } from '../contexts/AuthContext';
import { StatusBadge } from '../utils/teamStatusHelpers';
import '../styles/hrEmployeeDetails.css';

const { Text } = Typography;
const { TextArea } = Input;

// A real dbo.self_evaluation_form row exists for this template — fetched
// below like any other template, rather than assumed empty. It now also
// carries a "Review Period" question (same convention every other template
// uses), so the comments question is resolved by name below rather than
// assumed to be questions[0].
const OVERALL_REVIEW_TEMPLATE_ID = 1004;
const COMMENTS_QUESTION_TEXT = 'Additional Comments';

// Manager Review counts for 80 of the combined Overall Score, HR Review for
// 20 — same weights EvaluationSummary applies to each review's own donut
// (see `weight` prop there) and ManagerEvaluationsList applies to its Score
// column, so this total can never disagree with either of those.
const MANAGER_WEIGHT = 80;
const HR_WEIGHT = 20;

export interface OverallReviewTabProps {
  employeeId: string;
  // Workflow gate: HR Evaluation must already be submitted — computed by the
  // parent (HREmployeeDetails) from the same data it already has.
  available: boolean;
  // Called right after Approve succeeds — the parent's own tab label/
  // workflow-strip badge read from a roster fetched once on page load, which
  // this tab's own local `approved` state doesn't touch (same reasoning as
  // HREvaluationTab's onSubmitted).
  onApproved?: () => void;
  // Computed server-side by the parent's own getHRDashboard call (see
  // get_hr_employees/_score_percentage in main.py) — passed down instead of
  // this component fetching Manager/HR Evaluation's own template+submission
  // itself, which would just duplicate HRManagerEvaluationTab's/
  // HREvaluationTab's own fetch of the exact same data.
  managerScorePercentage?: number;
  hrScorePercentage?: number;
}

// Employee Review Details page's final "Overall Review" tab — CDO-only
// approval, one step after the HR Evaluation. Read-only for everyone else
// (regular HR sees the same status but no Approve button), enforced again
// server-side (see submit_form's OVERALL_REVIEW_TEMPLATE_ID gate in main.py)
// so this isn't the only thing stopping a non-CDO from approving.
const OverallReviewTab: React.FC<OverallReviewTabProps> = ({
  employeeId,
  available,
  onApproved,
  managerScorePercentage,
  hrScorePercentage,
}) => {
  const { authState } = useAuth();
  const isCDO = authState.user?.isCDO || false;

  const [loading, setLoading] = useState(available);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | undefined>(undefined);
  const [approving, setApproving] = useState(false);
  // The "Additional Comments" question's number and label, resolved from the
  // real template rather than hardcoded — stays correct if the question
  // wording (or its position) ever changes in the DB.
  const [commentsQuestionNumber, setCommentsQuestionNumber] = useState<number | undefined>(undefined);
  const [commentsLabel, setCommentsLabel] = useState('Additional Comments');
  // The CDO's in-progress comment before approving; the already-submitted
  // comment once approved.
  const [comments, setComments] = useState('');
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef<string | null>(null);

  const fetchApproval = () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    ApiService.getFormWithSubmission(OVERALL_REVIEW_TEMPLATE_ID, employeeId)
      .then(({ template: overallTemplate, submission: overall }) => {
        setApproved(overall.submitted);
        setApprovedAt(overall.submitted_at);
        const commentsQuestion = overallTemplate.questions.find((q) => q.question === COMMENTS_QUESTION_TEXT);
        if (commentsQuestion) {
          setCommentsQuestionNumber(commentsQuestion.question_number);
          setCommentsLabel(commentsQuestion.question);
        }
        setComments((overall.answers?.[String(commentsQuestion?.question_number)] as string) || '');
      })
      .catch((err: any) => setError(err?.message || 'Failed to load the overall review status'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!available) return;
    if (hasFetchedRef.current === employeeId) return;
    hasFetchedRef.current = employeeId;
    fetchApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, available]);

  const managerWeighted = Math.round(((managerScorePercentage ?? 0) / 100) * MANAGER_WEIGHT);
  const hrWeighted = Math.round(((hrScorePercentage ?? 0) / 100) * HR_WEIGHT);
  const overallScore = managerWeighted + hrWeighted;

  const handleApprove = async () => {
    setApproving(true);
    try {
      const answers = commentsQuestionNumber !== undefined ? { [String(commentsQuestionNumber)]: comments } : {};
      await ApiService.submitFormTemplate(OVERALL_REVIEW_TEMPLATE_ID, answers, employeeId);
      setApproved(true);
      setApprovedAt(new Date().toISOString());
      onApproved?.();
    } catch (err: any) {
      message.error(err?.message || 'Failed to approve the overall review');
    } finally {
      setApproving(false);
    }
  };

  if (!available) {
    return (
      <div style={{ padding: '32px 4px', textAlign: 'center' }}>
        <Text strong style={{ display: 'block', fontSize: 16, color: '#F4F1F8', marginBottom: 8 }}>
          Overall Review
        </Text>
        <StatusBadge status="not_available" />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          The Overall Review will be available for approval once the HR Evaluation has been submitted.
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

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Text strong style={{ fontSize: 20, color: '#F4F1F8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Overall Review
        </Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusBadge status={approved ? 'submitted' : 'ready'} />
          {isCDO && !approved && (
            <Button type="primary" size="middle" onClick={handleApprove} loading={approving}>
              Approve
            </Button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 32,
          flexWrap: 'wrap',
          marginTop: 20,
          marginBottom: 20,
          paddingBottom: 20,
          borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.12))',
        }}
      >
        <div>
          <div className="hr-employee-info-label">Overall Score</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#F4F1F8' }}>{overallScore} / 100</div>
        </div>
        <div>
          <div className="hr-employee-info-label">Manager Review (80%)</div>
          <div className="hr-employee-info-value">{managerWeighted} / {MANAGER_WEIGHT}</div>
        </div>
        <div>
          <div className="hr-employee-info-label">HR Review (20%)</div>
          <div className="hr-employee-info-value">{hrWeighted} / {HR_WEIGHT}</div>
        </div>
        {approved && approvedAt && (
          <div>
            <div className="hr-employee-info-label">Approved on</div>
            <div className="hr-employee-info-value">{new Date(approvedAt).toLocaleDateString()}</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div className="hr-employee-info-label" style={{ marginBottom: 8 }}>{commentsLabel}</div>
        {isCDO && !approved ? (
          <TextArea
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Optional remarks for this final approval"
            className="styled-form-input"
            // Narrower than the shared .styled-form-input's default 100%
            // width — this box only ever holds a short remark, not the
            // multi-paragraph answers that class normally styles.
            style={{ maxWidth: 800 }}
          />
        ) : (
          <Text style={{ display: 'block', color: comments ? '#F4F1F8' : '#8B86A2' }}>
            {comments || 'No comments added.'}
          </Text>
        )}
      </div>

      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        {approved
          ? 'This review has been given final approval. The employee can now see their full review.'
          : isCDO
          ? 'The HR Evaluation has been submitted. Approve it to release the full review to the employee.'
          : 'Awaiting final approval from the CDO.'}
      </Text>
    </div>
  );
};

export default OverallReviewTab;
