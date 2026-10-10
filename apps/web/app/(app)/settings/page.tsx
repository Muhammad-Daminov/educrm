import type { JSX } from 'react';
import { t } from '@/lib/i18n';

export default function SettingsIndexPage(): JSX.Element {
  return (
    <div>
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('settings.intro')}</p>
    </div>
  );
}
