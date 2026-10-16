// Now: today's progress, Quick Add, the Today list, Completed and the backlog.
import BacklogSection from './BacklogSection.jsx';
import CompletedSection from './CompletedSection.jsx';
import QuickAdd from './QuickAdd.jsx';
import { EmptyState } from './StatusViews.jsx';
import TaskItem from './TaskItem.jsx';
import { CheckCircleIcon, PlusIcon } from './icons.jsx';

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

export default function NowView({
  data,
  today,
  isPending,
  actions,
  onAddTask,
  onAddDetails,
  onOpenTask,
  quickAddRef,
  headingRef,
}) {
  const total = data.open.length + data.completed.length;
  const doneCount = data.completed.length;

  const taskRow = (task) => (
    <TaskItem key={task.id} task={task} busy={isPending(task.id)} onToggle={actions.toggleComplete} onOpen={onOpenTask} />
  );

  return (
    <>
      {/* Desktop only; phones use the round + button above the tab bar. */}
      <div className="now-toolbar">
        <button type="button" className="btn btn-secondary" onClick={onAddTask} aria-keyshortcuts="n">
          <PlusIcon />
          Add task
        </button>
      </div>

      {total > 0 && <DayProgress done={doneCount} total={total} />}

      {/* Source order = mobile order: Today first, backlog second.
          From 1200px the grid puts them side by side (≈68% / 32%). */}
      <div className="dashboard">
        <div className="col-today">
          <section className="card today-card" aria-labelledby="today-heading">
            <header className="card-header">
              <h2 id="today-heading" className="card-title" ref={headingRef} tabIndex={-1}>
                Today
              </h2>
              {data.open.length > 0 && (
                <span className="badge badge-neutral">{plural(data.open.length, 'task', 'tasks')} to do</span>
              )}
            </header>

            <div ref={quickAddRef} className="card-block">
              <QuickAdd today={today} onAdd={actions.saveTask} onAddDetails={onAddDetails} />
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
                    <button type="button" className="btn btn-primary" onClick={onAddTask}>
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
          <BacklogSection tasks={data.backlog} today={today} isPending={isPending} actions={actions} />
        </aside>
      </div>
    </>
  );
}
