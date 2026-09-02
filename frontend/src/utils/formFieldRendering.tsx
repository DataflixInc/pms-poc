import React from 'react';
import { Input, Radio, DatePicker, Form, Button, Card, Checkbox } from 'antd';
import type { FormInstance } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { FormQuestion } from '../services/apiService';
import { formatReviewPeriod, parseReviewPeriodBounds } from './reviewPeriodFormat';
import RatingQuestion from '../components/RatingQuestion';
import './formFieldRendering.css';

const { TextArea } = Input;

// The Project Details question's answer model: an array of structured
// project entries, replacing the older plain-string-per-project shape.
// start_month/end_month are a Dayjs value while live in the form (the
// DatePicker's own value type) and a plain "YYYY-MM" string once persisted
// (see useSectionedFormTemplate's handleSubmit normalization) — both are
// legitimate at different points in this field's lifecycle, so the type
// covers both rather than the code casting through `any` at the boundary.
// is_current is the "Currently Working on this Project" checkbox — when
// true, end_month is not required (see ProjectDetailsField/formatProjectDuration).
export interface ProjectDetailsEntry {
  name: string;
  start_month?: string | Dayjs | null;
  end_month?: string | Dayjs | null;
  is_current?: boolean;
}

// Restricts Project Details' Start/End Month pickers to the review period
// being assessed — a project logged against this form should fall within
// the period it's being reported for, not any month ever. Returns a
// disabledDate predicate; when the period can't be parsed (see
// parseReviewPeriodBounds), returns "nothing disabled" rather than blocking
// every month.
const disableOutsideReviewPeriod = (bounds: { start: Dayjs; end: Dayjs } | null) => (current: Dayjs) =>
  bounds ? current.isBefore(bounds.start, 'month') || current.isAfter(bounds.end, 'month') : false;

// Backward compatibility: submissions saved before this question grew
// structured fields stored each project as a plain string. Both shapes are
// accepted everywhere a Project Details answer is read (ProjectDetailsCards,
// rehydrateProjectEntries) so those older submissions still render instead
// of going blank.
export type ProjectDetailsAnswer = Array<ProjectDetailsEntry | string>;

// Indents each field to line up with the start of the question text rather
// than the question number (e.g. "1. ") that precedes it in the label.
export const FIELD_INDENT = 14;
export const indentedFieldStyle = { marginLeft: FIELD_INDENT, width: `calc(100% - ${FIELD_INDENT}px)` };

// extraStyle lets callers layer on presentational overrides (e.g. font size)
// without affecting other forms that call renderField without it. The box
// appearance itself (border/height/radius/hover/focus) lives in
// formFieldRendering.css via the "styled-form-input" class.
export const renderField = (question: FormQuestion, extraStyle?: React.CSSProperties, displayNumber?: number) => {
  const fieldStyle = { ...indentedFieldStyle, ...extraStyle };
  switch (question.type) {
    case 'textarea':
      return <TextArea rows={2} className="styled-form-input" style={fieldStyle} />;
    case 'date':
      return <DatePicker className="styled-form-input" style={fieldStyle} />;
    case 'radio':
      return (
        <Radio.Group className="styled-radio-group" style={{ marginLeft: FIELD_INDENT, ...extraStyle }}>
          {(question.options || []).map((option) => (
            <Radio key={option} value={option}>
              {formatReviewPeriod(option)}
            </Radio>
          ))}
        </Radio.Group>
      );
    case 'slider':
      // RatingQuestion renders the question's own number/title/description
      // itself (see its own layout), so callers should skip passing a
      // separate Form.Item `label` for this type — matching how
      // ProjectDetailsField is already handled as its own special case
      // wherever questions are rendered in a loop.
      return <RatingQuestion question={question} displayNumber={displayNumber} />;
    default:
      return <Input className="styled-form-input" style={fieldStyle} />;
  }
};

