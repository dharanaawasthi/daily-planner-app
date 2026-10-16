import { useId } from 'react';
import CategoryChip from './CategoryChip.jsx';
import Modal from './Modal.jsx';
import TaskMeta from './TaskMeta.jsx';
import { TimeRange } from './TaskItem.jsx';
import { CloseIcon, PencilIcon, TrashIcon } from './icons.jsx';

/**
 * Task details, opened by tapping a row (a bottom sheet on phones).
 * Edit and Delete hand off to the existing TaskForm and ConfirmDialog.
 */
export default function TaskSheet({ task, today, onEdit, onDelete, onClose, returnFocusFallback }) {
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

          <footer className="modal-footer">
            <button type="button" className="btn btn-quiet btn-delete sheet-delete" onClick={() => onDelete(task)}>
              <TrashIcon width={16} height={16} />
              Delete
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} data-autofocus>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onEdit(task)}>
              <PencilIcon width={16} height={16} />
              Edit
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
