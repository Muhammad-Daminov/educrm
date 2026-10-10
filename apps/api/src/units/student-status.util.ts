import type { Tx } from '../common/crud/archivable-crud.service';

/**
 * BR-S3: `Student.status` is computed from its enrollments, not set
 * directly, once enrollments exist (T07). Must run inside the same
 * transaction as whatever enrollment write triggered it (CLAUDE.md) — see
 * every call site in `study-units.service.ts`.
 *
 * Precedence (this task's own call, not fully pinned down by the spec —
 * see docs/QUESTIONS.md): `active` > `frozen` > `finished` > `no_enrollment`.
 * A student with at least one `active` enrollment is `active` even if they
 * also hold a `frozen` one elsewhere; failing that, at least one `frozen`
 * enrollment makes them `frozen`; failing that, any enrollment at all
 * (finished/cancelled/transferred-away-with-nothing-active) makes them
 * `finished`; no enrollment ever recorded is `no_enrollment`.
 *
 * `archived` is excluded on purpose — BR-S3 says it "stays manual", so an
 * archived student is left alone regardless of what their enrollments say.
 */
export async function recomputeStudentStatus(tx: Tx, studentId: string): Promise<void> {
  const student = await tx.student.findUnique({ where: { id: studentId } });
  if (student === null || student.status === 'archived') {
    return;
  }

  const enrollments = await tx.enrollment.findMany({
    where: { studentId },
    select: { status: true },
  });

  const next: 'active' | 'frozen' | 'finished' | 'no_enrollment' = enrollments.some(
    (e) => e.status === 'active',
  )
    ? 'active'
    : enrollments.some((e) => e.status === 'frozen')
      ? 'frozen'
      : enrollments.length > 0
        ? 'finished'
        : 'no_enrollment';

  if (next !== student.status) {
    await tx.student.update({
      where: { id: studentId },
      data: { status: next, version: { increment: 1 } },
    });
  }
}