// Hanging indent via flexbox: the number gets its own flex item (sized to its
// natural width, whether "1." or "10."), so the question text's wrapped lines
// always align under the text itself, not under the number — unlike a fixed
// padding/text-indent value, this works regardless of how wide the number is.
// displayNumber lets callers show a gapless 1, 2, 3... count over just the
// questions actually visible to the user, instead of question.question_number
// — which is assigned once, sequentially, over the WHOLE template including
// auto-filled hidden questions (Employee Name, Review Period, etc.), so the
// first visible question would otherwise print as "3." or "6." rather than
// "1.". Falls back to question_number when no map is built (e.g. read-only
// answer views that don't need this).
export const renderQuestionLabel = (
  question: FormQuestion,
  fontSize: number,
  style?: React.CSSProperties,
  displayNumber?: number
) => (
  <span style={{ display: 'flex', lineHeight: 1.5, fontSize, ...style }}>
    <span style={{ flexShrink: 0 }}>{displayNumber ?? question.question_number}.&nbsp;</span>
    <span style={{ whiteSpace: 'pre-line' }}>{question.question}</span>
  </span>
);

// Builds a question_number -> 1-based position map over only the questions
// actually passed in (i.e. a form's fillableSections, which already exclude
// auto-filled hidden ones) — see renderQuestionLabel's displayNumber above.
export const buildQuestionDisplayNumbers = (
  sections: { questions: FormQuestion[] }[]
): Map<number, number> => {
  const map = new Map<number, number>();
  let position = 0;
  for (const section of sections) {
    for (const question of section.questions) {
      position += 1;
      map.set(question.question_number, position);
    }
  }
  return map;
};

// DatePicker values are dayjs objects fresh out of the form, but after a
// round-trip through the backend (JSON) they come back as ISO datetime
// strings instead — both need to be reduced to a plain YYYY-MM-DD.
// `question` is only passed so the "Review Period" answer can be shortened
// the same way its radio options are above — gated to that one question
// specifically (rather than running formatReviewPeriod over every answer)
// so a free-text comment that happens to mention a month name is never
// silently rewritten.
export const formatAnswer = (value: any, question?: FormQuestion): string => {
  // A repeatable_text question's answer (e.g. "List all projects...") is an
  // array of free-text entries rather than a single value — numbered here so
  // the read-only view still reads as a list, not one run-on paragraph. A
  // single entry skips the "1." prefix entirely — there's nothing for a lone
  // item to be numbered relative to.
  if (Array.isArray(value)) {
    const entries = value.filter((entry) => typeof entry === 'string' && entry.trim() !== '');
    if (entries.length === 0) return '—';
    if (entries.length === 1) return entries[0];
    return entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n\n');
  }
  if (value && typeof value.format === 'function') {
    return value.format('YYYY-MM-DD');
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 10);
  }
  // Plain `value || '—'` would wrongly fall back for a slider answer of 0
  // (a valid, common min value) since 0 is falsy — check for absence instead.
  const formatted = value === undefined || value === null || value === '' ? '—' : value;
  return question?.question === 'Review Period' ? formatReviewPeriod(formatted) : formatted;
};

// Rehydrates a "repeatable_text" (Project Details) answer's start_month/
// end_month back into dayjs objects — DatePicker requires a dayjs value, not
// the plain "YYYY-MM" string the backend stores/returns. Shared by every call
// site that loads a previously-saved answer back into the form (the
// server-persisted draft-restore in useSectionedFormTemplate and the HR
// edit-mode rehydration effect in selfassesment.tsx both need this exact
// conversion, so it lives here once rather than being duplicated). Leaves
// legacy plain-string entries (answers submitted before this question grew
// Start/End Month) untouched, and leaves non-array values alone entirely.
export const rehydrateProjectEntries = (value: any): any => {
  if (!Array.isArray(value)) return value;
  return (value as ProjectDetailsAnswer).map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    return {
      ...entry,
      start_month: entry.start_month ? dayjs(entry.start_month) : entry.start_month,
      end_month: entry.end_month ? dayjs(entry.end_month) : entry.end_month,
    };
  });
};

