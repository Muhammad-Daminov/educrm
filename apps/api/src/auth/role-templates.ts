import type { PermissionScope } from '@prisma/client';

/**
 * Mirrors the permission catalog seeded in
 * prisma/migrations/20261008135152_auth/migration.sql (TZ 3.2). Keep both
 * in sync — there's no automated check tying them together (yet).
 */
export const ALL_PERMISSION_CODES = [
  'branch.view',
  'branch.create',
  'branch.update',
  'branch.archive',
  'classroom.manage',
  'employee.view',
  'employee.create',
  'employee.update',
  'employee.deactivate',
  'role.manage',
  'teacher.view_salary_settings',
  'teacher.edit_salary_settings',
  'inbound.view',
  'inbound.process',
  'inbound.archive',
  'inbound.purge',
  'lead.view',
  'lead.create',
  'lead.update',
  'lead.delete',
  'lead.view_contacts',
  'lead.bulk_action',
  'lead.change_owner',
  'student.view',
  'student.create',
  'student.update',
  'student.archive',
  'student.merge',
  'student.view_contacts',
  'student.view_passport',
  'student.export_personal_data',
  'study_unit.view',
  'study_unit.create',
  'study_unit.update',
  'study_unit.delete',
  'study_unit.change_status',
  'study_unit.manage_members',
  'waitlist.manage',
  'enrollment.freeze',
  'schedule.view',
  'schedule.create',
  'schedule.update',
  'schedule.delete',
  'lesson.cancel',
  'lesson.reschedule',
  'lesson.substitute_teacher',
  'lesson.complete',
  'attendance.view',
  'attendance.mark',
  'attendance.mark_past',
  'attendance.edit_locked',
  'price.view',
  'price.manage',
  'discount.manage',
  'finance.view_amounts',
  'invoice.view',
  'invoice.create',
  'invoice.update',
  'invoice.cancel',
  'payment.view',
  'payment.create',
  'payment.update',
  'payment.delete',
  'payment.refund',
  'installment.manage',
  'ledger.view',
  'ledger.adjust',
  'ledger.transfer',
  'payroll.view_own',
  'payroll.view_all',
  'payroll.calculate',
  'payroll.approve',
  'payroll.pay',
  'payroll.reopen',
  'report.finance',
  'report.sales',
  'report.load',
  'report.profitability',
  'report.manager',
  'report.retention',
  'message.send',
  'message.bulk_send',
  'template.manage',
  'automation.manage',
  'chat.view_all',
  'chat.reply',
  'import.run',
  'import.rollback',
  'export.run',
  'audit.view',
  'settings.manage',
  'api_key.manage',
] as const;

export interface RoleTemplate {
  code: string;
  name: string;
  permissions: { code: string; scope: PermissionScope }[];
}

/**
 * Platform-level permissions a branch_manager does NOT get, even though
 * TZ 3.1 describes their scope as "O'z filiali: to'liq" (full, within their
 * own branch) — these four are org-wide/owner-level concerns regardless of
 * branch (see docs/QUESTIONS.md for this and the other scope choices below;
 * TZ 3.1/3.2 describe role *intent*, not an exact permission×scope matrix).
 */
const BRANCH_MANAGER_EXCLUDED = new Set([
  'role.manage',
  'settings.manage',
  'api_key.manage',
  'audit.view',
]);

function allExcept(excluded: Set<string>, scope: PermissionScope): RoleTemplate['permissions'] {
  return ALL_PERMISSION_CODES.filter((code) => !excluded.has(code)).map((code) => ({
    code,
    scope,
  }));
}

function withScope(codes: string[], scope: PermissionScope): RoleTemplate['permissions'] {
  return codes.map((code) => ({ code, scope }));
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    code: 'owner',
    name: 'Owner',
    permissions: allExcept(new Set(), 'all'),
  },
  {
    code: 'branch_manager',
    name: 'Branch manager',
    permissions: allExcept(BRANCH_MANAGER_EXCLUDED, 'branch'),
  },
  {
    code: 'sales_manager',
    name: 'Sales manager',
    permissions: withScope(
      [
        'lead.view',
        'lead.create',
        'lead.update',
        'lead.delete',
        'lead.view_contacts',
        'lead.bulk_action',
        'lead.change_owner',
        'inbound.view',
        'inbound.process',
        'inbound.archive',
        'student.view',
        'schedule.view',
        'schedule.create',
        'report.sales',
      ],
      'branch',
    ),
  },
  {
    code: 'administrator',
    name: 'Administrator (reception)',
    permissions: withScope(
      [
        'branch.view',
        'schedule.view',
        'schedule.create',
        'schedule.update',
        'attendance.view',
        'attendance.mark',
        'payment.view',
        'payment.create',
        'invoice.view',
        'student.view',
      ],
      'branch',
    ),
  },
  {
    code: 'accountant',
    name: 'Accountant',
    permissions: withScope(
      [
        'finance.view_amounts',
        'price.view',
        'discount.manage',
        'invoice.view',
        'invoice.create',
        'invoice.update',
        'invoice.cancel',
        'payment.view',
        'payment.create',
        'payment.update',
        'payment.delete',
        'payment.refund',
        'installment.manage',
        'ledger.view',
        'ledger.adjust',
        'ledger.transfer',
        'payroll.view_all',
        'payroll.calculate',
        'payroll.approve',
        'payroll.pay',
        'payroll.reopen',
        'report.finance',
        'export.run',
        'import.run',
      ],
      'all',
    ),
  },
  {
    code: 'teacher',
    name: 'Teacher',
    permissions: withScope(
      ['schedule.view', 'attendance.view', 'attendance.mark', 'lesson.complete', 'payroll.view_own'],
      'own',
    ),
  },
];
