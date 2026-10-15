import { useId, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_NAMES } from '../lib/categories.js';
import { formatDuration } from '../lib/dates.js';
import {
  DURATION_WARNING_MESSAGE,
  ENERGY_LEVELS,
  FIELD_ORDER,
  LIMITS,
  PLANNING_DEFAULTS,
  PRIORITIES,
  blockMinutes,
  durationConflict,
  hasErrors,
  parseDuration,
  toPayload,
  validateTask,
} from '../lib/validateTask.js';
import { CheckIcon, CloseIcon, InfoIcon } from './icons.jsx';

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

const blankTask = (date, initial = {}) => ({
  title: initial.title ?? '',
  category: initial.category ?? '',
  scheduledDate: initial.scheduledDate ?? date,
  startTime: initial.startTime ?? '',
  endTime: initial.endTime ?? '',
  notes: initial.notes ?? '',
  ...PLANNING_DEFAULTS,
});

const fromTask = (task) => ({
  title: task.title,
  category: task.category,
  scheduledDate: task.scheduledDate,
  startTime: task.startTime ?? '',
  endTime: task.endTime ?? '',
  notes: task.notes ?? '',
  durationMinutes: String(task.durationMinutes ?? PLANNING_DEFAULTS.durationMinutes),
  priority: task.priority ?? PLANNING_DEFAULTS.priority,
  dueDate: task.dueDate ?? '',
  isFixed: Boolean(task.isFixed),
  energy: task.energy ?? '', // null = "Not set" (tasks created before energy existed)
});

// Errors that depend on another field are cleared when that field changes.
const DEPENDENT_ERRORS = {
  startTime: ['endTime'],
  isFixed: ['startTime'],
};

/**
 * The one task form, used for both Add and Edit:
 *  - Edit: pass `task`; fields start from the saved task.
 *  - Add:  omit `task`; fields start empty on `defaultDate` with planning
 *          defaults (60 min, medium, not fixed, normal energy), or from
 *          `initialValues` (Quick Add's "Add details" passes its draft).
 * `onSubmit(payload)` must return a promise; if it rejects with an API error
 * carrying `details`, those field messages are shown inline.
 */
