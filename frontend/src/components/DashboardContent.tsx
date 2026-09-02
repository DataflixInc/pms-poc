import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Spin, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import ApiService, { MyDashboardResponse, PerformanceCycle } from '../services/apiService';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import SelfAssessment from './selfassesment';
import '../styles/pageLayout.css';
import '../styles/dashboard.css';

const { Title } = Typography;

// Self-Evaluation Form template — kept only as the templateId SelfAssessment
// itself is opened with; every status/period lookup below now comes from the
// single GET /api/employees/results call instead of fetching this template.
const REVIEW_CYCLE_TEMPLATE_ID = 1001;

type SelfAssessmentStatus = 'not_submitted' | 'in_progress' | 'submitted';

// No fake progress metrics here by design — "in progress" just reflects
// whether a server-persisted draft exists for the current period (see
// has_draft on self_assessment in get_my_profile, main.py), written by the
// shared form hook's autosave (useSectionedFormTemplate).
const SELF_ASSESSMENT_STATUS_META: Record<SelfAssessmentStatus, { label: string; buttonLabel: string }> = {
  not_submitted: { label: 'Not Submitted', buttonLabel: 'Start Assessment' },
  in_progress: { label: 'In Progress', buttonLabel: 'Continue' },
  submitted: { label: 'Submitted', buttonLabel: 'View' },
};

