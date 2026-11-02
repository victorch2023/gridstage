import type { ReactElement } from 'react';
import { useT } from '../i18n';

/** Frequent colors kept beside every color picker. */
const SWATCHES = [
  { id: 'red', value: '#e53935' },
  { id: 'black', value: '#000000' },
  { id: 'yellow', value: '#fbc02d' },
  { id: 'fuchsia', value: '#ff00ff' },
] as const;

/**
 * The system color picker, with red, black, yellow, and fuchsia one click away.
 */
export function ColorField({
  id,
  value,
  title,
  onChange,
}: {
  id: string;
  value: string;
  title?: string;
  onChange: (color: string) => void;
}): ReactElement {
  const t = useT();
  const current = value.toLowerCase();
  return (
    <div className="color-field">
      <input
        id={id}
        type="color"
        title={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {SWATCHES.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          className="color-swatch"
          aria-label={t.colors[swatch.id]}
          title={t.colors[swatch.id]}
          aria-pressed={current === swatch.value}
          style={{ background: swatch.value }}
          onClick={() => onChange(swatch.value)}
        />
      ))}
    </div>
  );
}
