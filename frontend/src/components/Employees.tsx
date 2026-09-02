import React, { useEffect, useRef, useState } from 'react';
import { Table, Typography, Avatar, Input, Button, Modal, Form, Select, Popconfirm, message } from 'antd';
import { TeamOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import ApiService, { HREmployee, EmployeeFormValues } from '../services/apiService';
import FormLoadingState from './FormLoadingState';
import { getInitials } from '../utils/teamStatusHelpers';
import { useAuth } from '../contexts/AuthContext';
import '../styles/pageLayout.css';
import '../styles/teamTable.css';

const { Title, Text } = Typography;

const EmptyEmployeesState: React.FC = () => (
  <div className="team-empty-state">
    <div className="team-empty-icon">
      <TeamOutlined />
    </div>
    <div className="team-empty-title">No employees found</div>
    <div className="team-empty-description">
      There are no other employees in the system yet.
    </div>
  </div>
);

interface EmployeeFormModalValues extends EmployeeFormValues {
  employee_id?: string;
}

// Plain org-wide employee directory — every row in dbo.dataflix_users except
// the HR caller themselves. Reuses GET /api/hr/employees (the same call
// HRDashboard/HREmployeeDetails already make) for the listing rather than a
// new read endpoint, since that response already carries every field this
// page needs. Add/Edit/Delete go through the three mutation endpoints added
// specifically for this page (createEmployee/updateEmployee/deleteEmployee
// in apiService.ts) — the list is refetched after each so the table always
// reflects the DB, not an optimistic guess.
const Employees: React.FC = () => {
  const { authState } = useAuth();
  // CDO shares HR's is_hr flag (see HR_DESIGNATIONS in main.py) and, since
  // GET /api/hr/employees is now readable by both, would otherwise be able to
  // load this page's list and Add/Edit forms too — even though every mutation
  // endpoint behind them still rejects a CDO caller. Guarded here, before any
  // fetch, so a CDO sees a clear message instead of a directory that looks
  // usable but silently fails on submit.
  const isCDO = authState.user?.isCDO || false;
  const [employees, setEmployees] = useState<HREmployee[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<HREmployee | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<EmployeeFormModalValues>();
  // Guards against React StrictMode's dev-only double-invoke of effects.
  const hasFetchedRef = useRef(false);

  const fetchEmployees = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await ApiService.getHRDashboard();
      setEmployees(response.employees || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    // Skip the fetch entirely for a CDO — they'd never be able to act on
    // anything here anyway (every mutation endpoint still rejects them), so
    // there's no reason to pull the full roster over the wire just to show
    // a read-only list they can't do anything with.
    if (isCDO) {
      setLoading(false);
      return;
    }
    fetchEmployees();
  }, [isCDO]);

  const openAddModal = () => {
    setEditingEmployee(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const openEditModal = (employee: HREmployee) => {
    setEditingEmployee(employee);
    form.setFieldsValue({
      name: employee.name,
      work_email: employee.email,
      designation: employee.designation || undefined,
      department: employee.department || undefined,
      location: employee.location || undefined,
      manager_employee_id: employee.manager_ids?.[0],
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingEmployee(null);
    form.resetFields();
  };

  const handleSubmit = async (values: EmployeeFormModalValues) => {
    setSubmitting(true);
    try {
      if (editingEmployee) {
        await ApiService.updateEmployee(editingEmployee.employee_id!, values);
        message.success('Employee updated');
      } else {
        await ApiService.createEmployee(values.employee_id!, values);
        message.success('Employee created');
      }
      closeModal();
      await fetchEmployees();
    } catch (err: any) {
      message.error(err?.message || `Failed to ${editingEmployee ? 'update' : 'create'} employee`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (employee: HREmployee) => {
    if (!employee.employee_id) return;
    setDeletingId(employee.employee_id);
    try {
      await ApiService.deleteEmployee(employee.employee_id);
      message.success('Employee deleted');
      await fetchEmployees();
    } catch (err: any) {
      message.error(err?.message || 'Failed to delete employee');
    } finally {
      setDeletingId(null);
    }
  };

  if (isCDO) {
    return (
      <div className="app-page-container">
        <div className="app-page-header">
          <Title level={3} className="app-page-title">Employees</Title>
        </div>
        <div className="app-content-card">
          <Text type="secondary">
            The employee directory is managed by HR. As CDO, you can approve Overall Reviews from
            the Overall Review page, but employee records aren't editable from here.
          </Text>
        </div>
      </div>
    );
  }

  if (loading) {
    return <FormLoadingState />;
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  const search = searchText.trim().toLowerCase();
  const filteredEmployees = search
    ? employees.filter((employee) =>
        [employee.name, employee.email, employee.designation, employee.department, employee.location, employee.manager_name]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(search))
      )
    : employees;

  // Anyone except the employee currently being edited — a manager doesn't
  // need to exist as an already-established manager, any employee is
  // eligible, matching how assigned_employees actually works (see main.py).
  const managerOptions = employees
    .filter((employee) => employee.employee_id && employee.employee_id !== editingEmployee?.employee_id)
    .map((employee) => ({ value: employee.employee_id, label: employee.name }));

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
      title: 'Employee ID',
      key: 'employee_id',
      render: (_: unknown, record: HREmployee) => record.employee_id || '—',
    },
    {
      title: 'Designation',
      key: 'designation',
      render: (_: unknown, record: HREmployee) => record.designation || '—',
    },
    {
      title: 'Department',
      key: 'department',
      render: (_: unknown, record: HREmployee) => record.department || '—',
    },
    {
      title: 'Location',
      key: 'location',
      render: (_: unknown, record: HREmployee) => record.location || '—',
    },
    {
      title: 'Reporting Manager',
      key: 'manager_name',
      render: (_: unknown, record: HREmployee) => record.manager_name || '—',
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: HREmployee) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" onClick={() => openEditModal(record)}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this employee?"
            description="This also removes them as a manager from anyone who reports to them."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record)}
          >
            <Button size="small" danger loading={deletingId === record.employee_id}>
              Delete
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="app-page-container">
      <div className="app-page-header">
        <Title level={3} className="app-page-title">Employees</Title>
        <Text className="app-page-description">
          Every employee in the system, independent of any review period or evaluation status.
        </Text>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Input
          allowClear
          placeholder="Search by name, email, designation, or department"
          prefix={<SearchOutlined />}
          style={{ maxWidth: 360 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
          Add Employee
        </Button>
      </div>

      <div className="app-content-card">
        {filteredEmployees.length === 0 ? (
          <EmptyEmployeesState />
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

      <Modal
        title={editingEmployee ? 'Edit Employee' : 'Add Employee'}
        open={isModalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={editingEmployee ? 'Save' : 'Add'}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="work_email"
            label="Email"
            rules={[{ required: true, type: 'email', message: 'A valid email is required' }]}
          >
            <Input />
          </Form.Item>
          {!editingEmployee && (
            <Form.Item
              name="employee_id"
              label="Employee ID"
              rules={[{ required: true, message: 'Employee ID is required' }]}
            >
              <Input />
            </Form.Item>
          )}
          <Form.Item
            name="designation"
            label="Designation"
            rules={editingEmployee ? [] : [{ required: true, message: 'Designation is required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="department"
            label="Department"
            rules={editingEmployee ? [] : [{ required: true, message: 'Department is required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="location"
            label="Location"
            rules={editingEmployee ? [] : [{ required: true, message: 'Location is required' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="manager_employee_id"
            label="Reporting Manager"
            rules={editingEmployee ? [] : [{ required: true, message: 'Reporting Manager is required' }]}
          >
            <Select
              allowClear
              placeholder="Select a manager"
              options={managerOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Employees;
