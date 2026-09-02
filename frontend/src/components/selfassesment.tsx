import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Form, Typography, Button } from 'antd';
import { ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { FormQuestion, FormSubmissionStatus, FormTemplateResponse } from '../services/apiService';
import { useSectionedFormTemplate } from '../hooks/useSectionedFormTemplate';
import {
  renderField,
  renderQuestionLabel,
  ProjectDetailsField,
  rehydrateProjectEntries,
  buildQuestionDisplayNumbers,
} from '../utils/formFieldRendering';
import { formatReviewPeriod } from '../utils/reviewPeriodFormat';
import { useAuth } from '../contexts/AuthContext';
import FormLoadingState from './FormLoadingState';
import { SelfAssessmentAnswers } from './SelfAssessmentAnswers';
import '../styles/evaluationForm.css';

const { Title, Text } = Typography;

// Shared with the submitted (read-only) view below so both states of the
// form use identical type sizes/weights instead of two hand-kept copies.
const QUESTION_LABEL_STYLE: React.CSSProperties = { fontWeight: 600, color: '#F4F1F8' };
const ANSWER_TEXT_STYLE: React.CSSProperties = { fontSize: 15, fontWeight: 400 };

// These 5 questions already have a known answer (see getInitialValue below)
// and shouldn't be shown as fields to fill in — only in the submitted,
// read-only view (SelfAssessmentAnswers, which reads the hook's full
// `sections`, not the filtered `fillableSections` this excludes them from).
// Matched by exact question text, same approach main.py already uses for
// "Review Period" and ManagerEvaluation.tsx uses for "Employee Name".
const AUTO_FILLED_QUESTION_TEXTS = new Set(['Employee Name', 'Designation', 'Department', 'Date', 'Review Period']);
const isAutoFilledQuestion = (question: FormQuestion) => AUTO_FILLED_QUESTION_TEXTS.has(question.question);

interface FormHeaderProps {
  title: string;
  description?: string;
  showDescription: boolean;
}

// Title + optional intro description, rendered identically whether the form
// is still being filled in or already submitted.
const FormHeader: React.FC<FormHeaderProps> = ({ title, description, showDescription }) => (
  <>
    <Title level={3} className="evaluation-form-title">{title}</Title>
    {showDescription && description && (
      <Text className="evaluation-form-description">{description}</Text>
    )}
  </>
);

interface SelfAssessmentProps {
  // Both optional so this still works exactly as before when rendered as the
  // routed /self-assessment/:templateId page (reads from the URL). Passing
  // them lets a caller (e.g. the dashboard) embed the form inline on its own
  // page instead of navigating to a separate route.
  templateId?: string;
  onBack?: () => void;
  // Set only by the Dashboard's inline "Start Assessment"/"Continue" embed,
  // whose own getMyProfile() call already has this exact template +
  // submission (see self_assessment_form in main.py) — skips this form's own
  // GET /api/forms/{id}/full fetch entirely. Absent when reached directly by
  // URL (/self-assessment/:templateId), which still fetches normally.
  preloadedForm?: { template: FormTemplateResponse; submission: FormSubmissionStatus };
}

const SelfAssessment: React.FC<SelfAssessmentProps> = ({ templateId: templateIdProp, onBack, preloadedForm }) => {
  const { templateId: templateIdParam } = useParams<{ templateId: string }>();
  const templateId = templateIdProp ?? templateIdParam;
  // Present only when HR opens someone else's self-assessment from the HR
  // Dashboard (?employee_id=X) — absent for the normal "fill out my own
  // self-assessment" flow, which behaves exactly as before.
  const [searchParams] = useSearchParams();
  const employeeId = searchParams.get('employee_id') || undefined;
  const navigate = useNavigate();
  const handleBack = onBack ?? (() => navigate('/hr-dashboard'));
  const { authState } = useAuth();
  const isHR = authState.user?.isHR || false;
  const [form] = Form.useForm();
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
    targetName,
    handleNext,
    handlePrevious,
    handleSubmit,
    handleValuesChange,
  } = useSectionedFormTemplate(form, templateId, employeeId, isAutoFilledQuestion, preloadedForm);

  // Pre-fill questions whose answer is already known, rather than leaving
  // them blank for the employee to retype. Matched by exact question text,
  // same approach main.py already uses for "Review Period" and
  // ManagerEvaluation.tsx uses for "Employee Name". Designation/Department
  // only come from the acting user's own JWT, so they're only applied when
  // filling out one's own assessment (no employeeId) — when HR opens someone
  // else's, we don't have that target's designation/department here, and
  // showing the HR user's own would be wrong.
  const getInitialValue = (question: FormQuestion) => {
    if (question.question === 'Employee Name' && targetName) return targetName;
    if (!employeeId) {
      if (question.question === 'Designation' && authState.user?.designation) return authState.user.designation;
      if (question.question === 'Department' && authState.user?.department) return authState.user.department;
    }
    if (question.question === 'Review Period' && template?.review_period) return template.review_period;
    if (question.type === 'date' && !question.answer) return dayjs();
    // Plain `question.answer || undefined` would wrongly reset a slider
    // answer of 0 (a valid, common min value) since 0 is falsy — check for
    // absence instead (mirrors the identical fix already applied to
    // formatAnswer's read-only rendering).
    return question.answer === undefined || question.answer === null || question.answer === ('' as any)
      ? undefined
      : question.answer;
  };

  // Employee Name's value depends on `targetName`, which resolves
  // asynchronously (set from the profile/submission fetch) — unlike
  // Designation/Department above, read synchronously off already-loaded auth
  // state. antd's Form.Item `initialValue` is only ever applied once, at
  // first registration, and is never reactively re-applied if the prop's
  // value changes on a later render — a known antd sharp edge for exactly
  // this "value arrives after mount" shape, and real submitted data has been
  // observed with this field corrupted (a string collapsed into a
  // character-indexed object, the signature of the form library's internal
  // store merge treating a stale value unexpectedly). Explicitly re-syncing
  // via setFieldValue whenever targetName resolves closes that gap — this is
  // a no-op once the field already holds the right value, so it only ever
  // corrects, never overrides a legitimate later edit.
  useEffect(() => {
    if (!template || !targetName) return;
    const employeeNameQuestion = template.questions.find((q) => q.question === 'Employee Name');
    if (!employeeNameQuestion) return;
    form.setFieldValue(String(employeeNameQuestion.question_number), targetName);
  }, [template, targetName, form]);

  // HR-only: reopen an already-submitted assessment as an editable form
  // instead of the read-only view. Never available for a regular employee
  // viewing their own submission — only when isHR and a specific employee_id
  // was targeted (mirrors the same condition the backend now requires for an
  // update to be accepted instead of a 409 — see submit_form in main.py).
  const [isEditing, setIsEditing] = useState(false);
  const canEdit = isHR && !!employeeId;

  // Prefill the form with the actual submitted answers when entering edit
  // mode — same rehydration approach useSectionedFormTemplate already uses
  // to restore a server-persisted draft (dayjs conversion for date fields, and
  // for Project Details' start_month/end_month), just seeded from the real
  // submission instead of a draft.
  useEffect(() => {
    if (!isEditing || !submittedAnswers || !template) return;
    const dateFieldNames = new Set(
      template.questions.filter((q) => q.type === 'date').map((q) => String(q.question_number))
    );
    const repeatableTextFieldNames = new Set(
      template.questions.filter((q) => q.type === 'repeatable_text').map((q) => String(q.question_number))
    );
    const restored: Record<string, any> = {};
    for (const [key, value] of Object.entries(submittedAnswers)) {
      if (dateFieldNames.has(key) && value) {
        restored[key] = dayjs(value as string);
      } else if (repeatableTextFieldNames.has(key)) {
        restored[key] = rehydrateProjectEntries(value);
      } else {
        restored[key] = value;
      }
    }
    form.setFieldsValue(restored);
  }, [isEditing, submittedAnswers, template, form]);

  // Flips back to the read-only view once a submit attempt made while
  // editing has actually finished (tracked via the true->false transition of
  // the hook's own `submitting` flag, not form.submit()'s return value —
  // antd's Form.submit() doesn't return a promise tied to onFinish
  // completing). handleSubmit reports failures via message.error rather than
  // a rejected promise, so this can't perfectly distinguish success from
  // failure — on a genuine failure the read-only view just shows the
  // previous (unchanged) submitted answers, and Edit can be clicked again.
  const wasSubmittingRef = useRef(false);
  useEffect(() => {
    if (wasSubmittingRef.current && !submitting && isEditing) {
      setIsEditing(false);
    }
    wasSubmittingRef.current = submitting;
  }, [submitting, isEditing]);

  if (loading) {
    return <FormLoadingState />;
  }

  if (error) {
    return <Text type="danger">{error}</Text>;
  }

  if (!template) {
    return null;
  }

  // The backend bakes an academic-year suffix into the title (e.g. "Self
  // Evaluation Form (2026-2027)") — swap that for the actual review period
  // in the same short "Jan 2027 - Jun 2027" style already used everywhere
  // else (Review Period dropdown/options), so this heading always names the
  // specific half-year the form is for rather than the whole two-period cycle.
  const displayTitle = template.review_period
    ? `${template.title.replace(/\s*\(\d{4}-\d{4}\)\s*$/, '')} (${formatReviewPeriod(template.review_period)})`
    : template.title;

  // Gapless 1, 2, 3... over only the fillable (visible) questions — see
  // buildQuestionDisplayNumbers for why this differs from question_number.
  const questionDisplayNumbers = buildQuestionDisplayNumbers(fillableSections);

  if (submittedAnswers && !isEditing) {
    return (
      <div className="evaluation-form-page">
        <div className="evaluation-form-card">
          {(employeeId || onBack) && (
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={handleBack}
              style={{ marginBottom: 16 }}
            >
              Back
            </Button>
          )}
          <FormHeader title={displayTitle} description={template.header_title} showDescription />
          {targetName && employeeId && (
            <Text style={{ display: 'block', fontSize: 16, color: '#C5C0D6', lineHeight: 1.6 }}>
              Self review for {targetName}
            </Text>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Text type="success">Your responses have been submitted.</Text>
            {canEdit && (
              <Button type="primary" size="small" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
          </div>

          <div style={{ marginTop: 32 }}>
            <SelfAssessmentAnswers sections={sections} answers={submittedAnswers} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="evaluation-form-page">
      <div className="evaluation-form-card">
        {(employeeId || onBack) && (
          // On the first section, "Back" leaves the form entirely (same as
          // it always has). On any later section, it steps back one section
          // instead — the same target as the "Previous" button below — so
          // it can never surprise someone mid-form by exiting straight back
          // to the dashboard when they meant to just see the prior page.
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={isFirstSection ? handleBack : handlePrevious}
            style={{ marginBottom: 16 }}
          >
            Back
          </Button>
        )}
        <FormHeader title={displayTitle} description={template.header_title} showDescription={isFirstSection} />

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          onValuesChange={handleValuesChange}
          onKeyDown={(e) => {
            // Pressing Enter in a text-like input (e.g. the date picker) natively
            // submits the form, which runs full-form validation and flags every
            // not-yet-visited required field as an error. Only allow Enter to
            // submit from the actual Submit button, and to insert newlines in
            // textareas as usual.
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
              known values are part of the form's submitted values without
              ever being visible to the employee — see AUTO_FILLED_QUESTION_TEXTS. */}
          {template.questions.filter(isAutoFilledQuestion).map((question) => (
            <Form.Item key={question.question_number} name={String(question.question_number)} hidden initialValue={getInitialValue(question)}>
              {renderField(question, ANSWER_TEXT_STYLE)}
            </Form.Item>
          ))}

          {fillableSections.map((section, index) => (
            // Every section stays mounted (just hidden) rather than being
            // conditionally rendered — unmounting a section's Form.Items drops
            // their values from the form's store by the time of final submit.
            <div key={index} style={{ display: index === currentSectionIndex ? undefined : 'none' }}>
              {section.name && <Title level={4} className="evaluation-section-title">{section.name}</Title>}
              {section.questions.map((question) =>
                question.type === 'repeatable_text' ? (
                  <ProjectDetailsField
                    key={question.question_number}
                    question={question}
                    form={form}
                    reviewPeriod={template.review_period}
                    labelFontSize={16}
                    labelStyle={QUESTION_LABEL_STYLE}
                    extraStyle={ANSWER_TEXT_STYLE}
                    displayNumber={questionDisplayNumbers.get(question.question_number)}
                  />
                ) : (
                  <Form.Item
                    key={question.question_number}
                    name={String(question.question_number)}
                    // RatingQuestion (slider) renders its own number/title/
                    // description, so a separate Form.Item label would
                    // duplicate it — same reasoning ProjectDetailsField
                    // above is handled as its own branch for.
                    label={
                      question.type === 'slider'
                        ? undefined
                        : renderQuestionLabel(question, 16, QUESTION_LABEL_STYLE, questionDisplayNumbers.get(question.question_number))
                    }
                    initialValue={getInitialValue(question)}
                    rules={[
                      {
                        required: true,
                        message: question.type === 'slider' ? 'Please provide a rating.' : 'This field is required',
                      },
                    ]}
                  >
                    {renderField(question, ANSWER_TEXT_STYLE, questionDisplayNumbers.get(question.question_number))}
                  </Form.Item>
                )
              )}
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
              // Deliberately not htmlType="submit": swapping the same DOM button
              // from the "Next" button's type="button" to type="submit" mid-click
              // (both render at this exact spot) makes the browser treat that very
              // click as a native form submit, running full-form validation before
              // the last section's fields have been touched. form.submit() avoids
              // that by triggering the same validation/onFinish flow explicitly.
              <Button
                type="primary"
                onClick={() => form.submit()}
                loading={submitting}
              >
                Submit
              </Button>
            ) : (
              <Button type="primary" onClick={handleNext} disabled={!isCurrentSectionComplete}>
                Next <ArrowRightOutlined />
              </Button>
            )}
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default SelfAssessment;
