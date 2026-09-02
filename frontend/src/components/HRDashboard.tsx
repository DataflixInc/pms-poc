import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Typography, Avatar, Button, Select, Row, Col } from 'antd';
import { IdcardOutlined, TeamOutlined, ProfileOutlined, StarOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import ApiService, { HRDashboardResponse, HREmployee, HRManager } from '../services/apiService';
import FormLoadingState from './FormLoadingState';
import { getInitials, StatusBadge } from '../utils/teamStatusHelpers';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import { SummaryStatCard, ReviewStatusCard } from './ManagerDashboard';
import '../styles/pageLayout.css';
import '../styles/teamTable.css';
import '../styles/managerDashboard.css';

const { Title, Text } = Typography;

// A stable identifier for a review period, derived the same deterministic
// way the backend's own performance-cycle grouping does (see
// _performance_cycle_review_periods in main.py: "{start_year}-H1" for
// July-December, "{start_year}-H2" for January-June — which belongs to the
// cycle that STARTED the previous year). Used for navigation/identification
// instead of the raw display label. Exported so the Employee Review Details
// page can resolve the same ID from a submission's own review_period value.
export const reviewPeriodId = (period: string): string => {
  const julyMatch = period.match(/^July (\d{4})/);
  if (julyMatch) return `${julyMatch[1]}-H1`;
  const januaryMatch = period.match(/^January (\d{4})/);
  if (januaryMatch) return `${parseInt(januaryMatch[1], 10) - 1}-H2`;
  return period;
};

interface EmptyHRStateProps {
  title?: string;
  description?: string;
}

const EmptyHRState: React.FC<EmptyHRStateProps> = ({
  title = 'No employees found',
  description = 'There are no other employees in the system yet.',
}) => (
  <div className="team-empty-state">
    <div className="team-empty-icon">
      <IdcardOutlined />
    </div>
    <div className="team-empty-title">{title}</div>
    <div className="team-empty-description">{description}</div>
  </div>
);

const HRDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<HREmployee[]>([]);
  const [managers, setManagers] = useState<HRManager[]>([]);
  // Kept alongside the individual fields above so "View Details" below can
  // hand this exact response to HREmployeeDetails via router state — that
  // page would otherwise call this same GET /api/hr/employees a second time,
  // fetching the entire org-wide roster again just to find the one employee
  // that was already right here on this table's row.
  const [dashboardResponse, setDashboardResponse] = useState<HRDashboardResponse | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string | undefined>(undefined);
  const [reviewPeriod, setReviewPeriod] = useState<string | undefined>(undefined);
  const [reviewPeriods, setReviewPeriods] = useState<string[]>([]);
  const [selectedReviewPeriod, setSelectedReviewPeriod] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchEmployees = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await ApiService.getHRDashboard();
        setDashboardResponse(response);
        setEmployees(response.employees || []);
        setManagers(response.managers || []);
        setReviewPeriod(response.review_period);
        setReviewPeriods(response.review_periods || []);
        // Defaults to the current period — matches what the page showed
        // before this selector existed; switching it is what lets HR look
        // at a different period instead.
        setSelectedReviewPeriod(response.review_period);
      } catch (err: any) {
        setError(err?.message || 'Failed to load HR dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchEmployees();
  }, []);

  // Only employees who actually report to the selected manager — "reports
  // to" is checked by employee_id (manager_ids), never by display name, so
  // two managers who happen to share a name can't be confused.
  const filteredEmployees = useMemo(
    () =>
      selectedManagerId
        ? employees.filter((employee) => employee.manager_ids?.includes(selectedManagerId))
        : employees,
    [employees, selectedManagerId]
  );

  // A submission only counts for the selected period if its own "Review
  // Period" answer matches (see backend's _submission_review_period) — never
  // just "submitted at all", since the one submission that exists could be
  // for a different period entirely. Clearing the selector (no period
  // chosen) falls back to raw submitted/not-submitted, same as before this
  // selector existed.
  const isSelfAssessmentSubmittedForPeriod = (employee: HREmployee) =>
    employee.self_assessment.submitted &&
    (!selectedReviewPeriod || employee.self_assessment.review_period === selectedReviewPeriod);

  const isManagerEvaluationSubmittedForPeriod = (employee: HREmployee) =>
    employee.manager_evaluation.submitted &&
    (!selectedReviewPeriod || employee.manager_evaluation.review_period === selectedReviewPeriod);

  const isHREvaluationSubmittedForPeriod = (employee: HREmployee) =>
    employee.hr_evaluation.submitted &&
    (!selectedReviewPeriod || employee.hr_evaluation.review_period === selectedReviewPeriod);

  if (loading) {
    return <FormLoadingState />;
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  const totalCount = filteredEmployees.length;
  const selfAssessmentSubmittedCount = filteredEmployees.filter(isSelfAssessmentSubmittedForPeriod).length;
  const selfAssessmentPendingCount = totalCount - selfAssessmentSubmittedCount;
  const managerEvalSubmittedCount = filteredEmployees.filter(isManagerEvaluationSubmittedForPeriod).length;
  const managerEvalPendingCount = totalCount - managerEvalSubmittedCount;
  const hrEvalSubmittedCount = filteredEmployees.filter(isHREvaluationSubmittedForPeriod).length;
  const hrEvalPendingCount = totalCount - hrEvalSubmittedCount;

  const columns = [
    {
      title: 'Employee',
      key: 'employee',
      render: (_: unknown, record: HREmployee) => (
        <div className="employee-cell">
          <Avatar className="employee-avatar">{getInitials(record.name)}</Avatar>
          <div className="employee-info">
            <div className="employee-name" title={record.name}>{record.name}</div>
            <div className="employee-email" title={record.email}>{record.email}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Manager',
      key: 'manager_name',
      render: (_: unknown, record: HREmployee) => record.manager_name || '—',
    },
    {
      title: 'Self Review',
      key: 'self_assessment_status',
      render: (_: unknown, record: HREmployee) => (
        <StatusBadge status={isSelfAssessmentSubmittedForPeriod(record) ? 'submitted' : 'not_started'} />
      ),
    },
    {
      title: 'Manager Review',
      key: 'manager_evaluation_status',
      render: (_: unknown, record: HREmployee) =>
        // "N/A" only when there's truly nothing to show — no manager
        // currently assigned AND no submission for the selected period. A
        // submission that already exists is real regardless of whether the
        // employee's manager assignment has since changed, so it still gets
        // shown (and stays viewable) rather than being masked as N/A.
        !record.manager_evaluation.has_manager && !isManagerEvaluationSubmittedForPeriod(record) ? (
          <Text type="secondary">N/A</Text>
        ) : (
          <StatusBadge status={isManagerEvaluationSubmittedForPeriod(record) ? 'submitted' : 'not_started'} />
        ),
    },
    {
      title: 'HR Review',
      key: 'hr_evaluation_status',
      render: (_: unknown, record: HREmployee) => (
        <StatusBadge status={isHREvaluationSubmittedForPeriod(record) ? 'submitted' : 'not_started'} />
      ),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: HREmployee) => {
        if (!record.employee_id) {
          return '—';
        }
        // Stable identifiers only — employee_id in the path, review period
        // resolved to its ID form (never the raw label) as a query param.
        // Preserves the HR Dashboard's currently-selected review period as
        // the details page's own context; omitted entirely when no period
        // is selected ("All Periods").
        const query = selectedReviewPeriod
          ? `?review_period_id=${encodeURIComponent(reviewPeriodId(selectedReviewPeriod))}`
          : '';
        return (
          <Button
            type="link"
            onClick={() =>
              // dashboardResponse is handed along in router state so
              // HREmployeeDetails can reuse this exact org-wide roster
              // instead of fetching GET /api/hr/employees again.
              navigate(`/hr-dashboard/${record.employee_id}${query}`, {
                state: { dashboard: dashboardResponse },
              })
            }
          >
            View Details →
          </Button>
        );
      },
    },
  ];

  return (
    <div className="app-page-container">
      <div className="app-page-header">
        <Title level={3} className="app-page-title" style={{ fontSize: 28 }}>HR Review</Title>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Text strong>Review Period:</Text>
          <Select
            allowClear
            placeholder="All Periods"
            style={{ minWidth: 240 }}
            value={selectedReviewPeriod}
            onChange={(value) => setSelectedReviewPeriod(value)}
            options={reviewPeriods.map((period) => ({
              value: period,
              label: period === reviewPeriod
                ? `${formatReviewPeriod(period)} (current)`
                : formatReviewPeriod(period),
            }))}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Text strong>Reporting Manager:</Text>
          <Select
            allowClear
            placeholder="All Managers"
            style={{ minWidth: 240 }}
            value={selectedManagerId}
            onChange={(value) => setSelectedManagerId(value)}
            options={managers.map((manager) => ({ value: manager.employee_id, label: manager.name }))}
          />
        </div>
      </div>

      <Row gutter={[{ xs: 16, sm: 20, lg: 24 }, { xs: 16, sm: 20, lg: 24 }]} align="stretch" style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <SummaryStatCard
            icon={<TeamOutlined />}
            value={totalCount}
            title="Total Employees"
            iconColor="#FFFFFF"
            iconBackground="#3B82F6"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <ReviewStatusCard
            icon={<ProfileOutlined />}
            title="Self Reviews"
            subtitle="Track self-review submissions"
            iconColor="#FFFFFF"
            iconBackground="#22C55E"
            submittedCount={selfAssessmentSubmittedCount}
            pendingCount={selfAssessmentPendingCount}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <ReviewStatusCard
            icon={<StarOutlined />}
            title="Manager Reviews"
            subtitle="Track manager review progress"
            iconColor="#FFFFFF"
            iconBackground="var(--color-primary, #6666D1)"
            submittedCount={managerEvalSubmittedCount}
            submittedLabel="Completed"
            pendingCount={managerEvalPendingCount}
            pendingLabel="Not Completed"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <ReviewStatusCard
            icon={<SafetyCertificateOutlined />}
            title="HR Reviews"
            subtitle="Track HR review progress"
            iconColor="#FFFFFF"
            iconBackground="var(--color-accent, #5DD3E8)"
            submittedCount={hrEvalSubmittedCount}
            submittedLabel="Completed"
            pendingCount={hrEvalPendingCount}
            pendingLabel="Not Completed"
          />
        </Col>
      </Row>

      <div className="app-content-card">
        {filteredEmployees.length === 0 ? (
          selectedManagerId ? (
            <EmptyHRState
              title="No reports for this manager"
              description="This manager doesn't have any employees assigned to them."
            />
          ) : (
            <EmptyHRState />
          )
        ) : (
          <Table
            className="team-table"
            columns={columns}
            dataSource={filteredEmployees}
            rowKey="email"
            pagination={{
              pageSize: 10,
              showTotal: (total, range) => `Showing ${range[0]}–${range[1]} of ${total} employees`,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default HRDashboard;
