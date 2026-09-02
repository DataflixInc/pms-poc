import React, { useState } from 'react';
import { Form, Typography, Spin, Button, Modal, Input, message } from 'antd';
import ApiService from '../services/apiService';
import { useSectionedFormTemplate } from '../hooks/useSectionedFormTemplate';
import { ManagerEvaluationAnswers } from './ManagerEvaluationAnswers';
import { isAutoFilledQuestion } from './ManagerEvaluation';
import EvaluationSummary from './EvaluationSummary';
import ReviewHistory from './ReviewHistory';
import { useAuth } from '../contexts/AuthContext';
import { StatusBadge } from '../utils/teamStatusHelpers';
import { computeRatingSummary } from '../utils/ratingSummary';
import '../styles/hrEmployeeDetails.css';
import '../styles/evaluationSummary.css';

const { Text } = Typography;
const { TextArea } = Input;

const MANAGER_EVALUATION_TEMPLATE_ID = 1002;

export interface HRManagerEvaluationTabProps {
  // Optional so this tab can also be reused by an employee viewing their own
  // review (MyReviewDetails) — omitted there, which resolves to "self" the
  // same way every other employee_id-less call in this app already does
  // (see _resolve_target_employee in main.py).
  employeeId?: string;
  // Whether a Manager Evaluation submission exists for this employee for the
  // review period currently selected on the HR Dashboard — computed once by
  // the parent (HREmployeeDetails, from data it already has), so this tab
  // doesn't re-derive it from a second fetch.
  submittedForPeriod: boolean;
  // The reporting manager's name, resolved by the parent from the org-wide
  // roster (employee.manager_name) — not read off the submission response,
  // since /submission's employee_name field always names the employee being
  // evaluated, not the manager who submitted the evaluation about them.
  submittedByName?: string;
  // Set when the employee has no manager assigned at all, so there's nothing
  // that could ever be submitted here — distinct from "not submitted yet".
  naReason?: string;
}

