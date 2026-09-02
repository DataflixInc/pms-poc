import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Typography, Button, Tabs } from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled, ClockCircleOutlined } from '@ant-design/icons';
import ApiService, { TeamMemberSubmission } from '../services/apiService';
import FormLoadingState from './FormLoadingState';
import HRSelfAssessmentTab from './HRSelfAssessmentTab';
import ManagerEvaluation, { RatingSummary } from './ManagerEvaluation';
import EvaluationSummary from './EvaluationSummary';
import { StatusBadge } from '../utils/teamStatusHelpers';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import '../styles/pageLayout.css';
import '../styles/hrEmployeeDetails.css';
import '../styles/evaluationSummary.css';

const { Title, Text } = Typography;

type TabKey = 'self' | 'manager';

interface InfoField {
  label: string;
  value?: string;
}

// Same "Employee Review" page structure as HREmployeeDetails (info grid +
// workflow status + tabs) but scoped to a manager's own report instead of
// HR's org-wide roster, and with only 2 steps/tabs — there's no HR
// Evaluation here, and unlike HR's read-only Manager Evaluation tab, this
// page's Manager Evaluation tab is the actual fill-out form (the manager IS
// the one meant to submit it), reusing ManagerEvaluation itself via its
// `embedded` prop rather than duplicating that logic.
const ManagerEmployeeReview: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // ManagerEvaluationsList's row action already has both rosters in hand
  // (it just fetched them to render its own table) — handed over via router
  // state so this page doesn't call the same two GET .../team endpoints
  // again right after. Absent for any other way of landing here (direct URL,
  // refresh), which still fetches normally below.
  const preloaded = location.state as { managerEvalTeam?: TeamMemberSubmission[]; selfEvalTeam?: TeamMemberSubmission[] } | null;

  const [managerEvalTeam, setManagerEvalTeam] = useState<TeamMemberSubmission[]>(preloaded?.managerEvalTeam ?? []);
  const [selfEvalTeam, setSelfEvalTeam] = useState<TeamMemberSubmission[]>(preloaded?.selfEvalTeam ?? []);
  const [reviewPeriod, setReviewPeriod] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(!preloaded);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('self');
  // Populated (and kept live) by ManagerEvaluation's onSummaryChange as the
  // manager answers rating questions — read-only here, never fetched
  // separately.
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    if (preloaded) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // review_period comes from ManagerEvaluation's own onReviewPeriodChange
        // instead of a separate getFormTemplate call here — that component
        // already fetches this exact template itself to render the form. One
        // call covers both rosters — see get_manager_team in main.py for why
        // this replaced two separate getTeamSubmissions calls.
        const { self_team: selfEvalResponse, manager_team: managerEvalResponse } = await ApiService.getManagerTeam();
        setManagerEvalTeam(managerEvalResponse.team);
        setSelfEvalTeam(selfEvalResponse.team);
      } catch (err: any) {
        setError(err?.message || 'Failed to load employee review details');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <FormLoadingState />;
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  const employee = managerEvalTeam.find((member) => member.employee_id === employeeId);

  if (!employee) {
    return (
      <div className="app-page-container hr-employee-review-page">
        <div className="app-page-header">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/manager-evaluation')} style={{ marginBottom: 16 }}>
            Back
          </Button>
        </div>
        <Text type="danger">No employee found with that ID.</Text>
      </div>
    );
  }

  const selfSubmitted = selfEvalTeam.find((member) => member.employee_id === employeeId)?.submitted ?? false;
  const managerEvalSubmitted = employee.submitted;

  // Only real, existing fields — nothing here is invented. designation and
  // department come straight from dataflix_users (via GET /api/forms/{id}/team).
  const infoFields: InfoField[] = [
    { label: 'Employee', value: employee.name },
    { label: 'Designation', value: employee.designation },
    { label: 'Department', value: employee.department },
    { label: 'Review Period', value: reviewPeriod ? formatReviewPeriod(reviewPeriod) : reviewPeriod },
  ].filter((field) => !!field.value);

  const workflowSteps: { key: TabKey; label: string; done: boolean; statusText: string }[] = [
    {
      key: 'self',
      label: 'Self Review',
      done: selfSubmitted,
      statusText: selfSubmitted ? 'Submitted' : 'Not Started',
    },
    {
      key: 'manager',
      label: 'Manager Review',
      done: managerEvalSubmitted,
      statusText: managerEvalSubmitted ? 'Submitted' : 'Not Started',
    },
  ];

  return (
    <div className="app-page-container hr-employee-review-page">
      <div className="app-page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/manager-evaluation')} style={{ marginBottom: 16 }}>
          Back
        </Button>
        <Title level={3} className="app-page-title">Employee Review</Title>
        <Text className="app-page-description">
          Review the employee's self review and manager review.
        </Text>
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
                  <StatusBadge status={selfSubmitted ? 'submitted' : 'not_started'} />
                </span>
              ),
              children: (
                <HRSelfAssessmentTab employeeId={employee.employee_id!} submittedForPeriod={selfSubmitted} />
              ),
            },
            {
              key: 'manager',
              label: (
                <span className="hr-tab-label">
                  <span>Manager Review</span>
                  <StatusBadge status={managerEvalSubmitted ? 'submitted' : 'not_started'} />
                </span>
              ),
              // Mounts ManagerEvaluation immediately instead of waiting for
              // this tab to be clicked — its onReviewPeriodChange callback is
              // the info-grid's only source for "Review Period" (see the
              // comment above infoFields), so without this it stays blank on
              // the Self Review tab until the manager visits this one first.
              forceRender: true,
              children: (
                <div className="manager-eval-tab-layout">
                  <div className="manager-eval-tab-layout__form">
                    <ManagerEvaluation
                      embedded
                      onSummaryChange={setRatingSummary}
                      selfAssessmentSubmitted={selfSubmitted}
                      onReviewPeriodChange={setReviewPeriod}
                    />
                  </div>
                  <div className="manager-eval-tab-layout__summary">
                    <EvaluationSummary summary={ratingSummary} weight={80} />
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
};

export default ManagerEmployeeReview;
