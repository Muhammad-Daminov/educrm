import * as React from 'react';
import { cn } from '@/lib/utils';

const BASE =
  'w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** `aria-invalid` drives the error styling, so the two can never disagree. */
function invalidClass(invalid: boolean | undefined): string {
  return invalid === true ? 'border-destructive' : 'border-input';
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(BASE, invalidClass(props['aria-invalid'] === true), className)}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={props.rows ?? 3}
      className={cn(BASE, invalidClass(props['aria-invalid'] === true), className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(BASE, invalidClass(props['aria-invalid'] === true), 'pr-8', className)}
      {...props}
    />
  );
});
