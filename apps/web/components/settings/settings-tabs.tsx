'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { t, type TranslationKey } from '@/lib/i18n';

const TABS: readonly { href: string; labelKey: TranslationKey }[] = [
  { href: '/settings/disciplines', labelKey: 'settings.nav.disciplines' },
  { href: '/settings/levels', labelKey: 'settings.nav.levels' },
  { href: '/settings/age-categories', labelKey: 'settings.nav.ageCategories' },
  { href: '/settings/payment-methods', labelKey: 'settings.nav.paymentMethods' },
  { href: '/settings/holidays', labelKey: 'settings.nav.holidays' },
];

/**
 * TZ M1.3 reference data lives under one `/settings` section rather than
 * five sidebar entries — `nav.ts` gates the section once on
 * `settings.manage`, and these tabs are the entity switch inside it.
 */
export function SettingsTabs(): JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label={t('settings.title')} className="flex flex-wrap gap-1 border-b border-border pb-2">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
            aria-current={active ? 'page' : undefined}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
