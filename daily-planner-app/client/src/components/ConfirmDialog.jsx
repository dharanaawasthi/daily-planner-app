import { useId, useState } from 'react';
import Modal from './Modal.jsx';

/** Yes/no confirmation. `onConfirm` may return a promise; the button shows progress. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  returnFocusFallback,
}) {
  const uid = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy={`${uid}-title`}
      describedBy={`${uid}-msg`}
      size="sm"
      returnFocusFallback={returnFocusFallback}
    >
      <ConfirmBody
        uid={uid}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}

function ConfirmBody({ uid, title, message, confirmLabel, onConfirm, onCancel }) {
  const [working, setWorking] = useState(false);
  return (
    <>
      <div className="modal-body confirm-body">
        <h2 id={`${uid}-title`}>{title}</h2>
        <p id={`${uid}-msg`}>{message}</p>
      </div>
      <footer className="modal-footer">
        {/* Cancel gets focus first: the safe choice for a destructive action. */}
        <button type="button" className="btn btn-ghost" onClick={onCancel} data-autofocus>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={working}
          onClick={async () => {
            setWorking(true);
            await onConfirm();
          }}
        >
          {working ? 'Deleting…' : confirmLabel}
        </button>
      </footer>
    </>
  );
}
