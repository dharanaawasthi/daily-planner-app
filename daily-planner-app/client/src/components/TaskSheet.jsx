import { useId } from 'react';
import CategoryChip from './CategoryChip.jsx';
import Modal from './Modal.jsx';
import TaskMeta from './TaskMeta.jsx';
import { InProgressLabel, TimeRange } from './TaskItem.jsx';
import { CloseIcon, PencilIcon, PlayIcon, TrashIcon } from './icons.jsx';

/**
 * Task details, opened by tapping a row (a bottom sheet on phones).
 * Start is the one main action for an open task; a started task says
 * "In progress" instead. Edit and Delete hand off to the existing TaskForm
 * and ConfirmDialog.
 */
export default function TaskSheet({ task, today, onStart, onEdit, onDelete, onClose, returnFocusFallback }) {
  const titleId = useId();
  return (
    <Modal open={Boolean(task)} onClose={onClose} labelledBy={titleId} returnFocusFallback={returnFocusFallback}>
      {task && (
        <>
          <header className="modal-header">
            <h2 id={titleId} className="sheet-title">
              {task.title}
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <CloseIcon />
            </button>
          </header>

          <div className="modal-body sheet-body">
            <p className="sheet-when">
              <TimeRange task={task} />
              {task.status === 'completed' && <span className="sheet-done">· Done</span>}
            </p>
            <p className="task-tags">
              <CategoryChip category={task.category} />
              <TaskMeta task={task} today={today} />
            </p>
            {task.notes && <p className="sheet-notes">{task.notes}</p>}
          </div>

          <footer className="modal-footer sheet-footer">
            <button type="button" className="btn btn-quiet btn-delete sheet-delete" onClick={() => onDelete(task)}>
              <TrashIcon width={16} height={16} />
              Delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} data-autofocus>
              Close
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onEdit(task)}>
              <PencilIcon width={16} height={16} />
              Edit
            </button>
            {task.status === 'open' && (
              <button type="button" className="btn btn-primary sheet-start" onClick={() => onStart(task)}>
                <PlayIcon width={16} height={16} />
                Start
              </button>
            )}
            {task.status === 'started' && <InProgressLabel className="sheet-start sheet-in-progress" />}
          </footer>
        </>
      )}
    </Modal>
  );
}
