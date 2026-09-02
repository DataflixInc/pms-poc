import React from 'react';
import { Typography } from 'antd';
import { FormSection } from '../hooks/useSectionedFormTemplate';
import { buildQuestionDisplayNumbers, formatAnswer, ProjectDetailsCards } from '../utils/formFieldRendering';
import '../styles/evaluationForm.css';

const { Title, Text } = Typography;

const QUESTION_LABEL_STYLE: React.CSSProperties = { fontWeight: 600, color: '#F4F1F8' };
const ANSWER_TEXT_STYLE: React.CSSProperties = { fontSize: 15, fontWeight: 400 };

// Same set selfassesment.tsx excludes from the fillable form (see
// AUTO_FILLED_QUESTION_TEXTS there) — the employee never typed these in
// themselves (Employee Name/Designation/Department/Date are pulled from
// their profile, Review Period from the current cycle), so they're skipped
// here too rather than shown as answered questions in the read-only view.
const AUTO_FILLED_QUESTION_TEXTS = new Set(['Employee Name', 'Designation', 'Department', 'Date', 'Review Period']);

export interface SelfAssessmentAnswersProps {
  sections: FormSection[];
  answers: Record<string, any>;
}

// Pure, read-only rendering of a submitted Self-Assessment's questions and
// answers — no <Form>, no input fields, no submit/save-draft actions
// anywhere in this component, so there is no code path here that could ever
// change a submitted answer. Extracted out of selfassesment.tsx's own
// submitted view so it can be reused as-is (not re-implemented) by the HR
// Dashboard's Employee Review Details "Self Assessment" tab — both stay
// pixel-identical because they render from the exact same component.
export const SelfAssessmentAnswers: React.FC<SelfAssessmentAnswersProps> = ({ sections, answers }) => {
  // Drop auto-filled questions, and any section left with nothing else in
  // it (so an all-auto-filled section doesn't render as an empty heading).
  const visibleSections = sections
    .map((section) => ({
      ...section,
      questions: section.questions.filter((question) => !AUTO_FILLED_QUESTION_TEXTS.has(question.question)),
    }))
    .filter((section) => section.questions.length > 0);
  // Renumber sequentially over what's actually shown — same technique the
  // fillable form already uses (buildQuestionDisplayNumbers) so the visible
  // list never skips numbers because of a filtered-out question in between.
  const displayNumbers = buildQuestionDisplayNumbers(visibleSections);

  return (
    <div>
      {visibleSections.map((section, index) => (
        <div
          key={index}
          style={{
            marginBottom: 32,
            paddingTop: index > 0 ? 32 : 0,
            borderTop: index > 0 ? '1px solid var(--color-border, rgba(255,255,255,0.12))' : undefined,
          }}
        >
          {section.name && (
            <Title level={4} className="evaluation-section-title">
              {section.name}
            </Title>
          )}
          {section.questions.map((question) => (
            <div
              key={question.question_number}
              style={{ display: 'flex', marginBottom: 24, marginLeft: 8, lineHeight: 1.5, fontSize: 16 }}
            >
              <Text strong style={{ flexShrink: 0, ...QUESTION_LABEL_STYLE }}>
                {displayNumbers.get(question.question_number)}.&nbsp;
              </Text>
              <div>
                <Text strong style={{ whiteSpace: 'pre-line', ...QUESTION_LABEL_STYLE }}>
                  {question.question}
                </Text>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 8, ...ANSWER_TEXT_STYLE }}>
                  {question.type === 'repeatable_text' ? (
                    <ProjectDetailsCards values={answers[String(question.question_number)]} />
                  ) : (
                    formatAnswer(answers[String(question.question_number)], question)
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default SelfAssessmentAnswers;
