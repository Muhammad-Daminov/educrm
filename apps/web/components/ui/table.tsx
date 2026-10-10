import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Table primitives for the UX P1 result grid: sticky header, and the whole
 * thing scrolls inside its own container so a wide table never stretches
 * the shell.
 */
export function TableContainer({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('max-h-[calc(100vh-18rem)] overflow-auto rounded-lg border', className)}
      {...props}
    />
  );
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-10 border-b bg-muted/60 px-3 py-2 text-left font-medium backdrop-blur',
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return <td className={cn('border-b px-3 py-2 align-middle', className)} {...props} />;
}

export function Tr({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>): React.JSX.Element {
  return <tr className={cn('hover:bg-muted/40', className)} {...props} />;
}
