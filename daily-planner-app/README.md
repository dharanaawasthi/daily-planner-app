# Daily Planner

A personal daily task planner for **Study**, **Gym**, **Career** and **Personal** tasks.
React (Vite) frontend · Express 5 API · SQLite storage via `better-sqlite3`.

## Features

- **Dashboard layout** — above 900px, Today (≈68%) and the Backlog (≈32%) sit side by side;
  on smaller screens they stack, Today first.
- **Progress** — “X of Y tasks completed” with a thin green bar above Today.
- **Planning data on every task** — duration, priority, optional due date, fixed time,
  and the energy it needs (deep focus / normal / light), ready for AI-assisted planning.
- **Planning settings** — the date to plan, your day's start and end, and whether to prefer
  deep-focus work before noon. Saved on this device. (Schedule generation comes later.)
- **Today** — open tasks sorted by start time (untimed “Anytime” tasks last), with a
  progress bar. Tick the checkbox to complete a task.
- **Completed** — a collapsible section for today's finished tasks (untick to reopen).
  Open/closed is remembered.
- **Backlog from previous days** — open tasks scheduled before today, with
  *Schedule today*, *Pick date* and *Dismiss*.
- **Quick Add** — a one-line bar above Today: type a title, pick a category (the last one
  is remembered), optionally a start time, press Enter. **Add details** opens the full
  form pre-filled with what you typed.
- **Add / edit** — one modal form (native `<dialog>`) for title, category, date, optional start/end
  time and notes, with inline validation (client-side, plus the server's field errors).
  Focus starts on Title, Escape closes it, and focus returns to the button that opened it.
- **Delete** with a confirmation dialog.
- Loading skeleton, empty states, error banner and retry, success toasts.
- Keyboard friendly: native `<dialog>` focus handling, Escape to close, visible focus
  rings, skip link, and **`n`** opens the add form. Form fields have labels, and icon buttons
  have visible text.
- Responsive: on phones the add button floats in thumb reach and dialogs become bottom sheets.
- If the app stays open past midnight it rolls over to the new day automatically.

---

## Run it locally

**Requirements:** Node.js **20.19+** or **22.12+** (LTS) and npm.
Check with `node -v`.

```bash
# 1. Install everything (root, server and client — npm workspaces)
npm install

# 2. Start the API and the React app together
npm run dev
```

Then open **http://localhost:5173**.

- The API runs on **http://localhost:3001/api**; Vite forwards `/api/*` to it.
- On first start the database file `server/data/planner.db` is created and filled with
  sample tasks dated around today. Restarting does **not** re-seed.

### Other commands (run from the project root)

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restarts on change) + React dev server |
| `npm run dev:server` / `npm run dev:client` | Run just one side |
| `npm run seed` | **Wipe** the database and re-create the sample tasks relative to today |
| `npm test` | Run all tests: server (API, planning fields, migrations) and client (form + settings logic) |
| `npm run test:server` / `npm run test:client` | Run one side's tests |
| `npm run build` then `npm start` | Production: Express serves the built app and API on http://localhost:3001 |

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port |
| `DB_PATH` | `server/data/planner.db` | SQLite file location |
| `SEED_ON_EMPTY` | `true` | Set to `false` to start with an empty database |
| `API_PORT` | `3001` | (client) where Vite proxies `/api` in development |

### Troubleshooting

- **`better-sqlite3` fails to install** — it ships prebuilt binaries for current
  Node LTS versions on Windows, macOS and Linux. A compile error usually means an
  unsupported Node version: switch to the current LTS (e.g. with `nvm`) and run
  `npm install` again. Delete `node_modules` first if you changed Node versions.
- **Port in use** — `PORT=4000 API_PORT=4000 npm run dev` (macOS/Linux).
- **Start over** — `npm run seed`, or stop the server and delete `server/data/planner.db`.

---

## Project structure