const DashboardContent: React.FC = () => {
  const { authState } = useAuth();
  const navigate = useNavigate();
  // Toggles the "My Assessments" table for the actual SelfAssessment form,
  // embedded inline on this same page/route instead of navigating away to
  // /self-assessment/:templateId — see handleBack below for the return trip.
  const [showAssessment, setShowAssessment] = useState(false);
  // Only a full `name` is available on the authenticated user (see types/user.ts) —
  // no separate first-name field — so derive it here rather than showing the
  // full name in a greeting.
  const firstName = authState.user?.name?.trim().split(/\s+/)[0];

  // Everything this page needs — performance cycle plus Self/Manager/HR
  // review status (each already period-matched server-side) — in one call.
  // This replaced 6 separate getFormTemplate/getFormSubmission requests (one
  // pair per template, just to learn each one's "Review Period"
  // question_number and current submission), each paying its own connection
  // overhead on top of the query itself — see get_my_profile in main.py.
  const [performanceCycle, setPerformanceCycle] = useState<PerformanceCycle | undefined>(undefined);
  const [selfSubmittedAt, setSelfSubmittedAt] = useState<string | undefined>(undefined);
  const [selfReviewPeriod, setSelfReviewPeriod] = useState<string | undefined>(undefined);
  const [managerSubmittedAt, setManagerSubmittedAt] = useState<string | undefined>(undefined);
  const [managerReviewPeriod, setManagerReviewPeriod] = useState<string | undefined>(undefined);
  const [hrSubmittedAt, setHrSubmittedAt] = useState<string | undefined>(undefined);
  const [hrReviewPeriod, setHrReviewPeriod] = useState<string | undefined>(undefined);
  // Kept alongside the individual fields above (not a replacement for them)
  // so the "View" click below can hand this exact response to MyReviewDetails
  // via router state — that page would otherwise call this same
  // GET /api/employees/results a second time, seconds after this one.
  const [profile, setProfile] = useState<MyDashboardResponse | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef(false);

  // Extracted so it can also be re-run when returning from the inline form
  // (handleBack below) — the employee may have just submitted or saved a
  // draft, so the table's status needs to reflect that immediately rather
  // than showing whatever was true before they opened the form.
  const fetchDashboard = useCallback(() => {
    setLoadingDashboard(true);
    ApiService.getMyProfile()
      .then((response) => {
        setProfile(response);
        setPerformanceCycle(response.performance_cycle);
        setSelfSubmittedAt(response.self_assessment.submitted_at);
        setSelfReviewPeriod(response.self_assessment.review_period);
        setManagerSubmittedAt(response.manager_evaluation.submitted_at);
        setManagerReviewPeriod(response.manager_evaluation.review_period);
        setHrSubmittedAt(response.hr_evaluation.submitted_at);
        setHrReviewPeriod(response.hr_evaluation.review_period);
      })
      .catch(() => {
        setProfile(null);
        setPerformanceCycle(undefined);
        setSelfSubmittedAt(undefined);
        setSelfReviewPeriod(undefined);
        setManagerSubmittedAt(undefined);
        setManagerReviewPeriod(undefined);
        setHrSubmittedAt(undefined);
        setHrReviewPeriod(undefined);
      })
      .finally(() => setLoadingDashboard(false));
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    fetchDashboard();
  }, [fetchDashboard]);

  const handleBackFromAssessment = () => {
    setShowAssessment(false);
    fetchDashboard();
  };

  const loadingCycleStatus = loadingDashboard;

  // The backend only ever keeps ONE self-assessment submission ever, for any
  // period (see submit_form in main.py — any second submission attempt 409s
  // regardless of period, and self_evaluation_submissions has no
  // review_period_id column at all). So "submitted" alone doesn't tell us
  // whether it's FOR a given period or a leftover from another one. The
  // backend already resolves each submission's own "Review Period" answer
  // (see get_my_profile) — resolved here to the SAME stable review_period_id
  // every comparison below uses, never the employee's name, and never a raw
  // displayed-label comparison scattered through the code.
  const submissionReviewPeriodId: string | undefined = performanceCycle?.review_periods.find(
    (period) => period.label === selfReviewPeriod
  )?.review_period_id;

  // Same review-period-matching technique as self-assessment above, applied
  // to Manager Review and HR Review — each submission is only ever linked to
  // a period via its own "Review Period" answer.
  const managerSubmissionReviewPeriodId: string | undefined = performanceCycle?.review_periods.find(
    (period) => period.label === managerReviewPeriod
  )?.review_period_id;

  const hrSubmissionReviewPeriodId: string | undefined = performanceCycle?.review_periods.find(
    (period) => period.label === hrReviewPeriod
  )?.review_period_id;

  const hasDraft = !!profile?.self_assessment.has_draft;

  // Review period availability (current / earlier-in-cycle / upcoming) is
  // kept separate from Self Assessment status (not submitted / in progress /
  // submitted): an upcoming period never gets a status or action at all,
  // regardless of anything else, since it hasn't opened yet. Every other
  // period (current, or an earlier one in the SAME cycle) gets its actual
  // Self Assessment status, looked up by review_period_id — identical logic
  // whether it's the current period or an earlier one, since "Submitted" for
  // an earlier period means exactly the same thing it does for the current one.
  const performanceCyclePeriods = performanceCycle
    ? (() => {
        const currentIndex = performanceCycle.review_periods.findIndex((period) => period.is_current);

        // Manager Review and HR Review are read-only here — just Submitted
        // (for this exact period), Not Submitted, or Upcoming (mirroring Self
        // Assessment's own upcoming rule) — never "In Progress", since the
        // employee has no visibility into either party's draft state.
        const otherReviewStatus = (
          isUpcoming: boolean,
          isSubmittedForThisPeriod: boolean,
          submittedOn: string | undefined
        ) => {
          if (isUpcoming) {
            return { colorVariant: 'not_submitted' as SelfAssessmentStatus, badgeText: 'Upcoming', submittedOn: undefined as string | undefined };
          }
          if (isSubmittedForThisPeriod) {
            return { colorVariant: 'submitted' as SelfAssessmentStatus, badgeText: SELF_ASSESSMENT_STATUS_META.submitted.label, submittedOn };
          }
          return { colorVariant: 'not_submitted' as SelfAssessmentStatus, badgeText: SELF_ASSESSMENT_STATUS_META.not_submitted.label, submittedOn: undefined as string | undefined };
        };

        return performanceCycle.review_periods.map((period, index) => {
          const isUpcoming = currentIndex !== -1 && index > currentIndex;
          const managerReview = otherReviewStatus(isUpcoming, managerSubmissionReviewPeriodId === period.review_period_id, managerSubmittedAt);
          const hrReview = otherReviewStatus(isUpcoming, hrSubmissionReviewPeriodId === period.review_period_id, hrSubmittedAt);

          if (isUpcoming) {
            return {
              ...period,
              colorVariant: 'not_submitted' as SelfAssessmentStatus,
              badgeText: 'Upcoming',
              actionLabel: undefined as string | undefined,
              submittedOn: undefined as string | undefined,
              managerReview,
              hrReview,
            };
          }

          const isSubmittedForThisPeriod = submissionReviewPeriodId === period.review_period_id;

          if (isSubmittedForThisPeriod) {
            return {
              ...period,
              colorVariant: 'submitted' as SelfAssessmentStatus,
              badgeText: SELF_ASSESSMENT_STATUS_META.submitted.label,
              actionLabel: SELF_ASSESSMENT_STATUS_META.submitted.buttonLabel,
              submittedOn: selfSubmittedAt,
              managerReview,
              hrReview,
            };
          }

          if (period.is_current && hasDraft) {
            return {
              ...period,
              colorVariant: 'in_progress' as SelfAssessmentStatus,
              badgeText: SELF_ASSESSMENT_STATUS_META.in_progress.label,
              actionLabel: SELF_ASSESSMENT_STATUS_META.in_progress.buttonLabel,
              submittedOn: undefined as string | undefined,
              managerReview,
              hrReview,
            };
          }

          // Not started — only the current period can actually be started;
          // an earlier period whose window has already passed without a
          // submission gets no action (nothing to retroactively start).
          return {
            ...period,
            colorVariant: 'not_submitted' as SelfAssessmentStatus,
            badgeText: SELF_ASSESSMENT_STATUS_META.not_submitted.label,
            actionLabel: period.is_current ? SELF_ASSESSMENT_STATUS_META.not_submitted.buttonLabel : undefined,
            submittedOn: undefined as string | undefined,
            managerReview,
            hrReview,
          };
        });
      })()
    : [];

  if (showAssessment) {
    return (
      <SelfAssessment
        templateId={String(REVIEW_CYCLE_TEMPLATE_ID)}
        onBack={handleBackFromAssessment}
        // profile is the exact same GET /api/employees/results response this
        // page already fetched — its self_assessment_form field already has
        // this template's questions + (empty, since nothing's submitted yet
        // in this not_submitted/in_progress branch) answers, so the form
        // doesn't need to fetch GET /api/forms/1001/full itself.
        preloadedForm={profile?.self_assessment_form}
      />
    );
  }

  return (
    <div className="app-page-container">
      <div className="app-page-header dashboard-welcome-banner">
        {/* Reuses .app-page-title (color/margin) from pageLayout.css, already
            shared with Team/Manager Evaluations — only the font-size is
            overridden here (28-32px vs. their 26px) since this is the main
            dashboard greeting, not a dense list page's header. The
            .dashboard-welcome-banner class (dashboard.css) layers a blue
            gradient background + white text on top, scoped to this page only. */}
        <Title level={2} className="app-page-title" style={{ fontSize: 30 }}>
          {firstName ? `Welcome, ${firstName}!` : ''}
        </Title>
      </div>

      {/* Unified section: replaces the old separate Self Assessment card and
          Performance Cycle card so review-period + assessment status is
          shown exactly once, not duplicated across two containers. Reuses
          every derivation above (performanceCycle, performanceCyclePeriods) —
          no new API calls. */}
      <div className="my-assessments-card">
        <div className="my-assessments-header">
          <span className="my-assessments-title">My Assessments</span>
          {!loadingCycleStatus && performanceCycle && (
            <span className="my-assessments-cycle">
              <span className="my-assessments-cycle-name">{performanceCycle.name}</span>
              <span className="performance-cycle-badge">
                <span className="performance-cycle-badge-dot" />
                Active
              </span>
            </span>
          )}
        </div>

        {loadingCycleStatus ? (
          <span className="dashboard-loading-row">
            <Spin size="small" />
            <span className="my-assessments-empty-text">Loading your assessments…</span>
          </span>
        ) : performanceCycle ? (
          <div className="my-assessments-table">
            <div className="my-assessments-row my-assessments-row-header">
              <span>Review Period</span>
              <span>Status</span>
              <span>Manager Review</span>
              <span>HR Review</span>
              <span>Action</span>
            </div>
            {performanceCyclePeriods.map((period) => (
              <div className="my-assessments-row" key={period.review_period_id}>
                <span className="my-assessments-cell">
                  <span className="my-assessments-mobile-label">Review Period</span>
                  <span className="my-assessments-period-label">{formatReviewPeriod(period.label)}</span>
                </span>
                <span className="my-assessments-cell">
                  <span className="my-assessments-mobile-label">Status</span>
                  <span className={`self-assessment-status-badge self-assessment-status-${period.colorVariant}`}>
                    <span className="self-assessment-status-dot" />
                    {period.badgeText}
                  </span>
                </span>
                <span className="my-assessments-cell">
                  <span className="my-assessments-mobile-label">Manager Review</span>
                  <span className={`self-assessment-status-badge self-assessment-status-${period.managerReview.colorVariant}`}>
                    <span className="self-assessment-status-dot" />
                    {period.managerReview.badgeText}
                  </span>
                </span>
                <span className="my-assessments-cell">
                  <span className="my-assessments-mobile-label">HR Review</span>
                  <span className={`self-assessment-status-badge self-assessment-status-${period.hrReview.colorVariant}`}>
                    <span className="self-assessment-status-dot" />
                    {period.hrReview.badgeText}
                  </span>
                </span>
                <span className="my-assessments-cell">
                  <span className="my-assessments-mobile-label">Action</span>
                  {period.actionLabel ? (
                    <Button
                      type="link"
                      className="my-assessments-action"
                      onClick={() =>
                        // Submitted rows ("View") go to the full My Reviews
                        // page (Self/Manager/HR tabs) instead of reopening
                        // the fill-in form — Start/Continue keep the
                        // existing inline flow unchanged. profile is handed
                        // along in router state so that page can reuse this
                        // exact GET /api/employees/results response instead
                        // of firing the same call again on mount.
                        period.colorVariant === 'submitted'
                          ? navigate('/my-reviews', { state: { profile } })
                          : setShowAssessment(true)
                      }
                    >
                      {period.actionLabel} <ArrowRightOutlined />
                    </Button>
                  ) : (
                    <span className="my-assessments-no-action">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="my-assessments-empty-text">
            Performance cycle information is not available right now.
          </span>
        )}
      </div>
    </div>
  );
};

export default DashboardContent;
