import { create } from 'zustand';

/**
 * Read-only surface. `?mode=view` hides editing for everyone, including the
 * project owner — that is the link meant for the cast. A hosted share
 * (`?share=`) is editable only by the Firebase account in editorUid, and
 * only from the link without `mode=view`. Firestore rules reject other writes.
 */
const urlViewLocked = new URLSearchParams(window.location.search).get('mode') === 'view';

interface ReadOnlyState {
  readOnly: boolean;
  setHostedReadOnly: (hostedReadOnly: boolean) => void;
}

export const useReadOnly = create<ReadOnlyState>((set) => ({
  readOnly: urlViewLocked,
  setHostedReadOnly: (hostedReadOnly) => set({ readOnly: urlViewLocked || hostedReadOnly }),
}));
