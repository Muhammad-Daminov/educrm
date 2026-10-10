'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/states/empty-state';
import { ErrorState } from '@/components/states/error-state';
import { LoadingState } from '@/components/states/loading-state';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/toast-provider';
import { StudentContactDrawer } from '@/components/students/student-contact-drawer';
import { StudentEditDrawer } from '@/components/students/student-edit-drawer';
import { t, type TranslationKey } from '@/lib/i18n';
import { ApiError } from '@/lib/api';
import { hasAnyPermission } from '@/lib/nav';
import {
  archiveStudent,
  deleteContactPerson,
  fetchStudent,
  restoreStudent,
  type ContactPersonRow,
  type StudentRow,
} from '@/lib/students';

type TabKey = 'overview' | 'finance' | 'schedule' | 'documents' | 'history';

const TABS: { key: TabKey; labelKey: TranslationKey }[] = [
  { key: 'overview', labelKey: 'students.tab.overview' },
  { key: 'finance', labelKey: 'students.tab.finance' },
  { key: 'schedule', labelKey: 'students.tab.schedule' },
  { key: 'documents', labelKey: 'students.tab.documents' },
  { key: 'history', labelKey: 'students.tab.history' },
];

function statusVariant(status: StudentRow['status']): 'success' | 'outline' | 'default' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'archived') {
    return 'outline';
  }
  return 'default';
}

/**
 * UX P2 "Obyekt kartochkasi". Only the Umumiy tab has real content in R0:
 * Moliya/Jadval va davomat/Hujjatlar need ledger, schedule and document
 * generation (T08–T11), none of which exist yet — they render the same
 * "keyingi bosqichda" placeholder the shell's unbuilt sections use
 * (`app/(app)/[...slug]/page.tsx`), rather than a fake empty table.
 */
export function StudentCard({ studentId }: { studentId: string }): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me } = useAuth();
  const { showToast } = useToast();

  const [student, setStudent] = useState<StudentRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [contactDrawer, setContactDrawer] = useState<
    { mode: 'create' } | { mode: 'update'; row: ContactPersonRow } | null
  >(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStudent(studentId)
      .then((row) => {
        if (!cancelled) {
          setStudent(row);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, reloadToken]);

  const tab = (searchParams.get('tab') as TabKey | null) ?? 'overview';
  function setTab(next: TabKey): void {
    const query = next === 'overview' ? '' : `?tab=${next}`;
    router.replace(`/students/${studentId}${query}`, { scroll: false });
  }

  const canUpdate = hasAnyPermission(me.permissions, ['student.update']);
  const canArchive = hasAnyPermission(me.permissions, ['student.archive']);

  async function toggleArchive(): Promise<void> {
    if (student === null) {
      return;
    }
    try {
      const updated =
        student.status === 'archived'
          ? await restoreStudent(student.id, student.version)
          : await archiveStudent(student.id, student.version);
      setStudent(updated);
      showToast({ message: t('toast.saved'), variant: 'success' });
    } catch (caught) {
      showToast({
        message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
        variant: 'error',
      });
      reload();
    }
  }

  async function removeContact(contact: ContactPersonRow): Promise<void> {
    if (!window.confirm(t('students.contacts.delete.confirm'))) {
      return;
    }
    try {
      await deleteContactPerson(studentId, contact.id);
      reload();
    } catch (caught) {
      showToast({
        message: caught instanceof ApiError ? caught.body.message : t('form.error.unknown'),
        variant: 'error',
      });
    }
  }

  if (loading) {
    return <LoadingState rows={6} />;
  }
  if (error !== null) {
    return <ErrorState error={error} onRetry={reload} />;
  }
  if (student === null) {
    return <ErrorState error={null} onRetry={reload} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/students" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('students.back')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{student.fullName}</h1>
          <Badge variant={statusVariant(student.status)}>{t(`students.status.${student.status}`)}</Badge>
        </div>
        <div className="flex gap-2">
          {canUpdate && (
            <Button onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('list.edit')}
            </Button>
          )}
          {canArchive && (
            <Button
              variant={student.status === 'archived' ? 'secondary' : 'danger'}
              onClick={() => void toggleArchive()}
            >
              {student.status === 'archived' ? t('list.restore') : t('list.archive')}
            </Button>
          )}
        </div>
      </div>

      {/* Stat row (UX P2): balance is the one number this phase actually
       * carries — the rest (attendance %, active groups, churn) depend on
       * T08/T09/T07/analytics and aren't faked here. */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">{t('students.column.balance')}</p>
          <p className="text-lg font-semibold">{student.cachedBalance}</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === item.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab(item.key)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">{t('students.field.branch')}</h2>
            <p className="text-sm">{student.branchId}</p>
          </section>

          {student.phones !== undefined && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{t('students.phones.title')}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {student.phones.map((phone) => (
                  <li key={phone.id}>
                    {phone.phone}
                    {phone.isPrimary && (
                      <Badge className="ml-2" variant="outline">
                        {t('students.field.phone')}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {student.contactPersons !== undefined && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('students.contacts.title')}</h2>
                {canUpdate && (
                  <Button size="sm" onClick={() => setContactDrawer({ mode: 'create' })}>
                    <Plus className="size-4" aria-hidden="true" />
                    {t('students.contacts.add')}
                  </Button>
                )}
              </div>
              {student.contactPersons.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('students.contacts.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {student.contactPersons.map((contact) => (
                    <li
                      key={contact.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {contact.fullName} <span className="text-muted-foreground">({contact.relation})</span>
                        </p>
                        <p className="text-muted-foreground">
                          {[contact.phone, contact.email].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {canUpdate && (
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => setContactDrawer({ mode: 'update', row: contact })}>
                            {t('list.edit')}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => void removeContact(contact)}>
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      ) : (
        <EmptyState title={t('state.placeholder.title')} description={t('students.notComingYet')} />
      )}

      {editOpen && (
        <StudentEditDrawer
          student={student}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setEditOpen(false);
            setStudent(updated);
          }}
        />
      )}

      {contactDrawer !== null && (
        <StudentContactDrawer
          studentId={studentId}
          contact={contactDrawer.mode === 'update' ? contactDrawer.row : undefined}
          onClose={() => setContactDrawer(null)}
          onSaved={() => {
            setContactDrawer(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