```
daily-planner/
├── package.json              # npm workspaces + root scripts
├── server/
│   ├── package.json
│   ├── data/                 # planner.db lives here (git-ignored)
│   ├── scripts/seed.js       # npm run seed — reset to sample data
│   ├── src/
│   │   ├── index.js          # starts the server, seeds an empty DB
│   │   ├── app.js            # Express app: JSON, routes, errors, static client
│   │   ├── db/
│   │   │   ├── migrations/   # 001_initial.sql, 002_planning_fields.sql, …
│   │   │   ├── connection.js # opens SQLite, applies pending migrations
│   │   │   ├── taskRepository.js  # all task SQL
│   │   │   └── seed.js       # sample tasks relative to today
│   │   ├── routes/tasks.js   # /api/tasks endpoints
│   │   └── lib/              # dates, validation, HTTP errors
│   └── test/
│       ├── api.test.js             # end-to-end API tests (node:test)
│       ├── planning-fields.test.js # new planning fields: defaults, validation, rules
│       ├── migrations.test.js      # upgrading a v1 database keeps all data
│       └── helpers.js              # shared test server
└── client/
    ├── package.json
    ├── vite.config.js        # dev proxy /api -> :3001
    ├── index.html
    ├── test/                 # unit tests for form validation + planning settings
    └── src/
        ├── main.jsx
        ├── App.jsx           # page layout: header, backlog, to-do, completed, dialogs
        ├── api.js            # fetch wrapper for every endpoint
        ├── styles.css        # all styles (CSS custom properties, no UI library)
        ├── hooks/
        │   ├── usePlanner.js          # state, loading, all mutations + refresh
        │   └── usePlanningSettings.js # planning settings in localStorage
        ├── components/
        │   ├── TaskItem.jsx         # row: checkbox, time, title, edit/delete
        │   ├── BacklogItem.jsx      # row: schedule today / pick date / dismiss
        │   ├── CompletedSection.jsx # collapsible completed list
        │   ├── TaskForm.jsx         # the one add/edit form, with validation
        │   ├── QuickAdd.jsx         # one-line add bar + "Add details"
        │   ├── Modal.jsx            # native <dialog> wrapper: focus in, Escape, focus restore
        │   ├── ConfirmDialog.jsx    # delete confirmation
        │   ├── TaskMeta.jsx         # duration · priority · fixed · energy · due on rows
        │   ├── PlanningSettings.jsx # planning settings panel
        │   ├── CategoryChip.jsx     # category dot + label
        │   ├── StatusViews.jsx      # empty, loading, load error, notices
        │   └── icons.jsx
        └── lib/
            ├── categories.js # category names + colors
            ├── dates.js      # today, formatting, relative days
            ├── validateTask.js    # client-side form validation + defaults
            └── planningSettings.js # load/validate/save planning settings
```

---

## Data model

One table, `tasks`:

| Field | Type | Notes |
|---|---|---|
| `id` | integer | auto-increment |
| `title` | text | required, 1–200 chars |
| `category` | text | `Study` · `Gym` · `Career` · `Personal` (case-insensitive on input) |
| `scheduledDate` | text `YYYY-MM-DD` | required; defaults to today on create |
| `startTime` | text `HH:MM` or `null` | `null` = no scheduled time ("anytime") |
| `endTime` | text `HH:MM` or `null` | requires `startTime` and must be after it |
| `notes` | text | defaults to `""`, max 5,000 chars |
| `status` | text | `open` · `completed` · `dismissed` |
| `completedAt` | ISO timestamp or `null` | set by the server exactly when `status = completed` |
| `createdAt`, `updatedAt` | ISO timestamps | set by the server |
| `durationMinutes` | integer 5–480 | default `60` |
| `priority` | text | `low` · `medium` · `high`, default `medium` |
| `dueDate` | text `YYYY-MM-DD` or `null` | optional deadline |
| `isFixed` | boolean | default `false`; a fixed task can't be moved by a planner and **must have a start time** |
| `energy` | text or `null` | `deep` · `normal` · `light`; new tasks default to `normal`, `null` = not set |

### Migrations

