import type { JSX, ReactNode } from 'react';

/**
 * One labelled form row, with its error message wired to the control via
 * `aria-describedby` (UX §8.6 / WCAG 2.1 AA) and the message placed right
 * under the input — UX P6: "server xatolari field boʻyicha mos maydonga".
 */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}): JSX.Element {
  const describedBy = [error !== undefined ? `${id}-error` : null, hint !== undefined ? `${id}-hint` : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required === true && (
          <span aria-hidden="true" className="ml-1 text-destructive">
            *
          </span>
        )}
      </label>
      <div aria-describedby={describedBy === '' ? undefined : describedBy}>{children}</div>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
