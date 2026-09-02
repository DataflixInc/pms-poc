import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Typography, Button, Tabs } from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled, ClockCircleOutlined } from '@ant-design/icons';
import ApiService, { HRDashboardResponse, HREmployee } from '../services/apiService';
import { reviewPeriodId } from './HRDashboard';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import FormLoadingState from './FormLoadingState';
import HRSelfAssessmentTab from './HRSelfAssessmentTab';
import HRManagerEvaluationTab from './HRManagerEvaluationTab';
import HREvaluationTab from './HREvaluationTab';
import OverallReviewTab from './OverallReviewTab';
import { StatusBadge } from '../utils/teamStatusHelpers';
import '../styles/pageLayout.css';
import '../styles/hrEmployeeDetails.css';

const { Title, Text } = Typography;

type TabKey = 'self' | 'manager' | 'hr' | 'overall';

interface InfoField {
  label: string;
  value?: string;
}

// Reached from the HR Dashboard's "View Details" action. Reuses the same
// org-wide GET /api/hr/employees endpoint the dashboard itself already
// calls (no new backend route) and finds this one employee client-side by
// employee_id — never by name. The review_period_id query param preserves
// which period was selected on the dashboard, resolved (via reviewPeriodId)
// the same deterministic way for both sides of the comparison, never by
// comparing display text directly.
const HREmployeeDetails: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams] = useSearchParams();
  const selectedReviewPeriodId = searchParams.get('review_period_id') || undefined;
  const navigate = useNavigate();
  const location = useLocation();
  // HRDashboard's own "View Details" click already has this exact org-wide
  // roster in hand — handed over via router state so navigating here doesn't
  // repeat a call that was just made a moment ago. Absent for any other way
  // of landing here (direct URL, refresh), which still fetches normally
  // below via fetchDashboard.
  const preloadedDashboard = (location.state as { dashboard?: HRDashboardResponse } | null)?.dashboard;

  const [dashboard, setDashboard] = useState<HRDashboardResponse | null>(preloadedDashboard ?? null);
  const [loading, setLoading] = useState(!preloadedDashboard);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('self');
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef(false);

  // Extracted so it can also be re-run after HR submits the HR Evaluation
  // (see onSubmitted on HREvaluationTab below) — without this, the tab
  // label's and workflow strip's "HR Review" badge would keep reading the
  // stale org-wide roster fetched once on page load and show "Ready" even
  // right after a real submission just succeeded.
  const fetchDashboard = useCallback(async () => {
    try {
      const response = await ApiService.getHRDashboard();
      setDashboard(response);
    } catch (err: any) {
      setError(err?.message || 'Failed to load employee review details');
    }
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    if (preloadedDashboard) return;

    setLoading(true);
    fetchDashboard().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchDashboard]);

  if (loading) {
    return <FormLoadingState />;
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  const employee: HREmployee | undefined = dashboard?.employees.find((e) => e.employee_id === employeeId);

  if (!employee) {
    return (
      <div className="app-page-container hr-employee-review-page">
        <div className="app-page-header">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/hr-dashboard')} style={{ marginBottom: 16 }}>
            Back
          </Button>
        </div>
        <Text type="danger">No employee found with that ID.</Text>
      </div>
    );
  }

  // A submission only counts as "for the selected period" if its own Review
  // Period answer resolves to the same ID — never a raw text comparison,
  // and never assumed just because a submission exists. No period selected
  // ("All Periods") falls back to plain submitted/not-submitted.
  const selfSubmittedForPeriod =
    employee.self_assessment.submitted &&
    (!selectedReviewPeriodId ||
      (!!employee.self_assessment.review_period &&
        reviewPeriodId(employee.self_assessment.review_period) === selectedReviewPeriodId));

  const managerEvalSubmittedForPeriod =
    employee.manager_evaluation.submitted &&
    (!selectedReviewPeriodId ||
      (!!employee.manager_evaluation.review_period &&
        reviewPeriodId(employee.manager_evaluation.review_period) === selectedReviewPeriodId));

  const managerNotApplicable = !employee.manager_evaluation.has_manager && !managerEvalSubmittedForPeriod;

  // Workflow rule: HR Evaluation can only be started once BOTH Self
  // Assessment and Manager Evaluation are submitted for this same review
  // period — reusing the exact two period-aware booleans above rather than
  // re-deriving submission state, so this can never drift from what the
  // workflow status row and the other two tabs already show.
  const hrEvaluationAvailable = selfSubmittedForPeriod && managerEvalSubmittedForPeriod;

  const hrEvalSubmittedForPeriod =
    employee.hr_evaluation.submitted &&
    (!selectedReviewPeriodId ||
      (!!employee.hr_evaluation.review_period &&
        reviewPeriodId(employee.hr_evaluation.review_period) === selectedReviewPeriodId));

  // Overall Review (CDO's final approval) can't happen until the HR
  // Evaluation itself has a real submission — same reasoning, one step later.
  const overallReviewAvailable = hrEvalSubmittedForPeriod;
  // Period-agnostic (see the type comment on overall_review) — approval is a
  // one-time act, not tied to any one review period the way the other three
  // statuses are.
  const overallApproved = employee.overall_review.submitted;

  // Resolves the URL's review_period_id back to a human label purely for
  // display — the ID (already extracted above) is what's actually used for
  // every status comparison. Falls back to "All Periods" if HR arrived here
  // without a specific period selected.
  const selectedReviewPeriodLabel = selectedReviewPeriodId
    ? dashboard?.review_periods.find((label) => reviewPeriodId(label) === selectedReviewPeriodId)
    : undefined;

  // Only real, existing fields — nothing here is invented. designation and
  // department come straight from dataflix_users (via GET /api/hr/employees);
  // a field is simply omitted if the underlying value doesn't exist.
  const infoFields: InfoField[] = [
    { label: 'Employee', value: employee.name },
    { label: 'Designation', value: employee.designation },
    { label: 'Department', value: employee.department },
    { label: 'Reporting Manager', value: employee.manager_name },
    {
      label: 'Review Period',
      value: selectedReviewPeriodLabel ? formatReviewPeriod(selectedReviewPeriodLabel) : 'All Periods',
    },
  ].filter((field) => !!field.value);

  // Status indicator only, per the "workflow" requirement — no percentage
  // or progress bar.
  const workflowSteps: { key: TabKey; label: string; done: boolean; statusText: string }[] = [
    {
      key: 'self',
      label: 'Self Review',
      done: selfSubmittedForPeriod,
      statusText: selfSubmittedForPeriod ? 'Submitted' : 'Not Started',
    },
    {
      key: 'manager',
      label: 'Manager Review',
      done: managerEvalSubmittedForPeriod,
      statusText: managerNotApplicable ? 'N/A' : managerEvalSubmittedForPeriod ? 'Submitted' : 'Not Started',
    },
    {
      key: 'hr',
      label: 'HR Review',
      done: hrEvalSubmittedForPeriod,
      statusText: hrEvalSubmittedForPeriod ? 'Submitted' : hrEvaluationAvailable ? 'Ready' : 'Not Available',
    },
    {
      key: 'overall',
      label: 'Overall Review',
      done: overallApproved,
      statusText: overallApproved ? 'Approved' : overallReviewAvailable ? 'Ready' : 'Not Available',
    },
  ];

  return (
    <div className="app-page-container hr-employee-review-page">
      <div className="app-page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/hr-dashboard')} style={{ marginBottom: 16 }}>
          Back
        </Button>
        <Title level={3} className="app-page-title">Employee Review</Title>
      </div>

      <div className="app-content-card app-content-card--plain">
        <div className="hr-employee-info-grid">
          {infoFields.map((field) => (
            <div key={field.label}>
              <div className="hr-employee-info-label">{field.label}</div>
              <div className="hr-employee-info-value">{field.value}</div>
            </div>
          ))}
        </div>

        <div className="hr-workflow-status">
          {workflowSteps.map((step, index) => (
            <React.Fragment key={step.key}>
              <div className="hr-workflow-step">
                {step.done ? (
                  <CheckCircleFilled style={{ fontSize: 22, color: '#4ADE80' }} />
                ) : (
                  <ClockCircleOutlined style={{ fontSize: 22, color: '#8B86A2' }} />
                )}
                <span className="hr-workflow-step-label">{step.label}</span>
                <span className="hr-workflow-step-status">{step.statusText}</span>
              </div>
              {index < workflowSteps.length - 1 && <div className="hr-workflow-connector" />}
            </React.Fragment>
          ))}
        </div>

        <Tabs
          className="hr-employee-tabs"
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as TabKey)}
          items={[
            {
              key: 'self',
              label: (
                <span className="hr-tab-label">
                  <span>Self Review</span>
                  <StatusBadge status={selfSubmittedForPeriod ? 'submitted' : 'not_started'} />
                </span>
              ),
              children: (
                <HRSelfAssessmentTab employeeId={employee.employee_id!} submittedForPeriod={selfSubmittedForPeriod} />
              ),
            },
            {
              key: 'manager',
              label: (
                <span className="hr-tab-label">
                  <span>Manager Review</span>
                  {managerNotApplicable ? (
                    <span className="hr-tab-label-na">N/A</span>
                  ) : (
                    <StatusBadge status={managerEvalSubmittedForPeriod ? 'submitted' : 'not_started'} />
                  )}
                </span>
              ),
              children: (
                <HRManagerEvaluationTab
                  employeeId={employee.employee_id!}
                  submittedForPeriod={managerEvalSubmittedForPeriod}
                  submittedByName={employee.manager_name}
                  naReason={managerNotApplicable ? 'This employee has no manager currently assigned.' : undefined}
                />
              ),
            },
            {
              key: 'hr',
              label: (
                <span className="hr-tab-label">
                  <span>HR Review</span>
                  <StatusBadge
                    status={hrEvalSubmittedForPeriod ? 'submitted' : hrEvaluationAvailable ? 'ready' : 'not_available'}
                  />
                </span>
              ),
              children: (
                <HREvaluationTab
                  employeeId={employee.employee_id!}
                  available={hrEvaluationAvailable}
                  onSubmitted={fetchDashboard}
                />
              ),
            },
            {
              key: 'overall',
              label: (
                <span className="hr-tab-label">
                  <span>Overall Review</span>
                  <StatusBadge
                    status={overallApproved ? 'submitted' : overallReviewAvailable ? 'ready' : 'not_available'}
                  />
                </span>
              ),
              children: (
                <OverallReviewTab
                  employeeId={employee.employee_id!}
                  available={overallReviewAvailable}
                  onApproved={fetchDashboard}
                  managerScorePercentage={employee.manager_evaluation.score_percentage}
                  hrScorePercentage={employee.hr_evaluation.score_percentage}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
};

export default HREmployeeDetails;
