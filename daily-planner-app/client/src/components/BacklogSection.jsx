// Open tasks from previous days. Desktop: a card in its own column (or below
// Today on narrower desktops). Phones: a collapsible section below Today,
// collapsed by default, so the screen opens on today's work.
import { useEffect, useId, useState } from 'react';
import BacklogItem from './BacklogItem.jsx';
import { EmptyState } from './StatusViews.jsx';
import { AlertIcon, CheckCircleIcon, ChevronIcon } from './icons.jsx';

const MOBILE_QUERY = '(max-width: 900px)';

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function BacklogSection({ tasks, today, isPending, actions }) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = tasks.length;

  const content =
    count > 0 ? (
      <ul className="backlog-list" aria-label="Tasks to review">
        {tasks.map((task) => (
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
        <EmptyState compact tone="success" icon={<CheckCircleIcon />} title="No overdue tasks." hint="You’re all caught up." />
      </div>
    );

  if (isMobile) {
    return (
      <section className="card backlog-card backlog-collapsible" aria-labelledby={`${panelId}-heading`}>
        <h2 id={`${panelId}-heading`} className="backlog-toggle-heading">
          <button
            type="button"
            className="collapse-btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronIcon className="collapse-chevron" />
            From previous days
            {count > 0 ? (
              <span className="badge badge-amber">{plural(count, 'task', 'tasks')} to review</span>
            ) : (
              <span className="collapse-hint">All clear</span>
            )}
          </button>
        </h2>
        <div id={panelId} hidden={!open}>
          {content}
        </div>
      </section>
    );
  }

  return (
    <section className={`card backlog-card${count === 0 ? ' is-clear' : ''}`} aria-labelledby={`${panelId}-heading`}>
      <header className="card-header backlog-header">
        {count > 0 ? (
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
        <h2 id={`${panelId}-heading`} className="card-title">
          Backlog from previous days
        </h2>
        {count > 0 && <p className="badge badge-amber">{plural(count, 'task', 'tasks')} to review</p>}
      </header>
      {content}
    </section>
  );
}