export default function TaskForm({ task, initialValues, defaultDate, titleId, onSubmit, onCancel }) {
  const isEdit = Boolean(task);
  const uid = useId();
  const [values, setValues] = useState(() => (task ? fromTask(task) : blankTask(defaultDate, initialValues)));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const fields = useRef({});

  const ids = Object.fromEntries([...FIELD_ORDER, 'isFixed'].map((f) => [f, `${uid}-${f}`]));
  const errorId = (f) => `${ids[f]}-error`;

  const update = (field, value) => {
    setValues((v) => {
      const next = { ...v, [field]: value };
      // Keep the duration in step with a start–end block when there is one.
      if (field === 'startTime' || field === 'endTime') {
        const block = blockMinutes(next.startTime, next.endTime);
        if (block && block >= LIMITS.minDuration && block <= LIMITS.maxDuration) {
          next.durationMinutes = String(block);
        }
      }
      return next;
    });
    setErrors((e) => {
      const toClear = [field, ...(DEPENDENT_ERRORS[field] ?? [])];
      if (field === 'startTime' || field === 'endTime') toClear.push('durationMinutes');
      if (!toClear.some((f) => e[f])) return e;
      const next = { ...e };
      toClear.forEach((f) => delete next[f]);
      return next;
    });
  };

  const focusFirstError = (errs) => {
    const first = FIELD_ORDER.find((f) => errs[f]) ?? (errs.isFixed && 'isFixed');
    fields.current[first]?.focus();
  };

  async function handleSubmit(event) {
    event.preventDefault();
    const clientErrors = validateTask(values);
    if (hasErrors(clientErrors)) {
      setErrors(clientErrors);
      setFormError(null);
      focusFirstError(clientErrors);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(toPayload(values));
      // Parent closes the dialog on success; nothing else to do here.
    } catch (error) {
      setSaving(false);
      if (error.details) {
        setErrors(error.details);
        setFormError('Please fix the highlighted fields.');
        focusFirstError(error.details);
      } else {
        setFormError(error.message || 'Something went wrong. Please try again.');
      }
    }
  }

  // Props shared by every input: id, error wiring and a ref for focusing.
  const inputProps = (field, extra = {}) => ({
    id: ids[field],
    name: field,
    value: values[field],
    onChange: (e) => update(field, e.target.value),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': [errors[field] && errorId(field), extra.hintId].filter(Boolean).join(' ') || undefined,
    ref: (el) => {
      fields.current[field] = el;
    },
  });

  const fieldError = (field) =>
    errors[field] ? (
      <p id={errorId(field)} className="field-error">
        {errors[field]}
      </p>
    ) : null;

  const timeHintId = `${uid}-time-hint`;
  const durationHintId = `${uid}-duration-hint`;
  const fixedHintId = `${uid}-fixed-hint`;
  const hasTime = values.startTime || values.endTime;
  const block = blockMinutes(values.startTime, values.endTime);
  const durationMatchesBlock = block !== null && parseDuration(values.durationMinutes) === block;

  // Non-blocking: estimate vs. scheduled block differ by more than 30 minutes.
  // Hidden while a related validation error is showing, so messages don't stack.
  const conflict = durationConflict(values);
  const showDurationWarning = Boolean(conflict) && !errors.startTime && !errors.endTime && !errors.durationMinutes;
  const durationWarningId = `${uid}-duration-warning`;

  return (
    <form className="task-form" onSubmit={handleSubmit} noValidate>
      <header className="modal-header">
        <h2 id={titleId}>{isEdit ? 'Edit task' : 'New task'}</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <div className="modal-body">
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="field">
          <label htmlFor={ids.title}>Title</label>
          <input
            type="text"
            autoComplete="off"
            maxLength={LIMITS.title}
            placeholder="What do you need to do?"
            data-autofocus
            {...inputProps('title')}
          />
          {fieldError('title')}
        </div>

        <fieldset
          className="field"
          aria-invalid={errors.category ? true : undefined}
          aria-describedby={errors.category ? errorId('category') : undefined}
        >
          <legend>Category</legend>
          <div className="category-options">
            {CATEGORY_NAMES.map((name, i) => (
              <label key={name} className="category-option" style={{ '--cat': CATEGORIES[name].color }}>
                <input
                  type="radio"
                  name="category"
                  value={name}
                  checked={values.category === name}
                  onChange={() => update('category', name)}
                  ref={(el) => {
                    // Focus target for errors: the selected option, or the first one.
                    if ((values.category ? values.category === name : i === 0) && el) {
                      fields.current.category = el;
                    }
                  }}
                />
                <span className="category-dot" aria-hidden="true" />
                {name}
                {/* Selected state is shown by a check mark, not only by color. */}
                <CheckIcon className="category-check" width={15} height={15} />
              </label>
            ))}
          </div>
          {fieldError('category')}
        </fieldset>

        <div className="field">
          <label htmlFor={ids.scheduledDate}>Date</label>
          <input type="date" required {...inputProps('scheduledDate')} />
          {fieldError('scheduledDate')}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={ids.startTime}>
              Start time <span className="optional">optional</span>
            </label>
            <input type="time" step="60" {...inputProps('startTime', { hintId: timeHintId })} />
            {fieldError('startTime')}
          </div>
          <div className="field">
            <label htmlFor={ids.endTime}>
              End time <span className="optional">optional</span>
            </label>
            <input type="time" step="60" {...inputProps('endTime', { hintId: timeHintId })} />
            {fieldError('endTime')}
          </div>
        </div>
        <div className="time-hint-row">
          <p id={timeHintId} className="field-hint">
            Leave both empty for an “anytime” task.
          </p>
          {hasTime && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                update('startTime', '');
                update('endTime', '');
              }}
            >
              Clear times
            </button>
          )}
        </div>

        <div className="field check-field">
          <label className="checkbox-label" htmlFor={ids.isFixed}>
            <input
              id={ids.isFixed}
              type="checkbox"
              className="check check-sm"
              checked={values.isFixed}
              onChange={(e) => update('isFixed', e.target.checked)}
              aria-describedby={fixedHintId}
              ref={(el) => {
                fields.current.isFixed = el;
              }}
            />
            Fixed time
          </label>
          <p id={fixedHintId} className="field-hint">
            For appointments and classes: the planner won’t move it. Needs a start time.
          </p>
        </div>

        <fieldset className="planning-group">
          <legend>Planning details</legend>

          <div className="field">
            <label htmlFor={ids.durationMinutes}>Duration</label>
            <div className="duration-row">
              <div className="input-suffix">
                <input
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.minDuration}
                  max={LIMITS.maxDuration}
                  step="5"
                  {...inputProps('durationMinutes', {
                    hintId: showDurationWarning ? `${durationHintId} ${durationWarningId}` : durationHintId,
                  })}
                />
                <span aria-hidden="true">min</span>
              </div>
              <div className="presets" role="group" aria-label="Duration presets">
                {DURATION_PRESETS.map((m) => {
                  const active = parseDuration(values.durationMinutes) === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      className={`preset${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => update('durationMinutes', String(m))}
                    >
                      {m < 60 ? `${m}m` : `${m / 60}h`}
                    </button>
                  );
                })}
              </div>
            </div>
            <p id={durationHintId} className="field-hint">
              {durationMatchesBlock
                ? 'Matches the start and end time.'
                : `How long it takes, ${LIMITS.minDuration}–${LIMITS.maxDuration} minutes.`}
            </p>
            {fieldError('durationMinutes')}
            {/* Always rendered so screen readers announce the note when it appears. */}
            <div aria-live="polite">
              {showDurationWarning && (
                <div id={durationWarningId} className="field-warning">
                  <InfoIcon className="field-warning-icon" width={16} height={16} />
                  <div>
                    <p>
                      <strong>Note:</strong> {DURATION_WARNING_MESSAGE}
                    </p>
                    <p className="field-warning-detail">
                      Estimate: {formatDuration(conflict.durationMinutes)} · Time block:{' '}
                      {formatDuration(conflict.blockMinutes)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <fieldset
            className="field"
            aria-invalid={errors.priority ? true : undefined}
            aria-describedby={errors.priority ? errorId('priority') : undefined}
          >
            <legend>Priority</legend>
            <div className="choice-options">
              {PRIORITIES.map((p) => (
                <label key={p.value} className="choice-option">
                  <input
                    type="radio"
                    name="priority"
                    value={p.value}
                    checked={values.priority === p.value}
                    onChange={() => update('priority', p.value)}
                    ref={(el) => {
                      if (el && values.priority === p.value) fields.current.priority = el;
                    }}
                  />
                  {p.label}
                  <CheckIcon className="category-check" width={15} height={15} />
                </label>
              ))}
            </div>
            {fieldError('priority')}
          </fieldset>

          <div className="field-row">
            <div className="field">
              <label htmlFor={ids.energy}>Energy needed</label>
              <select {...inputProps('energy')}>
                {ENERGY_LEVELS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
                <option value="">Not set</option>
              </select>
              {fieldError('energy')}
            </div>
            <div className="field">
              <label htmlFor={ids.dueDate}>
                Due date <span className="optional">optional</span>
              </label>
              <input type="date" {...inputProps('dueDate')} />
              {fieldError('dueDate')}
            </div>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={ids.notes}>
            Notes <span className="optional">optional</span>
          </label>
          <textarea rows={3} maxLength={LIMITS.notes} placeholder="Details, links, reps…" {...inputProps('notes')} />
          {fieldError('notes')}
        </div>
      </div>

      <footer className="modal-footer">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  );
}
