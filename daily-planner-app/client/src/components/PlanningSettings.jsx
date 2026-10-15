import { useId, useRef, useState } from 'react';
import { formatDuration } from '../lib/dates.js';
import { dayLengthMinutes, defaultSettings, validateSettings } from '../lib/planningSettings.js';
import { CloseIcon } from './icons.jsx';

const ORDER = ['planningDate', 'dayStart', 'dayEnd'];

/**
 * Planning settings form, shown in the shared Modal.
 * `onSave(values)` returns { ok, errors?, storageError? } (see usePlanningSettings);
 * the parent closes the panel when there are no validation errors.
 */
export default function PlanningSettings({ settings, today, titleId, onSave, onCancel }) {
  const uid = useId();
  const [values, setValues] = useState(settings);
  const [errors, setErrors] = useState({});
  const fields = useRef({});
  const id = (f) => `${uid}-${f}`;

  const update = (field, value) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      const clear = field === 'dayStart' ? ['dayStart', 'dayEnd'] : [field];
      if (!clear.some((f) => e[f])) return e;
      const next = { ...e };
      clear.forEach((f) => delete next[f]);
      return next;
    });
  };

  function handleSubmit(event) {
    event.preventDefault();
    const found = validateSettings(values, today);
    if (Object.keys(found).length) {
      setErrors(found);
      fields.current[ORDER.find((f) => found[f])]?.focus();
      return;
    }
    const result = onSave(values); // the parent closes the panel unless there are errors
    if (result.errors) setErrors(result.errors);
  }

  const inputProps = (field, hintId) => ({
    id: id(field),
    name: field,
    value: values[field],
    onChange: (e) => update(field, e.target.value),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': [errors[field] && `${id(field)}-error`, hintId].filter(Boolean).join(' ') || undefined,
    ref: (el) => {
      fields.current[field] = el;
    },
  });
  const fieldError = (field) =>
    errors[field] ? (
      <p id={`${id(field)}-error`} className="field-error">
        {errors[field]}
      </p>
    ) : null;

  const length = dayLengthMinutes(values);

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <header className="modal-header">
        <h2 id={titleId}>Planning settings</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <div className="modal-body">
        <p className="modal-intro">
          Set the day you’re planning and your working hours. These are saved on this device and will be used when
          automatic day planning arrives.
        </p>

        <div className="field">
          <label htmlFor={id('planningDate')}>Planning date</label>
          <input type="date" min={today} data-autofocus {...inputProps('planningDate')} />
          {fieldError('planningDate')}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={id('dayStart')}>Day starts</label>
            <input type="time" step="60" {...inputProps('dayStart', `${uid}-length`)} />
            {fieldError('dayStart')}
          </div>
          <div className="field">
            <label htmlFor={id('dayEnd')}>Day ends</label>
            <input type="time" step="60" {...inputProps('dayEnd', `${uid}-length`)} />
            {fieldError('dayEnd')}
          </div>
        </div>
        <p id={`${uid}-length`} className="field-hint day-length">
          {length > 0 ? `${formatDuration(length)} available to plan.` : 'Set a start and end time.'}
        </p>

        <div className="switch-field">
          <div>
            <label htmlFor={id('deep')} className="switch-label">
              Prefer deep-focus work before noon
            </label>
            <p id={`${uid}-deep-hint`} className="field-hint">
              Tasks marked “Deep focus” will be placed in the morning when possible.
            </p>
          </div>
          <input
            id={id('deep')}
            type="checkbox"
            role="switch"
            className="switch"
            checked={values.preferDeepWorkBeforeNoon}
            onChange={(e) => update('preferDeepWorkBeforeNoon', e.target.checked)}
            aria-describedby={`${uid}-deep-hint`}
          />
        </div>
      </div>

      <footer className="modal-footer">
        <button type="button" className="link-btn footer-reset" onClick={() => setValues(defaultSettings(today))}>
          Reset to defaults
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </footer>
    </form>
  );
}
