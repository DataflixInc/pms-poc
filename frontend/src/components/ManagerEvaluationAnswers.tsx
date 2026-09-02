import React from 'react';
import { Typography } from 'antd';
import { FormSection } from '../hooks/useSectionedFormTemplate';
import { formatAnswer } from '../utils/formFieldRendering';
import '../styles/evaluationForm.css';

const { Title, Text } = Typography;

const commentFieldName = (questionNumber: number) => `${questionNumber}_comment`;

export interface ManagerEvaluationAnswersProps {
  sections: FormSection[];
  answers: Record<string, any>;
}

// Pure, read-only rendering of a submitted Manager Evaluation's questions,
// ratings, and manager comments — no <Form>, no input fields, no
// submit/save-draft actions anywhere in this component. Extracted out of
// ManagerEvaluation.tsx's own submitted view so it can be reused as-is (not
// re-implemented) by the HR Dashboard's Employee Review Details
// "Manager Evaluation" tab — both stay pixel-identical because they render
// from the exact same component.
export const ManagerEvaluationAnswers: React.FC<ManagerEvaluationAnswersProps> = ({ sections, answers }) => {
  // A running count of VISIBLE questions rather than each question's own
  // question_number — callers that filter out an auto-filled question first
  // (e.g. HREvaluationTab.tsx skipping "Review Period") would otherwise show
  // a gap (e.g. starting at "2.") where the hidden question used to be.
  // Identical to question_number for any caller passing every question
  // unfiltered, since question_number is always contiguous from 1 anyway.
  let displayNumber = 0;
  return (
    <div>
      {sections.map((section, index) => (
        <div
          key={index}
          style={{
            marginBottom: 32,
            paddingTop: index > 0 ? 32 : 0,
            borderTop: index > 0 ? '1px solid var(--color-border, rgba(255,255,255,0.12))' : undefined,
          }}
        >
          {section.name && (
            <Title level={4} style={{ marginBottom: 32 }}>
              {section.name}
            </Title>
          )}
          {section.questions.map((question) => {
            displayNumber += 1;
            return (
              <div
                key={question.question_number}
                style={{ display: 'flex', marginBottom: 24, marginLeft: 8, lineHeight: 1.5, fontSize: 16, fontWeight: 600 }}
              >
                <Text strong style={{ flexShrink: 0 }}>
                  {displayNumber}.&nbsp;
                </Text>
                <div>
                  <Text strong style={{ whiteSpace: 'pre-line' }}>
                    {question.question}
                  </Text>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, fontWeight: 400, marginTop: 8 }}>
                    {formatAnswer(answers[String(question.question_number)], question)}
                  </div>
                  {question.has_comment && answers[commentFieldName(question.question_number)] && (
                    <div
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontSize: 15,
                        fontWeight: 400,
                        marginTop: 12,
                        paddingLeft: 12,
                        borderLeft: '3px solid var(--color-border, rgba(255,255,255,0.12))',
                        fontStyle: 'italic',
                        color: '#C5C0D6',
                      }}
                    >
                      {question.comment_label}: {answers[commentFieldName(question.question_number)]}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default ManagerEvaluationAnswers;
