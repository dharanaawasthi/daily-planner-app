import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, Show, SignIn, UserButton, useAuth } from '@clerk/react';
import { setTokenProvider } from './api.js';
import BacklogItem from './components/BacklogItem.jsx';
import CompletedSection from './components/CompletedSection.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import Modal from './components/Modal.jsx';
import PlanningSettings from './components/PlanningSettings.jsx';
import QuickAdd from './components/QuickAdd.jsx';
import { EmptyState, LoadError, LoadingState, Notice } from './components/StatusViews.jsx';
import TaskForm from './components/TaskForm.jsx';
import TaskItem from './components/TaskItem.jsx';
import { AlertIcon, CheckCircleIcon, GearIcon, PlusIcon } from './components/icons.jsx';
import { usePlanner } from './hooks/usePlanner.js';
import { usePlanningSettings } from './hooks/usePlanningSettings.js';
import { formatLongDate, formatShortDate, formatTime } from './lib/dates.js';

const API_URL = import.meta.env.VITE_API_URL;

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Short, encouraging line under the progress bar. */
function progressMessage(done, total) {
  if (total === 0) return null;
  if (done === total) return 'Everything’s done for today. Great work.';
  if (done === 0) return 'A fresh start. Pick your first task.';
  if (done / total >= 0.5) return 'Over halfway there. Keep it up.';
  return 'Good start. Keep the momentum going.';
}

