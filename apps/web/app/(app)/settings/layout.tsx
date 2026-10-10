import type { JSX, ReactNode } from 'react';
import { SettingsTabs } from '@/components/settings/settings-tabs';

export default function SettingsLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SettingsTabs />
      {children}
    </div>
  );
}
