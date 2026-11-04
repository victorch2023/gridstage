import { useEffect } from 'react';
import { useEditor } from '../state/store';
import { takeSpacePan } from '../state/stageView';
import { useReadOnly } from '../state/viewMode';

const SPACE_TAP_MS = 400;

const NUDGE_M = 0.1;
const NUDGE_BIG_M = 1;
const ROTATE_STEP_DEG = 15;

/**
 * Global editor hotkeys: arrows nudge (Shift = 1m), [ ] rotate ±15°,
 * A short Space tap toggles play. Holding Space grabs the plan instead.
 * Delete/Backspace removes the selection (performers if
 * any are selected, else the formation), Escape deselects,
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo, Ctrl+C/V copy-paste positions,
 * Ctrl+A selects everyone, Ctrl+D duplicates the formation.
 * Ignored while typing in a form control.
 */
export function useAppHotkeys(togglePlay: () => void): void {
  useEffect(() => {
    let spaceArmed = false;
    let spaceDownAt = 0;

    function onKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && !spaceArmed) {
          spaceArmed = true;
          spaceDownAt = Date.now();
        }
        if (useReadOnly.getState().readOnly) return;
      }

      const s = useEditor.getState();

      // Viewers can play/pause but not edit.
      if (useReadOnly.getState().readOnly) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            break;
          case 'y':
            e.preventDefault();
            s.redo();
            break;
          case 'c':
            e.preventDefault();
            s.copyPositions();
            break;
          case 'v':
            e.preventDefault();
            s.pastePositions();
            break;
          case 'a':
            e.preventDefault();
            s.setPerformerSelection(s.performers.map((p) => p.id));
            break;
          case 'd':
            e.preventDefault();
            s.duplicateFormation();
            break;
          default:
            break;
        }
        return;
      }

      const step = e.shiftKey ? NUDGE_BIG_M : NUDGE_M;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          s.nudgeSelected(-step, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          s.nudgeSelected(step, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          s.nudgeSelected(0, -step);
          break;
        case 'ArrowDown':
          e.preventDefault();
          s.nudgeSelected(0, step);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteSelection();
          break;
        case 'Escape':
          s.clearPerformerSelection();
          break;
        case '[':
          s.rotateSelected(-ROTATE_STEP_DEG);
          break;
        case ']':
          s.rotateSelected(ROTATE_STEP_DEG);
          break;
        default:
          break;
      }
    }

    function onKeyUp(e: KeyboardEvent): void {
      if (e.key !== ' ' || !spaceArmed) return;
      spaceArmed = false;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (takeSpacePan()) return;
      if (Date.now() - spaceDownAt > SPACE_TAP_MS) return;
      togglePlay();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [togglePlay]);
}