// Renders a "repeatable_text" question (Self Assessment's "Project Details")
// as a list of cards — one per project, each with a required Project Name and
// an optional Start Month/End Month — backed by antd's Form.List since a
// plain renderField() control can't hold a variable-length list. Requires at
// least one project with a non-blank name — matching every other required
// question on these forms — via the List's own validator (the name field's
// own requiredness is enforced per-entry below).
export const ProjectDetailsField: React.FC<{
  question: FormQuestion;
  form: FormInstance;
  // The review period this form is being filled out for (e.g. "July 2026 -
  // December 2026") — restricts Start/End Month to that span. Omitted
  // gracefully falls back to "no restriction" (see disableOutsideReviewPeriod)
  // rather than blocking every month if a caller doesn't have it handy.
  reviewPeriod?: string;
  labelFontSize?: number;
  labelStyle?: React.CSSProperties;
  extraStyle?: React.CSSProperties;
  displayNumber?: number;
}> = ({ question, form, reviewPeriod, labelFontSize = 16, labelStyle, extraStyle, displayNumber }) => {
  const disabledDate = disableOutsideReviewPeriod(parseReviewPeriodBounds(reviewPeriod));
  return (
  <div style={{ marginBottom: 24 }}>
    {renderQuestionLabel(question, labelFontSize, labelStyle, displayNumber)}
    <Form.List
      name={String(question.question_number)}
      initialValue={rehydrateProjectEntries(Array.isArray(question.answer) ? question.answer : [])}
      rules={[
        {
          validator: async (_, entries) => {
            const hasNamedProject = Array.isArray(entries) && entries.some((entry) => entry?.name?.trim());
            if (!hasNamedProject) {
              throw new Error('Add at least one project');
            }
          },
        },
      ]}
    >
      {(fields, { add, remove }, { errors }) => (
        <div style={{ marginLeft: FIELD_INDENT }}>
          {fields.map((field) => (
            <Card
              key={field.key}
              size="small"
              className="project-details-card"
              extra={
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                  aria-label="Remove project"
                />
              }
            >
              <Form.Item
                {...field}
                name={[field.name, 'name']}
                label="Project Name"
                rules={[{ required: true, whitespace: true, message: 'Project name is required' }]}
                style={{ marginBottom: 12 }}
              >
                <Input className="styled-form-input" placeholder="Project Name/Trainings" style={extraStyle} />
              </Form.Item>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Form.Item
                  {...field}
                  name={[field.name, 'start_month']}
                  label="Start Month"
                  rules={[{ required: true, message: 'Start month is required' }]}
                  style={{ marginBottom: 0, flex: '1 1 140px' }}
                >
                  <DatePicker
                    picker="month"
                    className="styled-form-input"
                    style={{ width: '100%' }}
                    disabledDate={disabledDate}
                  />
                </Form.Item>
                {/* shouldUpdate re-renders just this Form.Item whenever any
                    field value changes (cheap at this list's scale) so it can
                    read this card's own is_current checkbox and swap between
                    a live End Month picker and a static "Present" — the
                    Start Month field above is never touched by this, so it's
                    preserved regardless of which state End Month is in. */}
                <Form.Item noStyle shouldUpdate>
                  {() => {
                    // form.getFieldValue is an imperative call, unlike a
                    // declarative Form.Item's own `name` — it's never
                    // auto-prefixed by this Form.List's own name (the
                    // question number), so it needs the full path spelled
                    // out or it silently reads a different, untouched field
                    // and this never sees is_current actually flip to true.
                    const isCurrent = form.getFieldValue([String(question.question_number), field.name, 'is_current']);
                    return isCurrent ? (
                      <div style={{ flex: '1 1 140px' }}>
                        <div
                          style={{ fontSize: 13, color: 'var(--color-text-secondary, #8B86A2)', marginBottom: 4 }}
                        >
                          End Month
                        </div>
                        <div
                          className="styled-form-input project-details-present"
                          style={{ display: 'flex', alignItems: 'center', width: '100%', ...extraStyle }}
                        >
                          Present
                        </div>
                      </div>
                    ) : (
                      <Form.Item
                        {...field}
                        name={[field.name, 'end_month']}
                        label="End Month"
                        rules={[{ required: true, message: 'End month is required' }]}
                        style={{ marginBottom: 0, flex: '1 1 140px' }}
                      >
                        <DatePicker
                          picker="month"
                          className="styled-form-input"
                          style={{ width: '100%' }}
                          disabledDate={disabledDate}
                        />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
              </div>
              <Form.Item
                {...field}
                name={[field.name, 'is_current']}
                valuePropName="checked"
                style={{ marginBottom: 0, marginTop: 12 }}
              >
                <Checkbox
                  onChange={(e) => {
                    if (e.target.checked) {
                      form.setFieldValue([String(question.question_number), field.name, 'end_month'], undefined);
                    }
                  }}
                >
                  Currently Working on this Project
                </Checkbox>
              </Form.Item>
            </Card>
          ))}
          <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
            Add Project
          </Button>
          <Form.ErrorList errors={errors} />
        </div>
      )}
    </Form.List>
  </div>
  );
};

// "2026-01" -> "Jan 2026"; null if either month is missing/unparseable.
// start_month/end_month are stored as plain "YYYY-MM" strings (see
// useSectionedFormTemplate's handleSubmit normalization) — dayjs parses that
// as valid ISO 8601, no separate format string needed. isCurrent (the
// "Currently Working on this Project" checkbox) shows "Present" in place of
// an end month rather than requiring one.
const formatProjectDuration = (startMonth: any, endMonth: any, isCurrent?: boolean): string | null => {
  const start = startMonth ? dayjs(startMonth) : null;
  const startLabel = start?.isValid() ? start.format('MMM YYYY') : null;
  if (isCurrent) {
    return startLabel ? `${startLabel} – Present` : 'Present';
  }
  const end = endMonth ? dayjs(endMonth) : null;
  const endLabel = end?.isValid() ? end.format('MMM YYYY') : null;
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  return startLabel || endLabel || null;
};

// Submitted-view answer renderer for any "repeatable_text" question (Self
// Assessment's "Project Details") — one read-only card per project, mirroring
// ProjectDetailsField's editable cards above (same "project-details-card"
// class, so the look carries over 1:1 from edit to view) but with every
// interactive control stripped: no Form.Item/Input/DatePicker/Checkbox, no
// Delete icon (no `extra` on the Card at all), no "Add Project" button —
// just a name and a duration string per card. A plain vertical stack (each
// Card already carries its own margin-bottom) works unchanged for one
// project or many. Handles both the current {name, start_month, end_month,
// is_current} entry shape and legacy plain-string entries (answers
// submitted before this question grew Start/End Month), so older
// submissions still render instead of going blank.
export const ProjectDetailsCards: React.FC<{ values: ProjectDetailsAnswer | any; heading?: string }> = ({
  values,
  heading = 'Projects Worked On',
}) => {
  const projects = (Array.isArray(values) ? (values as ProjectDetailsAnswer) : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim() ? { name: entry.trim(), duration: null as string | null } : null;
      }
      if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.trim()) {
        return {
          name: entry.name.trim(),
          duration: formatProjectDuration(entry.start_month, entry.end_month, entry.is_current),
        };
      }
      return null;
    })
    .filter((entry): entry is { name: string; duration: string | null } => entry !== null);

  if (projects.length === 0) {
    return <span>—</span>;
  }
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.2,
          color: 'var(--color-text-secondary, #8B86A2)',
          letterSpacing: '0.04em',
          marginBottom: 8,
        }}
      >
        {heading}
      </div>
      {projects.map((project, index) => (
        <Card key={`${index}-${project.name}`} size="small" className="project-details-card project-details-card--readonly">
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F4F1F8' }}>{project.name}</div>
          {project.duration && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #8B86A2)', marginTop: 4 }}>
              {project.duration}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
};