// Employee Review Details page's "Manager Evaluation" tab. Read-only for
// everyone, including HR — a submitted Manager Evaluation can no longer be
// reopened for editing from here (the backend's submit_form also rejects
// this template's edit carve-out unconditionally now, not just client-side).
const HRManagerEvaluationTab: React.FC<HRManagerEvaluationTabProps> = ({
  employeeId,
  submittedForPeriod,
  submittedByName,
  naReason,
}) => {
  // The hook's internal Form.useWatch/setFieldsValue calls need a real
  // FormInstance to exist even though this read-only tab never renders a
  // <Form> of its own.
  const [form] = Form.useForm();

  // templateId is only handed to the hook once we know a submission actually
  // exists — otherwise this would fetch (and the loading state below would
  // spin forever) for an employee who was never going to have anything to
  // show anyway.
  const {
    template,
    loading,
    error,
    sections,
    submittedAnswers,
    submittedAt,
    approvalStatus,
    setApprovalStatus,
    approvalBy,
    setApprovalBy,
    approvalAt,
    setApprovalAt,
    history,
    setHistory,
  } = useSectionedFormTemplate(
    form,
    submittedForPeriod ? MANAGER_EVALUATION_TEMPLATE_ID : undefined,
    employeeId
  );

  const ratingSummary = computeRatingSummary(template?.questions ?? [], submittedAnswers || {});

  // Approve/Reject is HR/CDO-only (is_hr already covers the CDO designation
  // — see HR_DESIGNATIONS in main.py) and only makes sense when viewing a
  // SPECIFIC employee's evaluation — never on MyReviewDetails, where this
  // same tab is reused for an employee viewing their OWN manager's
  // evaluation of them (employeeId is undefined there, resolving to "self"
  // server-side, which this action was never meant to target).
  const { authState } = useAuth();
  const canDecide = (authState.user?.isHR || false) && !!employeeId;
  // Tracks which specific decision is in flight (not just whether one is),
  // so only the clicked button shows its own loading spinner instead of both.
  const [decisionSubmitting, setDecisionSubmitting] = useState<'approved' | 'rejected' | null>(null);
  // Reject asks for a reason first (Approve doesn't) — this only tracks
  // whether that prompt is open, not the decision itself.
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleDecision = async (status: 'approved' | 'rejected', reason?: string) => {
    if (!employeeId) return;
    setDecisionSubmitting(status);
    try {
      const now = new Date().toISOString();
      await ApiService.setFormApproval(MANAGER_EVALUATION_TEMPLATE_ID, employeeId, status, reason);
      setApprovalStatus(status);
      setApprovalBy(authState.user?.name);
      setApprovalAt(now);
      // Mirrors set_submission_approval appending to history server-side —
      // without this, Review History only shows the new decision after a
      // full page reload/refetch, same reasoning as the resubmit handler in
      // useSectionedFormTemplate already appending its own "submitted" entry.
      setHistory((prev) => [
        ...prev,
        { event: status, at: now, by: authState.user?.name, ...(reason ? { reason } : {}) },
      ]);
      message.success(status === 'approved' ? 'Manager Evaluation approved' : 'Manager Evaluation rejected');
    } catch (err: any) {
      message.error(err?.message || 'Failed to record decision');
    } finally {
      setDecisionSubmitting(null);
    }
  };

  const openRejectModal = () => {
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const confirmReject = async () => {
    const trimmedReason = rejectReason.trim();
    if (!trimmedReason) {
      message.error('A reason is required to reject this evaluation.');
      return;
    }
    setRejectModalOpen(false);
    await handleDecision('rejected', trimmedReason);
  };

  // "Employee Name"/"Review Period" are auto-filled (never something the
  // manager actually answers), so they're skipped in this read-only view
  // too — same predicate imported from ManagerEvaluation.tsx (same template,
  // so the same set applies) rather than a second, separately maintained
  // copy of it here.
  const readOnlySections = sections
    .map((section) => ({ ...section, questions: section.questions.filter((q) => !isAutoFilledQuestion(q)) }))
    .filter((section) => section.questions.length > 0);

  if (!submittedForPeriod) {
    return (
      <div style={{ padding: '32px 4px', textAlign: 'center' }}>
        <Text strong style={{ display: 'block', fontSize: 16, color: '#F4F1F8', marginBottom: 8 }}>
          Manager Review
        </Text>
        <StatusBadge status="not_started" />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          {naReason || 'The manager review has not been submitted for this review period.'}
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

  if (!template) {
    return null;
  }

  return (
    <div className="manager-eval-tab-layout">
      <div className="manager-eval-tab-layout__form">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Text strong style={{ fontSize: 20, color: '#F4F1F8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Manager Review
          </Text>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusBadge status="submitted" />
            {approvalStatus && <StatusBadge status={approvalStatus} />}
            {canDecide && (
              <>
                <Button
                  className="approve-decision-btn"
                  size="small"
                  onClick={() => handleDecision('approved')}
                  loading={decisionSubmitting === 'approved'}
                  disabled={approvalStatus === 'approved'}
                >
                  Approve
                </Button>
                <Button
                  className="reject-decision-btn"
                  size="small"
                  onClick={openRejectModal}
                  loading={decisionSubmitting === 'rejected'}
                  disabled={approvalStatus === 'rejected'}
                >
                  Reject
                </Button>
              </>
            )}
          </div>
        </div>
        {template.header_title && (
          <Text style={{ display: 'block', fontSize: 16, color: '#C5C0D6', lineHeight: 1.6, marginTop: 8 }}>
            {template.header_title}
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
          {submittedByName && (
            <div>
              <div className="hr-employee-info-label">Submitted by</div>
              <div className="hr-employee-info-value">{submittedByName}</div>
            </div>
          )}
          {submittedAt && (
            <div>
              <div className="hr-employee-info-label">Submitted on</div>
              <div className="hr-employee-info-value">{new Date(submittedAt).toLocaleDateString()}</div>
            </div>
          )}
          {approvalStatus && approvalBy && approvalAt && (
            <div>
              <div className="hr-employee-info-label">{approvalStatus === 'approved' ? 'Approved' : 'Rejected'} by</div>
              <div className="hr-employee-info-value">
                {approvalBy} on {new Date(approvalAt).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>
        <ReviewHistory events={history || []} reviewLabel="Manager Review" />
        <ManagerEvaluationAnswers sections={readOnlySections} answers={submittedAnswers || {}} />
      </div>
      <div className="manager-eval-tab-layout__summary">
        <EvaluationSummary summary={ratingSummary} weight={80} />
      </div>
      <Modal
        title="Reject Manager Evaluation"
        open={rejectModalOpen}
        onOk={confirmReject}
        onCancel={() => setRejectModalOpen(false)}
        okText="Reject"
        okButtonProps={{ danger: true, disabled: !rejectReason.trim() }}
      >
        <Text style={{ display: 'block', marginBottom: 8 }}>Reason (required)</Text>
        <TextArea
          rows={4}
          placeholder="Explain why this evaluation is being rejected"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>
    </div>
  );
};

export default HRManagerEvaluationTab;