function DayProgress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="day-progress">
      <div className="day-progress-row">
        <p id="progress-label" className="day-progress-label">
          <strong>{done}</strong> of <strong>{total}</strong> {total === 1 ? 'task' : 'tasks'} completed
        </p>
        <p className="day-progress-pct" aria-hidden="true">
          {pct}%
        </p>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-labelledby="progress-label"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} tasks completed`}
      >
        <span className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="day-progress-msg">{progressMessage(done, total)}</p>
    </div>
  );
}

/**
 * Authentication gate. Signed-out visitors see Clerk's sign-in; signed-in
 * users see the planner exactly as before. The planner only mounts after
 * sign-in, so no task data is requested for signed-out visitors.
 *
 * Tasks are private per account. Keying the planner by user ID remounts it
 * (dropping all task state) whenever the signed-in account changes, so one
 * account's tasks are never shown while another's load.
 */
export default function App() {
  const { userId } = useAuth();
  return (
    <>
      <ClerkLoading>
        <main className="auth-screen">
          <p className="auth-status" role="status">
            Loading…
          </p>
        </main>
      </ClerkLoading>

      <ClerkLoaded>
        <Show when="signed-out">
          <main className="auth-screen">
            <div className="auth-intro">
              <h1>Daily Planner</h1>
              <p>Sign in to see your tasks.</p>
            </div>
            <SignIn />
          </main>
        </Show>
        <Show when="signed-in">
          <Planner key={userId} />
        </Show>
      </ClerkLoaded>

      <ClerkFailed>
        <main className="auth-screen">
          <div className="auth-card" role="alert">
            <h1>Couldn’t load sign-in</h1>
            <p>Check your internet connection and that the Clerk publishable key in client/.env.local is correct, then reload.</p>
          </div>
        </main>
      </ClerkFailed>
    </>
  );
}

/**
 * Attach the signed-in user's Clerk session token to every API request.
 * A layout effect runs before the planner's first data fetch (a passive effect).
 */
function useApiAuth() {
  const { getToken } = useAuth();
  useLayoutEffect(() => {
    setTokenProvider(() => getToken());
    return () => setTokenProvider(null);
  }, [getToken]);
}

/** The planner itself (unchanged), shown only to signed-in users. */
function Planner() {
  useApiAuth();
  const { today, data, load, retry, isPending, notice, notify, clearNotice, actions } = usePlanner();
  const planning = usePlanningSettings(today);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTitleId = useId();

  // Which dialog is open:
  //   { mode: 'create', initialValues?, onSaved? } | { mode: 'edit', task } | null
  const [form, setForm] = useState(null);
  const [taskToDelete, setTaskToDelete] = useState(null);
  const formTitleId = useId();
  // Where focus goes after a dialog closes if its trigger button is gone.
  const mainRef = useRef(null);

  // On phones the Add task button floats over the page. Tuck it away while
  // the Quick Add bar is on screen so it never covers the bar's buttons.
  const quickAddRef = useRef(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const hasData = Boolean(data);
  useEffect(() => {
    const el = quickAddRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setQuickAddVisible(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasData]);

  const openCreate = useCallback(() => setForm({ mode: 'create' }), []);
  const openEdit = useCallback((task) => setForm({ mode: 'edit', task }), []);
  // Quick Add → "Add details": open the full form pre-filled with the draft,
  // and let the bar clear itself only if the form is actually saved.
  const openDetails = useCallback(
    (draft, clearQuickAdd) => setForm({ mode: 'create', initialValues: draft, onSaved: clearQuickAdd }),
    [],
  );
  const closeForm = useCallback(() => setForm(null), []);

  // Keyboard shortcut: press "n" anywhere (outside a field) to add a task.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (form || taskToDelete || settingsOpen || isTyping(document.activeElement)) return;
      e.preventDefault();
      openCreate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, taskToDelete, settingsOpen, openCreate]);

  const handleSaveSettings = (values) => {
    const result = planning.save(values);
    if (result.errors) return result; // the panel shows them
    setSettingsOpen(false);
    if (result.storageError) {
      notify('error', 'Planning settings applied, but your browser blocked saving them on this device.');
    } else {
      notify('success', 'Planning settings saved');
    }
    return result;
  };

  const handleSave = async (payload) => {
    await actions.saveTask(payload, form.mode === 'edit' ? form.task : undefined);
    // Only reached if saving succeeded.
    form.onSaved?.();
    setForm(null);
  };

  const handleConfirmDelete = async () => {
    await actions.deleteTask(taskToDelete);
    setTaskToDelete(null);
  };

  const total = data ? data.open.length + data.completed.length : 0;
  const doneCount = data?.completed.length ?? 0;
  const backlogCount = data?.backlog.length ?? 0;

  const taskRow = (task) => (
    <TaskItem
      key={task.id}
      task={task}
      today={today}
      busy={isPending(task.id)}
      onToggle={actions.toggleComplete}
      onEdit={openEdit}
      onDelete={setTaskToDelete}
    />
  );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to tasks
      </a>

      <header className="app-header">
        <div className="app-header-inner">
          <div>
            <p className="eyebrow">{formatLongDate(today)}</p>
            <h1>Daily Planner</h1>
            <p className="planning-summary">
              Planning {planning.settings.planningDate === today ? 'today' : formatShortDate(planning.settings.planningDate)}
              {' · '}
              {formatTime(planning.settings.dayStart)} – {formatTime(planning.settings.dayEnd)}
              {planning.settings.preferDeepWorkBeforeNoon && ' · Deep focus before noon'}
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-ghost settings-btn" onClick={() => setSettingsOpen(true)}>
              <GearIcon width={17} height={17} />
              Planning settings
            </button>
            <button
              type="button"
              className={`btn btn-primary add-btn${quickAddVisible ? ' is-tucked' : ''}`}
              onClick={openCreate}
              aria-keyshortcuts="n"
            >
              <PlusIcon />
              Add task
            </button>
            {/* Clerk's account menu: profile, manage account, sign out */}
            <span className="user-button">
              <UserButton />
            </span>
          </div>
        </div>
      </header>

      <main id="main" className="shell" tabIndex={-1} ref={mainRef}>
        <Notice notice={notice} onDismiss={clearNotice} />

        {load.status === 'loading' && !data && <LoadingState />}
        {load.status === 'error' && !data && <LoadError error={load.error} onRetry={retry} />}

        {data && (
          // Source order = mobile order: Today first, Backlog second.
          // Above 900px the grid puts them side by side (≈68% / 32%).
          <div className="dashboard">
            <div className="col-today">
              {total > 0 && <DayProgress done={doneCount} total={total} />}

              <section className="card today-card" aria-labelledby="today-heading">
                <header className="card-header">
                  <h2 id="today-heading" className="card-title">
                    Today
                  </h2>
                  {data.open.length > 0 && (
                    <span className="badge badge-neutral">{plural(data.open.length, 'task', 'tasks')} to do</span>
                  )}
                </header>

                <div ref={quickAddRef} className="card-block">
                  <QuickAdd today={today} onAdd={actions.saveTask} onAddDetails={openDetails} />
                </div>

                {data.open.length > 0 ? (
                  <ul className="task-list" aria-label="Tasks to do">
                    {data.open.map(taskRow)}
                  </ul>
                ) : doneCount > 0 ? (
                  <div className="card-block">
                    <EmptyState
                      tone="success"
                      icon={<CheckCircleIcon />}
                      title="Everything for today is done."
                      hint="Nice work. Add another task if you have time left."
                    />
                  </div>
                ) : (
                  <div className="card-block">
                    <EmptyState
                      icon="📝"
                      title="No tasks scheduled yet."
                      hint="Add your first task to plan your day."
                      action={
                        <button type="button" className="btn btn-primary" onClick={openCreate}>
                          <PlusIcon />
                          Add your first task
                        </button>
                      }
                    />
                  </div>
                )}

                <CompletedSection count={doneCount}>
                  <ul className="task-list" aria-label="Completed tasks">
                    {data.completed.map(taskRow)}
                  </ul>
                </CompletedSection>
              </section>
            </div>

            <aside className="col-backlog" aria-label="Backlog">
              <section
                className={`card backlog-card${backlogCount === 0 ? ' is-clear' : ''}`}
                aria-labelledby="backlog-heading"
              >
                <header className="card-header backlog-header">
                  {backlogCount > 0 ? (
                    <p className="attention-label">
                      <AlertIcon width={14} height={14} />
                      Needs attention
                    </p>
                  ) : (
                    <p className="attention-label is-clear">
                      <CheckCircleIcon width={14} height={14} />
                      All clear
                    </p>
                  )}
                  <h2 id="backlog-heading" className="card-title">
                    Backlog from previous days
                  </h2>
                  {backlogCount > 0 && (
                    <p className="badge badge-amber">{plural(backlogCount, 'task', 'tasks')} to review</p>
                  )}
                </header>

                {backlogCount > 0 ? (
                  <ul className="backlog-list" aria-label="Tasks to review">
                    {data.backlog.map((task) => (
                      <BacklogItem
                        key={task.id}
                        task={task}
                        today={today}
                        busy={isPending(task.id)}
                        onScheduleToday={actions.scheduleToday}
                        onReschedule={actions.reschedule}
                        onDismiss={actions.dismiss}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="card-block">
                    <EmptyState
                      compact
                      tone="success"
                      icon={<CheckCircleIcon />}
                      title="No overdue tasks."
                      hint="You’re all caught up."
                    />
                  </div>
                )}
              </section>
            </aside>
          </div>
        )}
      </main>

      <Modal open={Boolean(form)} onClose={closeForm} labelledBy={formTitleId} returnFocusFallback={mainRef}>
        {form && (
          <TaskForm
            task={form.mode === 'edit' ? form.task : undefined}
            initialValues={form.initialValues}
            defaultDate={today}
            titleId={formTitleId}
            onSubmit={handleSave}
            onCancel={closeForm}
          />
        )}
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        labelledBy={settingsTitleId}
        returnFocusFallback={mainRef}
      >
        {settingsOpen && (
          <PlanningSettings
            settings={planning.settings}
            today={today}
            titleId={settingsTitleId}
            onSave={handleSaveSettings}
            onCancel={() => setSettingsOpen(false)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(taskToDelete)}
        title="Delete this task?"
        message={taskToDelete ? `“${taskToDelete.title}” will be permanently deleted.` : ''}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setTaskToDelete(null)}
        returnFocusFallback={mainRef}
      />
    </>
  );
}