The schema is versioned with SQLite's `user_version`. On start the server applies any
migration in `server/src/db/migrations/` newer than the database, each in its own
transaction (a failure leaves the database at its previous version). Existing data is kept:
upgrading to version 2 adds the planning fields, sets `durationMinutes` from each task's
existing start–end block (otherwise 60), and leaves `energy` as `null` (not set) for old
tasks. A database created by a newer app version is refused rather than modified.

### Planning settings (browser only)

Stored in `localStorage` under `planner.planningSettings.v1`: `planningDate`, `dayStart`,
`dayEnd` (at least an hour apart) and `preferDeepWorkBeforeNoon`. Unreadable or invalid
saved values fall back to defaults (today, 08:00–18:00, off), and a planning date that
has passed becomes today.

**Backlog is derived, not stored.** A task is in the backlog when
`status = 'open' AND scheduledDate < today`. The database rejects any other status.

**"Today" comes from the browser.** Endpoints that depend on the date accept
`?today=YYYY-MM-DD`, so the backlog follows your time zone rather than the server's.
Without it, the server's local date is used.

---

## API

All responses are JSON. Errors look like
`{ "error": "Validation failed", "details": { "endTime": "End time must be after the start time" } }`.

| Method & path | Purpose |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/tasks/today?today=` | `{ date, open: Task[], completed: Task[] }` — both sorted by start time, untimed tasks last |
| `GET /api/tasks/backlog?today=` | `{ today, tasks: Task[] }` — open tasks before today, oldest first |
| `GET /api/tasks?date=&from=&to=&status=&category=` | List with optional filters |
| `GET /api/tasks/:id` | One task |
| `POST /api/tasks?today=` | Create. Body: `title`, `category` required; others optional → `201` |
| `PATCH /api/tasks/:id` | Edit any fields. Read-only fields in the body are ignored |
| `DELETE /api/tasks/:id` | Delete → `204` |
| `POST /api/tasks/:id/reschedule?today=` | Body `{ "date": "YYYY-MM-DD" }` (today or later). Open tasks only |
| `POST /api/tasks/:id/dismiss` | Sets `status: dismissed`. Open tasks only |

How the UI actions map to the API:

| UI action | Request |
|---|---|
| Tick the checkbox | `PATCH /api/tasks/:id` `{ "status": "completed" }` (untick: `"open"`) |
| Backlog → Schedule for today | `POST /api/tasks/:id/reschedule?today=…` `{ "date": today }` |
| Backlog → Choose another date | `POST /api/tasks/:id/reschedule?today=…` `{ "date": "2026-10-20" }` |
| Backlog → Dismiss | `POST /api/tasks/:id/dismiss` |

Try it from a terminal while the server runs:

```bash
curl "http://localhost:3001/api/tasks/today"
curl "http://localhost:3001/api/tasks/backlog"
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Stretch","category":"Gym","startTime":"07:00","endTime":"07:20"}'
```

---

## Sample data

`npm run seed` (and the first start) creates 19 tasks dated relative to today:
8 for today (2 already completed, 2 without a time), 4 open tasks from earlier days
that appear in the backlog, 3 earlier tasks that are completed or dismissed and so
stay out of the backlog, and 4 upcoming tasks.

## Visual system

| Role | Color |
|---|---|
| Page background | `#F8FAFC` |
| Primary action (Add task, Save, Add) | blue `#2563EB` |
| Completion (checkbox, progress, success) | green `#16A34A`; completed rows pale green with ✓, “Done” tag and strikethrough |
| Backlog card | pale amber `#FFF7ED`, amber border, “Needs attention” label, “N tasks to review” badge |
| Delete (irreversible) | red — the only red action |

Status is never shown by color alone: completed rows carry a check and a “Done” tag,
overdue items say “Yesterday / 3 days ago” with a clock icon, and the selected category
in the form shows a check mark.

Colors and status indicators are designed with accessibility in mind; run an automated accessibility audit before claiming WCAG conformance.

## Category colors

Used only for the small dots in category chips and the category picker.

| Category | Color |
|---|---|
| Study | blue `#2563eb` |
| Gym | green `#16a34a` |
| Career | purple `#7c3aed` |
| Personal | orange `#ea580c` |

Defined in `client/src/lib/categories.js`.
