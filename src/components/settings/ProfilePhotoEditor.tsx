interface ProfilePhotoEditorProps {
  currentUrl: string;
  initials: string;
  onClose: () => void;
  onChooseFile: () => void;
  onRemove: () => void;
  onUseInitials: () => void;
}

/** Local-only photo actions: choose image, remove, or use initials. */
export function ProfilePhotoEditor({
  currentUrl,
  initials,
  onClose,
  onChooseFile,
  onRemove,
  onUseInitials,
}: ProfilePhotoEditorProps) {
  return (
    <div className="profile-photo-backdrop" role="presentation" onClick={onClose}>
      <div
        className="profile-photo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Profile photo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-photo-preview" aria-hidden="true">
          {currentUrl ? <img src={currentUrl} alt="" /> : <span>{initials}</span>}
        </div>
        <p className="profile-photo-hint">
          Photos stay on this device. Nothing is uploaded.
        </p>
        <div className="profile-photo-actions">
          <button type="button" className="btn" onClick={onChooseFile}>
            Choose image
          </button>
          <button type="button" className="btn" onClick={onUseInitials}>
            Use initials
          </button>
          {currentUrl ? (
            <button type="button" className="btn btn-danger" onClick={onRemove}>
              Remove image
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
