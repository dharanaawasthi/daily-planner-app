// All planner state and every API call the UI makes. Components receive
// plain data and action functions; none of them talk to the API directly.
//
// Every mutation is followed by a refresh of BOTH the day and the backlog,
// so the screen always reflects what the server actually stored.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { formatShortDate, todayISO } from '../lib/dates.js';

export function usePlanner() {
  const [today, setToday] = useState(() => todayISO());
  const [data, setData] = useState(null); // { open, completed, backlog }
  const [load, setLoad] = useState({ status: 'loading', error: null }); // loading | ready | error
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', message, id }

  const todayRef = useRef(today);
  todayRef.current = today;
  const requestSeq = useRef(0);
  const hasLoaded = useRef(false);

  const notify = useCallback((type, message) => {
    setNotice({ type, message, id: Date.now() + Math.random() });
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  // ── Loading ────────────────────────────────────────────────────────────
  // `quiet`: don't announce a refresh failure (used after a failed action,
  // whose own error message is the one the user needs to see).
  const refresh = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++requestSeq.current;
    const date = todayRef.current;
    try {
      const [day, backlog] = await Promise.all([api.getDay(date), api.getBacklog(date)]);
      if (seq !== requestSeq.current) return; // a newer refresh superseded this one
      setData({ open: day.open, completed: day.completed, backlog: backlog.tasks });
      setLoad({ status: 'ready', error: null });
      hasLoaded.current = true;
    } catch (error) {
      if (seq !== requestSeq.current) return;
      if (hasLoaded.current) {
        // Keep showing the last good data; just tell the user.
        if (!quiet) notify('error', `Couldn’t refresh your tasks. ${error.message}`);
      } else {
        setLoad({ status: 'error', error });
      }
    }
  }, [notify]);

  const retry = useCallback(() => {
    setLoad({ status: 'loading', error: null });
    refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [today, refresh]);

  // Count this day as a day the app was opened: on load, and again when the
  // day rolls over while the app stays open. The server keeps one per day.
  // Best-effort: a failure never affects the planner.
  useEffect(() => {
    api.logAppOpened(today).catch(() => {});
  }, [today]);

  // If the app stays open past midnight, roll over to the new day: yesterday's
  // open tasks then show up in the backlog without a manual reload.
  useEffect(() => {
    const check = () => {
      const now = todayISO();
      setToday((prev) => (prev === now ? prev : now));
    };
    const onVisible = () => document.visibilityState === 'visible' && check();
    const timer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────
  /**
   * Run one task action: mark the task busy, call the API, announce the
   * result, then refresh day + backlog whether it worked or not (a 404/409
   * means our copy was stale anyway). Resolves to true on success.
   */
  const mutate = useCallback(
    async (task, action, successMessage, failurePrefix) => {
      setPendingIds((ids) => new Set(ids).add(task.id));
      let ok = false;
      try {
        await action();
        ok = true;
        notify('success', successMessage);
      } catch (error) {
        notify('error', `${failurePrefix} ${error.message}`);
      } finally {
        await refresh({ quiet: !ok });
        setPendingIds((ids) => {
          const next = new Set(ids);
          next.delete(task.id);
          return next;
        });
      }
      return ok;
    },
    [notify, refresh],
  );

  const toggleComplete = useCallback(
    (task, done) =>
      mutate(
        task,
        () => api.setCompleted(task.id, done, todayRef.current),
        done ? `Completed “${task.title}”` : `Moved “${task.title}” back to your list`,
        done ? `Couldn’t complete “${task.title}”.` : `Couldn’t reopen “${task.title}”.`,
      ),
    [mutate],
  );

  const startTask = useCallback(
    (task) =>
      mutate(task, () => api.startTask(task.id, todayRef.current), 'Started. You’ve got this.', `Couldn’t start “${task.title}”.`),
    [mutate],
  );

  const deleteTask = useCallback(
    (task) =>
      mutate(task, () => api.deleteTask(task.id), `Deleted “${task.title}”`, `Couldn’t delete “${task.title}”.`),
    [mutate],
  );

  const scheduleToday = useCallback(
    (task) =>
      mutate(
        task,
        () => api.scheduleForToday(task.id, todayRef.current),
        `Scheduled “${task.title}” for today`,
        `Couldn’t schedule “${task.title}”.`,
      ),
    [mutate],
  );

  const reschedule = useCallback(
    (task, date) =>
      mutate(
        task,
        () => api.reschedule(task.id, date, todayRef.current),
        `Moved “${task.title}” to ${formatShortDate(date)}`,
        `Couldn’t move “${task.title}”.`,
      ),
    [mutate],
  );

  const dismiss = useCallback(
    (task) =>
      mutate(task, () => api.dismiss(task.id, todayRef.current), `Dismissed “${task.title}”`, `Couldn’t dismiss “${task.title}”.`),
    [mutate],
  );

  /**
   * Create or update from the task form. Errors are re-thrown so the form
   * can show field-level validation messages from the server.
   */
  const saveTask = useCallback(
    async (payload, existing) => {
      if (existing) await api.updateTask(existing.id, payload, todayRef.current);
      else await api.createTask(payload, todayRef.current);
      await refresh();
      notify('success', existing ? `Saved “${payload.title}”` : `Added “${payload.title}”`);
    },
    [notify, refresh],
  );

  return {
    today,
    data,
    load,
    retry,
    isPending: (id) => pendingIds.has(id),
    notice,
    notify,
    clearNotice,
    actions: { toggleComplete, startTask, deleteTask, scheduleToday, reschedule, dismiss, saveTask },
  };
}
