'use client';

import type { JSX } from 'react';
import { useAuth } from '@/components/auth-provider';
import { t } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MePage(): JSX.Element {
  const { me } = useAuth();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('me.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <strong>{me.user.fullName}</strong>
            {me.user.phone !== null && <span>{me.user.phone}</span>}
            {me.user.email !== null && <span>{me.user.email}</span>}
          </div>

          <section className="flex flex-col gap-2">
            <span className="font-medium">{t('me.roles')}</span>
            <div className="flex flex-wrap gap-2">
              {me.roles.map((role) => (
                <Badge key={role.code} variant="outline">
                  {role.name}
                </Badge>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <span className="font-medium">{t('me.branches')}</span>
            {me.branches.length === 0 ? (
              <span className="text-muted-foreground">{t('me.noBranches')}</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {me.branches.map((branch) => (
                  <Badge key={branch.id} variant="outline">
                    {branch.name}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <span className="font-medium">
              {t('me.permissions')} ({me.permissions.length})
            </span>
            <ul className="grid max-h-64 grid-cols-2 gap-x-4 overflow-y-auto font-mono text-xs">
              {me.permissions.map((permission) => (
                <li key={permission.code}>
                  {permission.code} <span className="text-muted-foreground">({permission.scope})</span>
                </li>
              ))}
            </ul>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
