import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Typography, Button, Tabs } from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled, ClockCircleOutlined } from '@ant-design/icons';
import ApiService, { FormQuestion, MyDashboardResponse } from '../services/apiService';
import { useAuth } from '../contexts/AuthContext';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import FormLoadingState from './FormLoadingState';
import HRSelfAssessmentTab from './HRSelfAssessmentTab';
import HRManagerEvaluationTab from './HRManagerEvaluationTab';
import HREvaluationTab from './HREvaluationTab';
import { StatusBadge } from '../utils/teamStatusHelpers';
import '../styles/pageLayout.css';
import '../styles/hrEmployeeDetails.css';

const { Title, Text } = Typography;

type TabKey = 'self' | 'manager' | 'hr';

interface InfoField {
  label: string;
  value?: string;
}

// Reached from the Dashboard's "My Assessments" table (the "View" action on
// an already-submitted Self Assessment row). Mirrors HREmployeeDetails' UI
// exactly (info grid, workflow status strip, 3 tabs) but scoped to the
// logged-in employee's OWN reviews rather than one HR picked from the org
// roster — every fetch below omits employee_id, which resolves to "self" the
// same way every other employee_id-less call in this app already does (see
// _resolve_target_employee in main.py). The 3 tab components are otherwise
// unchanged from HR's usage — they're already read-only for anyone who isn't
// HR (HREvaluationTab's create/edit form is now gated behind isHR).
//
// No review-period filtering here, unlike HR's page: the backend keeps only
// ONE submission ever per template per employee (see submit_form in
// main.py), so "submitted" already means everything it could mean — there's
// no historical multi-period list to pick from.
//
// Until the CDO gives final approval (Overall Review), the employee sees
// ONLY their own submitted Self Assessment — no workflow strip, no Manager
// Review/HR Review tabs, nothing that would reveal those reviews are even in
// progress. The full tabbed view below only ever renders once overallApproved
// is true.
const MyReviewDetails: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { authState } = useAuth();
  // DashboardContent's own "View" click already has this exact profile in
  // hand (it's the same GET /api/employees/results this page would otherwise
  // fetch again from scratch) — handed over via router state so navigating
  // here doesn't repeat a call that was just made a moment ago. Absent for
  // any other way of landing here (direct URL, refresh, browser back/
  // forward), which still fetch normally below.
  const preloadedProfile = (location.state as { profile?: MyDashboardResponse } | null)?.profile;

  const [selfSubmitted, setSelfSubmitted] = useState(false);
  const [managerSubmitted, setManagerSubmitted] = useState(false);
  const [hrSubmitted, setHrSubmitted] = useState(false);
  const [overallApproved, setOverallApproved] = useState(false);
  const [managerName, setManagerName] = useState<string | undefined>(undefined);
  const [reviewPeriod, setReviewPeriod] = useState<string | undefined>(undefined);
  // Straight from getMyProfile's own self_assessment_form field — handed to
  // HRSelfAssessmentTab below so it never has to fetch getFormTemplate(1001)/
  // getFormSubmission(1001) itself for this, the logged-in user's own,
  // Self Review.
  const [selfQuestions, setSelfQuestions] = useState<FormQuestion[]>([]);
  const [selfAnswers, setSelfAnswers] = useState<Record<string, any>>({});
  const [selfSubmittedAt, setSelfSubmittedAt] = useState<string | undefined>(undefined);
  const [selfHeaderTitle, setSelfHeaderTitle] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('self');
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef(false);

  // Shared by the preloaded-from-Dashboard path and the fetch-it-ourselves
  // path below — same fields, same source shape (MyDashboardResponse),
  // whichever way it arrived.
  const applyProfile = (profile: MyDashboardResponse) => {
    setSelfSubmitted(profile.self_assessment.submitted);
    setManagerSubmitted(profile.manager_evaluation.submitted);
    setHrSubmitted(profile.hr_evaluation.submitted);
    setOverallApproved(profile.overall_review.submitted);
    setManagerName(profile.manager_name);
    setSelfQuestions(profile.self_assessment_form.template.questions);
    setSelfAnswers((profile.self_assessment_form.submission.answers as Record<string, any>) || {});
    setSelfSubmittedAt(profile.self_assessment_form.submission.submitted_at);
    setSelfHeaderTitle(profile.self_assessment_form.template.header_title);
    // Same value getFormTemplate's own `review_period` field always
    // returned (the CURRENT cycle period, regardless of submission
    // status) — performance_cycle already carries it, no separate call
    // needed just to read this one field.
    setReviewPeriod(profile.performance_cycle.review_periods.find((p) => p.is_current)?.label);
  };

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    if (preloadedProfile) {
      applyProfile(preloadedProfile);
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // A single call covers everything this page needs — self/manager/HR/
        // overall status (each already period-matched server-side), the
        // reporting manager's name, and the current review period. This used
        // to also fetch each template's submission/template pair separately
        // even though get_my_profile already returns the exact same
        // submitted/submitted_at/review_period fields for every one of them.
        const profile = await ApiService.getMyProfile();
        applyProfile(profile);
      } catch (err: any) {
        setError(err?.message || 'Failed to load your review details');
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

  // Same eligibility rule as _hr_evaluation_eligible's "no period selected"
  // fallback in main.py: both prior reviews submitted, full stop.
  const hrEvaluationAvailable = selfSubmitted && managerSubmitted;

  const infoFields: InfoField[] = [
    { label: 'Employee', value: authState.user?.name },
    { label: 'Designation', value: authState.user?.designation },
    { label: 'Department', value: authState.user?.department },
    { label: 'Reporting Manager', value: managerName },
    { label: 'Review Period', value: reviewPeriod ? formatReviewPeriod(reviewPeriod) : reviewPeriod },
  ].filter((field) => !!field.value);

  // Until the CDO gives final approval, this is ALL the employee sees —
  // their own submitted Self Assessment, full stop. No workflow strip, no
  // hint that a Manager Review or HR Review tab even exists.
  if (!overallApproved) {
    return (
      <div className="app-page-container hr-employee-review-page">
        <div className="app-page-header">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/dashboard')} style={{ marginBottom: 16 }}>
            Back
          </Button>
          <Title level={3} className="app-page-title">My Review</Title>
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

          <HRSelfAssessmentTab
            submittedForPeriod={selfSubmitted}
            notSubmittedMessage="You have not submitted your self review yet."
            preloadedQuestions={selfQuestions}
            preloadedAnswers={selfAnswers}
            preloadedEmployeeName={authState.user?.name}
            preloadedSubmittedAt={selfSubmittedAt}
            preloadedHeaderTitle={selfHeaderTitle}
          />
        </div>
      </div>
    );
  }

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
      done: managerSubmitted,
      statusText: managerSubmitted ? 'Submitted' : 'Not Started',
    },
    {
      key: 'hr',
      label: 'HR Review',
      done: hrSubmitted,
      statusText: hrSubmitted ? 'Submitted' : hrEvaluationAvailable ? 'Ready' : 'Not Available',
    },
  ];

  return (
    <div className="app-page-container hr-employee-review-page">
      <div className="app-page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/dashboard')} style={{ marginBottom: 16 }}>
          Back
        </Button>
        <Title level={3} className="app-page-title">My Reviews</Title>
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
                <HRSelfAssessmentTab
                  submittedForPeriod={selfSubmitted}
                  notSubmittedMessage="You have not submitted your self review yet."
                />
              ),
            },
            {
              key: 'manager',
              label: (
                <span className="hr-tab-label">
                  <span>Manager Review</span>
                  <StatusBadge status={managerSubmitted ? 'submitted' : 'not_started'} />
                </span>
              ),
              children: <HRManagerEvaluationTab submittedForPeriod={managerSubmitted} />,
            },
            {
              key: 'hr',
              label: (
                <span className="hr-tab-label">
                  <span>HR Review</span>
                  <StatusBadge status={hrSubmitted ? 'submitted' : hrEvaluationAvailable ? 'ready' : 'not_available'} />
                </span>
              ),
              children: <HREvaluationTab available={hrEvaluationAvailable} />,
            },
          ]}
        />
      </div>
    </div>
  );
};

export default MyReviewDetails;
