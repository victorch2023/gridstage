import { create } from 'zustand';

/**
 * Read-only surface. `?mode=view` is a UI convenience for a live room.
 * A hosted share (`?share=`) sets the same flag for everyone except the
 * Firebase account that published it. Firestore rules are what actually
 * reject a reader's writes.
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
