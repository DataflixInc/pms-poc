import { useEffect, useMemo, useRef, useState } from 'react';
import { Form, FormInstance, message } from 'antd';
import dayjs from 'dayjs';
import ApiService, {
  FormQuestion,
  FormSubmissionStatus,
  FormTemplateResponse,
  ReviewHistoryEvent,
} from '../services/apiService';
import { useAuth } from '../contexts/AuthContext';
import { rehydrateProjectEntries } from '../utils/formFieldRendering';

export interface FormSection {
  name: string;
  questions: FormQuestion[];
}

// Groups questions by section name — every question naming a given section
// lands in that section's single page, even if the raw `order` interleaves
// them with other sections in between (a data-entry slip on just one or two
// questions' `section` field shouldn't split what's meant to be one page
// into three). A section's page position is the position of its FIRST
// question; later questions for that same name are appended to the
// existing page rather than starting a new one.
export function groupIntoSections(questions: FormQuestion[]): FormSection[] {
  const sortedQuestions = [...questions].sort((a, b) => a.order - b.order);
  const sections: FormSection[] = [];
  const sectionByName = new Map<string, FormSection>();
  for (const question of sortedQuestions) {
    const sectionName = question.section || '';
    let section = sectionByName.get(sectionName);
    if (!section) {
      section = { name: sectionName, questions: [] };
      sectionByName.set(sectionName, section);
      sections.push(section);
    }
    section.questions.push(question);
  }
  return sections;
}

// A repeatable_text (Project Details) entry is blank if it has no non-blank
// project name, no Start Month, or (unless "Currently Working" is checked) no
// End Month — each has its own "required" rule in ProjectDetailsField, so a
// row missing any of them isn't a real answer yet and must block Next exactly
// like a blank name does. Legacy plain-string entries (answers submitted
// before this question grew Start/End Month) are blank under the same
// whitespace rule as before.
const isBlankProjectEntry = (entry: any) => {
  if (typeof entry === 'string') return entry.trim() === '';
  if (!entry || typeof entry.name !== 'string' || entry.name.trim() === '') return true;
  if (!entry.start_month) return true;
  if (!entry.is_current && !entry.end_month) return true;
  return false;
};

// An empty array counts as empty too — e.g. a repeatable_text question (see
// ProjectDetailsField in formFieldRendering.tsx) starts as [] until at least
// one entry is added, and that shouldn't count as "answered" any more than
// an empty string would. A non-empty array still counts as empty if ANY
// entry is blank — clicking "Add Project" pushes a new blank entry (length
// now 1), which isn't a real answer yet, and each entry's name field already
// has its own "required" rule (see ProjectDetailsField), so a stray blank
// row must block Next exactly like an empty field would.
const isEmptyValue = (value: any) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && (value.length === 0 || value.some(isBlankProjectEntry)));

