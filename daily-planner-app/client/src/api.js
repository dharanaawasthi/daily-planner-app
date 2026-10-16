// Thin wrapper around the Express API. Every function returns parsed JSON
// (or null for 204 responses) and throws an Error with .status / .details
// when the server rejects a request.
//
// The browser decides what "today" is and passes it along, so the backlog
// rule (status = open AND scheduledDate < today) follows the user's time zone,
// not the server's.

//
// Every request carries the signed-in user's Clerk session token
// (Authorization: Bearer …); the API answers 401 without one.

const UNREACHABLE = 'Couldn’t reach the server. Check that it’s running and try again.';
const API_URL = import.meta.env.VITE_API_URL;

let getToken = async () => null;

/** Called once signed in with Clerk's getToken (fresh, short-lived tokens). */
export function setTokenProvider(provider) {
  getToken = provider ?? (async () => null);
}

async function request(path, { method = 'GET', body } = {}) {
  // If Clerk can't produce a token, send none; the API then answers 401.
  const token = await getToken().catch(() => null);
  const headers = {
    ...(body !== undefined && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
  
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error(UNREACHABLE); // network failure: no response at all
    error.status = 0;
    throw error;
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Prefer the API's own message; fall back to a plain-language one.
    const fallback = res.status >= 500 ? UNREACHABLE : `Request failed (${res.status})`;
    const error = new Error(data?.error ?? fallback);
    error.status = res.status;
    error.details = data?.details;
    throw error;
  }
  return data;
}

const q = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request('/health'),

  /** { date, open: Task[], completed: Task[] } — both sorted by start time */
  getDay: (date) => request(`/tasks/today${q({ today: date })}`),

  /** { today, tasks: Task[] } — open tasks scheduled before today */
  getBacklog: (today) => request(`/tasks/backlog${q({ today })}`),

  listTasks: (filters = {}) => request(`/tasks${q(filters)}`),
  getTask: (id) => request(`/tasks/${id}`),

  /** `today` is used as the scheduledDate when the task doesn't set one. */
  createTask: (task, today) =>
    request(`/tasks${q({ today })}`, { method: 'POST', body: task }),
  updateTask: (id, changes) => request(`/tasks/${id}`, { method: 'PATCH', body: changes }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),

  /** Checkbox: completed <-> open (server stamps / clears completedAt) */
  setCompleted: (id, done) =>
    request(`/tasks/${id}`, { method: 'PATCH', body: { status: done ? 'completed' : 'open' } }),

  // Backlog actions
  scheduleForToday: (id, today) =>
    request(`/tasks/${id}/reschedule${q({ today })}`, { method: 'POST', body: { date: today } }),
  reschedule: (id, date, today) =>
    request(`/tasks/${id}/reschedule${q({ today })}`, { method: 'POST', body: { date } }),
  dismiss: (id) => request(`/tasks/${id}/dismiss`, { method: 'POST' }),
};
