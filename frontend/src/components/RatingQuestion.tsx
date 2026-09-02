import React from 'react';
import { Slider } from 'antd';
import { FormQuestion } from '../services/apiService';
import '../styles/ratingQuestion.css';

export interface RatingQuestionProps {
  question: FormQuestion;
  // null/undefined both mean "nothing picked yet" — kept distinct from 0,
  // which is a real, selectable rating on this 0-10 scale.
  value?: number | null;
  onChange?: (value: number) => void;
  disabled?: boolean;
  // 1-based position among only the questions actually visible to the user
  // (see buildQuestionDisplayNumbers) — falls back to the question's raw
  // question_number, same convention renderQuestionLabel already uses.
  displayNumber?: number;
}

// Enterprise-style 0-10 rating slider (Microsoft/Workday/SAP
// SuccessFactors-inspired) for any `type: "slider"` question — reusable
// wherever renderField dispatches on that type. Question number + bold
// title + muted description, an Ant Design Slider themed to the app's
// primary purple, and a persistent "Selected Rating: X / max" readout below
// it. The default antd drag tooltip is switched off so that readout — which
// updates live from the same onChange — is the only place the value ever
// shows, rather than duplicating it in a floating bubble too.
//
// value/onChange match antd's own Form.Item child contract exactly, so this
// drops straight into `<Form.Item name={...} rules={[{ required: true,
// message: 'Please provide a rating.' }]}><RatingQuestion .../></Form.Item>`
// with no extra wiring — Form.Item injects both automatically and renders
// the validation message itself, the same as every other question type in
// these forms, rather than this component inventing its own separate
// error-display mechanism.
const RatingQuestion: React.FC<RatingQuestionProps> = ({ question, value, onChange, disabled = false, displayNumber }) => {
  const min = question.min ?? 0;
  const max = question.max ?? 10;
  const step = question.step ?? 1;
  const hasValue = value !== null && value !== undefined;
  const marks = { [min]: String(min), [max]: String(max) };

  return (
    <div className={`rating-question${disabled ? ' rating-question--disabled' : ''}`}>
      <div className="rating-question-header">
        <span className="rating-question-number">{displayNumber ?? question.question_number}.</span>
        <div className="rating-question-copy">
          <span className="rating-question-title">
            {question.question}
            {question.required && (
              <span className="rating-question-required" aria-hidden="true">
                *
              </span>
            )}
          </span>
          {question.description && <span className="rating-question-description">{question.description}</span>}
        </div>
      </div>

      <div className="rating-question-control">
        <Slider
          className="rating-question-slider"
          min={min}
          max={max}
          step={step}
          value={hasValue ? (value as number) : undefined}
          onChange={onChange}
          disabled={disabled}
          marks={marks}
          included
          tooltip={{ open: false }}
        />
      </div>

      <div className="rating-question-result">
        <span className="rating-question-result-label">Selected Rating:</span>
        <span className={`rating-question-result-value${hasValue ? '' : ' rating-question-result-value--empty'}`}>
          {hasValue ? `${value} / ${max}` : 'Not Selected'}
        </span>
      </div>
    </div>
  );
};

export default RatingQuestion;