// Shared by SelfAssessment and ManagerEvaluation: fetching a form template +
// submission status, paginating it section-by-section, and submitting it.
// Both forms differ only in which templateId they fetch and how they render
// each question (ManagerEvaluation adds an optional per-question comment
// field), so that part stays in each component.
//
// employeeId is set only by ManagerEvaluation (a manager filling out an
// evaluation about one of their reports); SelfAssessment never passes it, so
// every submission call there is unaffected and still operates on the
// caller's own identity, exactly as before.
export function useSectionedFormTemplate(
  form: FormInstance,
  templateId: number | string | undefined,
  employeeId?: string,
  // Only passed by SelfAssessment, for questions it already knows the answer
  // to (Employee Name/Designation/Department/Date/Review Period) and renders
  // as always-mounted hidden fields instead of a visible page — excluded here
  // so pagination skips straight past what would otherwise be an all-hidden
  // page. `sections` below stays the full, unfiltered grouping regardless, so
  // the read-only submitted view still shows every question. ManagerEvaluation
  // never passes this, so it's completely unaffected.
  isQuestionHidden?: (question: FormQuestion) => boolean,
  // Only passed by SelfAssessment when embedded inline on the Dashboard,
  // whose own getMyProfile() call already returns this exact template +
  // submission (see self_assessment_form in main.py) — skips the
  // GET /api/forms/{id}/full fetch below entirely rather than repeating a
  // call the Dashboard just made. Every other caller (HR/manager viewing an
  // employee, or SelfAssessment reached directly by URL) has no such
  // preloaded profile and fetches normally.
  preloaded?: { template: FormTemplateResponse; submission: FormSubmissionStatus }
) {
  const [template, setTemplate] = useState<FormTemplateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, any> | null>(null);
  // The resolved target's name (self, or the employee being evaluated when
  // employeeId is set) — comes from the same /submission call, so no extra
  // request is needed just to know whose evaluation this is.
  const [targetName, setTargetName] = useState<string | undefined>(undefined);
  const [submittedAt, setSubmittedAt] = useState<string | undefined>(undefined);
  // HR/CDO's decision on this submission — only ever populated for a
  // Manager Evaluation (see set_form_approval in main.py); every other
  // template's submission simply never has this set. Exposing the setter
  // too so a caller (HRManagerEvaluationTab) can optimistically update it
  // right after a successful approve/reject call, without a full refetch.
  const [approvalStatus, setApprovalStatus] = useState<'approved' | 'rejected' | null | undefined>(undefined);
  const [approvalBy, setApprovalBy] = useState<string | null | undefined>(undefined);
  const [approvalAt, setApprovalAt] = useState<string | null | undefined>(undefined);
  // Append-only log backing the Review History timeline — unlike
  // approvalStatus/By/At above, never cleared on resubmit (see the
  // resubmit handler below, which appends to it instead).
  const [history, setHistory] = useState<ReviewHistoryEvent[]>([]);
  // Keyed by templateId+employeeId (not just templateId) so navigating between
  // two employees' evaluations — which reuses the same mounted component,
  // since it's the same route pattern — still triggers a fresh fetch.
  const fetchedFormKeyRef = useRef<string | null>(null);
  const draftSaveTimeoutRef = useRef<number | null>(null);

  const { authState } = useAuth();

  // Rehydrates a server-persisted draft's raw form values (see
  // applyResponse below) — date fields and repeatable_text (Project
  // Details) entries need the same dayjs/entry reconstruction submittedAnswers
  // never needs, since those are stored as plain strings but the form fields
  // expect dayjs objects / structured entries. Takes the just-fetched
  // template directly (not the `template` state) so it can run inside
  // applyResponse before that state has actually committed.
  const restoreDraftAnswers = (templateResponse: FormTemplateResponse, draftAnswers: Record<string, any>) => {
    try {
      const dateFieldNames = new Set(
        templateResponse.questions.filter((q) => q.type === 'date').map((q) => String(q.question_number))
      );
      const repeatableTextFieldNames = new Set(
        templateResponse.questions.filter((q) => q.type === 'repeatable_text').map((q) => String(q.question_number))
      );
      const restored: Record<string, any> = {};
      for (const [key, value] of Object.entries(draftAnswers)) {
        if (dateFieldNames.has(key) && value) {
          restored[key] = dayjs(value as string);
        } else if (repeatableTextFieldNames.has(key)) {
          restored[key] = rehydrateProjectEntries(value);
        } else {
          restored[key] = value;
        }
      }
      form.setFieldsValue(restored);
    } catch {
      // Corrupt or unexpected draft shape shouldn't block the form from loading.
    }
  };

  useEffect(() => {
    if (templateId === undefined) return;
    const formKey = `${templateId}:${employeeId ?? ''}`;
    // Guards against React StrictMode's dev-only double-invoke of effects —
    // without this, the same fetch fires twice on every mount.
    if (fetchedFormKeyRef.current === formKey) return;
    fetchedFormKeyRef.current = formKey;

    const applyResponse = (response: FormTemplateResponse, submission: FormSubmissionStatus) => {
      setTemplate(response);
      setCurrentSectionIndex(0);
      setTargetName(submission.employee_name);
      if (submission.submitted) {
        setSubmittedAnswers(submission.answers || {});
        setSubmittedAt(submission.submitted_at);
        setApprovalStatus(submission.approval_status);
        setApprovalBy(submission.approval_by);
        setApprovalAt(submission.approval_at);
        setHistory(submission.history || []);
      } else if (submission.draft_answers) {
        restoreDraftAnswers(response, submission.draft_answers);
      }
    };

    if (preloaded) {
      setSubmittedAnswers(null);
      applyResponse(preloaded.template, preloaded.submission);
      setLoading(false);
      return;
    }

    const fetchTemplate = async () => {
      setLoading(true);
      setError(null);
      setSubmittedAnswers(null);
      try {
        const { template: response, submission } = await ApiService.getFormWithSubmission(templateId, employeeId);
        applyResponse(response, submission);
      } catch (err: any) {
        setError(err?.message || 'Failed to load form template');
      } finally {
        setLoading(false);
      }
    };

    fetchTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, employeeId]);

  // Memoized so its (and currentSection's) object identity only changes when
  // the template itself changes — not on every render. Form.useWatch below
  // re-renders this hook on every keystroke; without memoizing, that would
  // hand the autofocus effect a "new" currentSection each time (same data,
  // different reference), re-triggering it mid-typing and stealing focus
  // back to the section's first field a moment later.
  const sections = useMemo(() => (template ? groupIntoSections(template.questions) : []), [template]);

  // Same grouping, minus whichever questions the caller already knows the
  // answer to — this is what pagination (currentSection/isFirstSection/
  // isLastSection/handleNext) actually walks through, so a page made up
  // entirely of hidden questions never appears as a page at all. Equal to
  // `sections` whenever no isQuestionHidden is passed.
  const fillableSections = useMemo(() => {
    if (!template) return [];
    const visibleQuestions = isQuestionHidden
      ? template.questions.filter((q) => !isQuestionHidden(q))
      : template.questions;
    return groupIntoSections(visibleQuestions);
  }, [template, isQuestionHidden]);

  const currentSection = fillableSections[currentSectionIndex];
  const isFirstSection = currentSectionIndex === 0;
  const isLastSection = currentSectionIndex === fillableSections.length - 1;

  // Re-renders on every field change so isCurrentSectionComplete stays live
  // as the user types/selects, without needing its own local state.
  const liveValues = Form.useWatch([], form) || {};
  const isCurrentSectionComplete = !!currentSection && currentSection.questions.every(
    (q) => !isEmptyValue((liveValues as Record<string, any>)[String(q.question_number)])
  );

  // Autofocus the first field whenever the visible section changes (including
  // on initial load). Deferred a tick so the just-toggled display:none/visible
  // state has committed before we try to focus something inside it.
  useEffect(() => {
    if (!currentSection || currentSection.questions.length === 0) return;
    const firstFieldName = String(currentSection.questions[0].question_number);
    const timeoutId = window.setTimeout(() => {
      try {
        const instance = form.getFieldInstance(firstFieldName) as { focus?: () => void } | undefined;
        instance?.focus?.();
      } catch {
        // Not every control type supports imperative focus — safe to ignore.
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSectionIndex, currentSection]);

  const handleNext = async () => {
    if (!currentSection) return;
    // Scope validation to just this section's fields — every section's
    // Form.Items are always mounted, so an unscoped validateFields() would
    // also flag not-yet-visited sections' empty required fields. Each
    // question's own optional `{question_number}_comment` field name is
    // included alongside it — validateFields silently ignores names that
    // aren't currently a registered field, so this is a no-op for every
    // question without a comment box (or one not currently required, e.g.
    // ManagerEvaluation's conditional radio comment when unmounted), and
    // only actually blocks Next when a currently-mounted comment field's own
    // `required` rule fails (see ManagerEvaluation.tsx's has_comment fields).
    const fieldNames = currentSection.questions.flatMap((q) => [
      String(q.question_number),
      `${q.question_number}_comment`,
    ]);
    try {
      await form.validateFields(fieldNames);
    } catch {
      return;
    }
    setCurrentSectionIndex((index) => Math.min(index + 1, fillableSections.length - 1));
  };

  const handlePrevious = () => {
    setCurrentSectionIndex((index) => Math.max(index - 1, 0));
  };

  // Debounced draft autosave: persists the whole form (not just the current
  // section) to the backend (see PUT .../draft in main.py) so values survive
  // a refresh, a different tab, or an entirely different device — not just a
  // back-navigation in the same browser. Debounced so fast typing doesn't
  // fire a request on every keystroke.
  const handleValuesChange = () => {
    if (templateId === undefined) return;
    if (draftSaveTimeoutRef.current !== null) {
      window.clearTimeout(draftSaveTimeoutRef.current);
    }
    draftSaveTimeoutRef.current = window.setTimeout(() => {
      ApiService.saveFormDraft(templateId, form.getFieldsValue(true), employeeId).catch(() => {
        // Best-effort — drafts are a nice-to-have, not required for the form
        // to function.
      });
    }, 250);
  };

  const handleSubmit = async (values: Record<string, any>) => {
    if (templateId === undefined || !template) return;
    setSubmitting(true);
    // Date fields hold dayjs objects, which JSON.stringify serializes to a
    // UTC ISO timestamp — for timezones ahead of UTC that shifts the date
    // back a day once read back. Reduce to a plain YYYY-MM-DD before sending.
    const normalizedValues = { ...values };
    for (const question of template.questions) {
      const key = String(question.question_number);
      const value = normalizedValues[key];
      if (question.type === 'date' && value && typeof value.format === 'function') {
        normalizedValues[key] = value.format('YYYY-MM-DD');
      }
      // repeatable_text (Project Details): drop blank entries (e.g. a row
      // left untouched between two filled-in ones after a reorder — the
      // name field's own "required" rule already blocks submit if a VISIBLE
      // entry is blank, this just guards against a stray one slipping
      // through), and reduce each entry's start_month/end_month from a
      // dayjs object to a plain "YYYY-MM" string for the same
      // JSON-serialization reason date fields are reduced above. is_current
      // ("Currently Working on this Project") forces end_month to null
      // regardless of whatever the now-hidden End Month field's value still
      // is — the UI already clears it on check (see ProjectDetailsField's
      // Checkbox onChange), this is just the same guarantee at submit time.
      if (Array.isArray(value)) {
        normalizedValues[key] = value
          .filter((entry) => !isBlankProjectEntry(entry))
          .map((entry) => {
            if (typeof entry === 'string') return entry;
            const isCurrent = !!entry.is_current;
            return {
              name: entry.name,
              is_current: isCurrent,
              start_month:
                entry.start_month && typeof entry.start_month.format === 'function'
                  ? entry.start_month.format('YYYY-MM')
                  : entry.start_month ?? null,
              end_month: isCurrent
                ? null
                : entry.end_month && typeof entry.end_month.format === 'function'
                ? entry.end_month.format('YYYY-MM')
                : entry.end_month ?? null,
            };
          });
      }
    }
    try {
      await ApiService.submitFormTemplate(templateId, normalizedValues, employeeId);
      message.success('Form submitted');
      const now = new Date().toISOString();
      setSubmittedAnswers(normalizedValues);
      // Previously missing entirely — submitted_at is set server-side on
      // every submit/resubmit, but nothing here ever reflected that back
      // optimistically, so callers reading submittedAt (e.g. HREvaluationTab's
      // "Submitted on" row, which also supplies the visual gap before the
      // questions) saw nothing until a full refetch.
      setSubmittedAt(now);
      // Mirrors update_form_submission clearing these server-side on any
      // resubmission — most relevantly, a Manager Evaluation resubmitted
      // after rejection goes back to "pending" immediately rather than
      // still showing "Rejected" until some future refetch.
      setApprovalStatus(undefined);
      setApprovalBy(undefined);
      setApprovalAt(undefined);
      // Mirrors insert_form_submission/update_form_submission appending a
      // new submitted/resubmitted event server-side — so History reflects
      // it immediately, without needing a refetch, the same way the three
      // fields above already update optimistically. An empty history so far
      // means this is the first-ever submission (mirrors the backend's own
      // insert-vs-update branch, which is keyed off the same fact: whether a
      // submission already existed).
      setHistory((prev) => [
        ...prev,
        { event: prev.length === 0 ? 'submitted' : 'resubmitted', at: now, by: authState.user?.name },
      ]);
    } catch (err: any) {
      if (err?.status === 409) {
        message.error('You have already submitted this form.');
        setSubmittedAnswers(normalizedValues);
      } else {
        message.error(err?.message || 'Failed to submit form');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    template,
    loading,
    error,
    sections,
    fillableSections,
    currentSectionIndex,
    currentSection,
    isFirstSection,
    isLastSection,
    isCurrentSectionComplete,
    submitting,
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
    targetName,
    handleNext,
    handlePrevious,
    handleSubmit,
    handleValuesChange,
  };
}
