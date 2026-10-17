import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ClerkFailed, ClerkLoaded, ClerkLoading, Show, SignIn, useAuth } from '@clerk/react';
import { setTokenProvider } from './api.js';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import MeView from './components/MeView.jsx';
import Modal from './components/Modal.jsx';
import NowView from './components/NowView.jsx';
import PlanningSettings from './components/PlanningSettings.jsx';
import SectionNav, { useHashSection } from './components/SectionNav.jsx';
import { LoadError, LoadingState, Notice } from './components/StatusViews.jsx';
import TaskForm from './components/TaskForm.jsx';
import TaskSheet from './components/TaskSheet.jsx';
import { PlusIcon } from './components/icons.jsx';
import { usePlanner } from './hooks/usePlanner.js';
import { usePlanningSettings } from './hooks/usePlanningSettings.js';
import { formatLongDate } from './lib/dates.js';

const API_URL = import.meta.env.VITE_API_URL;

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

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
              <h1>Todzy</h1>
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

/** The planner itself, shown only to signed-in users. */
function Planner() {
  useApiAuth();
  const { today, data, load, retry, isPending, notice, notify, clearNotice, actions } = usePlanner();
  const planning = usePlanningSettings(today);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTitleId = useId();
  const [section, selectSection] = useHashSection();

  // Which dialog is open:
  //   { mode: 'create', initialValues?, onSaved? } | { mode: 'edit', task } | null
  const [form, setForm] = useState(null);
  const [taskToDelete, setTaskToDelete] = useState(null);
  // The task shown in the details sheet, by id so it always reflects fresh data.
  const [sheetTaskId, setSheetTaskId] = useState(null);
  const formTitleId = useId();
  // Where focus goes after a dialog closes if its trigger button is gone.
  const mainRef = useRef(null);
  const nowHeadingRef = useRef(null);
  const meHeadingRef = useRef(null);

  // On phones the round Add task button floats above the tab bar. Tuck it away
  // while the Quick Add bar is on screen so it never covers the bar's buttons.
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
  // Quick Add → "Add details": open the full form pre-filled with the draft,
  // and let the bar clear itself only if the form is actually saved.
  const openDetails = useCallback(
    (draft, clearQuickAdd) => setForm({ mode: 'create', initialValues: draft, onSaved: clearQuickAdd }),
    [],
  );
  const closeForm = useCallback(() => setForm(null), []);
  const openSheet = useCallback((task) => setSheetTaskId(task.id), []);
  const closeSheet = useCallback(() => setSheetTaskId(null), []);

  // Edit / Delete from the sheet: the sheet closes in the same render. Its
  // Modal is rendered before the form and confirm dialogs, so it closes first
  // (focus returns to the row) and the next dialog then returns focus there too.
  const editFromSheet = useCallback((task) => {
    setSheetTaskId(null);
    setForm({ mode: 'edit', task });
  }, []);
  const deleteFromSheet = useCallback((task) => {
    setSheetTaskId(null);
    setTaskToDelete(task);
  }, []);
  // Start from the sheet: close it (focus returns to the row), then start;
  // the toast confirms it.
  const { startTask } = actions;
  const startFromSheet = useCallback(
    (task) => {
      setSheetTaskId(null);
      startTask(task);
    },
    [startTask],
  );

  const sheetTask = sheetTaskId && data ? [...data.open, ...data.completed].find((t) => t.id === sheetTaskId) : null;
  // The task left Today (deleted elsewhere, midnight rollover): close the sheet.
  useEffect(() => {
    if (sheetTaskId && data && !sheetTask) setSheetTaskId(null);
  }, [sheetTaskId, data, sheetTask]);

  const goToSection = (id) => {
    if (id === section) return;
    selectSection(id);
    // Move focus to the new section's heading once it is shown.
    requestAnimationFrame(() => {
      const heading = id === 'me' ? meHeadingRef.current : nowHeadingRef.current;
      (heading ?? mainRef.current)?.focus();
    });
  };

  // Keyboard shortcut: press "n" anywhere (outside a field) to add a task.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (form || taskToDelete || settingsOpen || sheetTaskId || isTyping(document.activeElement)) return;
      e.preventDefault();
      openCreate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, taskToDelete, settingsOpen, sheetTaskId, openCreate]);

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

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // The hash holds the section (#now / #me), so focus main directly.
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to main content
      </a>

      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <h1>Todzy</h1>
            <p className="eyebrow">{formatLongDate(today)}</p>
          </div>
          <div className="header-chips">
            {/* Reserved for two future chips: Todzy points and Love tokens.
                Intentionally empty for now. */}
          </div>
        </div>
      </header>

      <div className="app-frame">
        <SectionNav active={section} onSelect={goToSection} />

        <main id="main" className="shell" tabIndex={-1} ref={mainRef}>
          <Notice notice={notice} onDismiss={clearNotice} />

          <div hidden={section !== 'now'}>
            {load.status === 'loading' && !data && <LoadingState />}
            {load.status === 'error' && !data && <LoadError error={load.error} onRetry={retry} />}
            {data && (
              <NowView
                data={data}
                today={today}
                isPending={isPending}
                actions={actions}
                onAddTask={openCreate}
                onAddDetails={openDetails}
                onOpenTask={openSheet}
                quickAddRef={quickAddRef}
                headingRef={nowHeadingRef}
              />
            )}
          </div>

          <div hidden={section !== 'me'}>
            <MeView
              settings={planning.settings}
              today={today}
              onOpenSettings={() => setSettingsOpen(true)}
              headingRef={meHeadingRef}
            />
          </div>
        </main>
      </div>

      {/* Phones only: round Add task button above the tab bar, on Now. */}
      {section === 'now' && (
        <button
          type="button"
          className={`fab${quickAddVisible ? ' is-tucked' : ''}`}
          onClick={openCreate}
          aria-label="Add task"
          aria-keyshortcuts="n"
        >
          <PlusIcon width={24} height={24} />
        </button>
      )}

      {/* Must stay before the form and confirm dialogs (see editFromSheet). */}
      <TaskSheet
        task={sheetTask}
        today={today}
        onStart={startFromSheet}
        onEdit={editFromSheet}
        onDelete={deleteFromSheet}
        onClose={closeSheet}
        returnFocusFallback={mainRef}
      />

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
