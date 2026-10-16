// Compact one-line "add to today" bar: title, category, optional start time.
// "Add details" hands the current draft to the full task form modal; the bar
// clears itself only once that modal actually saves.
import { useId, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_NAMES } from '../lib/categories.js';
import { LIMITS } from '../lib/validateTask.js';
import { PlusIcon } from './icons.jsx';

const STORAGE_KEY = 'planner.quickAddCategory';

function readLastCategory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return CATEGORY_NAMES.includes(saved) ? saved : CATEGORY_NAMES[0];
  } catch {
    return CATEGORY_NAMES[0];
  }
}

function rememberCategory(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* storage unavailable — the default is fine */
  }
}

/**
 * @param today        YYYY-MM-DD, used as the scheduled date
 * @param onAdd        (payload) => Promise — creates the task; rejects with API errors
 * @param onAddDetails (draft, clear) => void — open the full form with this draft;
 *                     call `clear()` after it saves
 */
export default function QuickAdd({ today, onAdd, onAddDetails }) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(readLastCategory);
  const [startTime, setStartTime] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef(null);

  const ids = {
    title: `${uid}-title`,
    category: `${uid}-category`,
    time: `${uid}-time`,
    error: `${uid}-error`,
  };

  const clear = () => {
    setTitle('');
    setStartTime('');
    setError(null);
  };

  const chooseCategory = (name) => {
    setCategory(name);
    rememberCategory(name);
  };

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Type a title to add a task.');
      titleRef.current?.focus();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onAdd({
        title: trimmed,
        category,
        scheduledDate: today,
        startTime: startTime ? startTime.slice(0, 5) : null,
        endTime: null,
        notes: '',
      });
      clear();
      titleRef.current?.focus(); // ready for the next one
    } catch (err) {
      const fieldMessage = err.details && Object.values(err.details)[0];
      setError(fieldMessage || err.message || 'Couldn’t add the task. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const openDetails = () => {
    onAddDetails(
      {
        title: title.trim(),
        category,
        scheduledDate: today,
        startTime: startTime ? startTime.slice(0, 5) : '',
      },
      clear,
    );
  };

  const cat = CATEGORIES[category];

  return (
    <form
      className="quick-add"
      onSubmit={handleSubmit}
      noValidate
      aria-label="Quick add a task for today"
      style={{ '--cat': cat.color, '--cat-tint': cat.tint }}
    >
      <div className="qa-title">
        <label htmlFor={ids.title} className="visually-hidden">
          Task title
        </label>
        <PlusIcon className="qa-plus" />
        <input
          ref={titleRef}
          id={ids.title}
          type="text"
          autoComplete="off"
          maxLength={LIMITS.title}
          placeholder="Add a task for today…"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
        />
      </div>

      <div className="qa-controls">
        <div className="qa-category">
          <label htmlFor={ids.category} className="visually-hidden">
            Category
          </label>
          <span className="qa-dot" aria-hidden="true" />
          <select id={ids.category} value={category} onChange={(e) => chooseCategory(e.target.value)}>
            {CATEGORY_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="qa-time">
          <label htmlFor={ids.time} className="visually-hidden">
            Start time (optional)
          </label>
          <input
            id={ids.time}
            type="time"
            step="60"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            title="Start time (optional)"
          />
        </div>

        <button type="submit" className="btn btn-secondary btn-sm qa-add" disabled={saving}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm qa-details" onClick={openDetails}>
          Add details
        </button>
      </div>

      {error && (
        <p id={ids.error} className="field-error qa-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
