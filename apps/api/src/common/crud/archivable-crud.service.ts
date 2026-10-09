import type { Prisma } from '@prisma/client';
import { diffOf, snapshotOf } from '../../audit/audit-diff';
import { Enveloped } from '../http/response-envelope';
import type { CrudDeps } from './crud.deps';
import type { ListQueryDto } from './list-query.dto';
import { notFound, rethrowAsDuplicate } from './crud.errors';
import { settleFailedUpdate } from './optimistic-lock';

/** Minimum shape the policy below needs from a row. */
export interface ArchivableRow {
  id: string;
  isActive: boolean;
  version: number;
}

/** The plain Prisma transaction client `tenantDb.transaction` hands over. */
export type Tx = Prisma.TransactionClient;

export interface Page<TRow> {
  rows: TRow[];
  total: number;
}

/**
 * The shared half of every T05 entity: archive-never-delete (TZ M1.1,
 * M1.3), optimistic locking (TZ 6.1), an audit row written inside the same
 * transaction as the change (TZ M11.3), and the TZ 6.2 list envelope with
 * `meta.total` for the UX P1 header count.
 *
 * Subclasses supply only the Prisma calls, which is where the per-entity
 * types live — `findPage`/`insert`/`patch` are implemented against the
 * concrete delegate (`tx.discipline`, `tx.classroom`, ...) and therefore
 * stay fully type-checked. Nothing here is generic over a Prisma delegate
 * on purpose: Prisma's delegate types are generic and overloaded, so a
 * structural "any delegate" interface only typechecks by widening args to
 * `unknown`, which throws away exactly the checking that matters.
 *
 * Every write goes through `tenantDb.transaction` because every write is
 * multi-statement once the audit row is counted (CLAUDE.md).
 */
export abstract class ArchivableCrudService<
  TRow extends ArchivableRow,
  TCreate,
  TUpdate,
  /**
   * The list query this entity accepts. Entities with a parent dimension
   * widen it (`branch_id`, `discipline_id`) — see ClassroomsService — and
   * the widened type is what both `list` and `findPage` speak, so the extra
   * filters stay type-checked end to end.
   */
  TQuery extends ListQueryDto = ListQueryDto,
> {
  protected constructor(protected readonly deps: CrudDeps) {}

  /** `resource` half of the audit action and of the error messages. */
  protected abstract readonly entityType: string;

  /** The field a duplicate-name conflict should be reported against. */
  protected readonly duplicateField: string = 'name';

  protected abstract findPage(query: TQuery): Promise<Page<TRow>>;

  protected abstract findOne(id: string): Promise<TRow | null>;

  /** Re-read inside a transaction, for read-then-write paths. */
  protected abstract findOneTx(tx: Tx, id: string): Promise<TRow | null>;

  protected abstract insert(tx: Tx, dto: TCreate): Promise<TRow>;

  /**
   * `UPDATE ... WHERE id = ? AND version = ?`, bumping `version`. Returns
   * the number of rows affected: 0 means the version did not match (or the
   * row is gone), which is the whole point of doing it in one statement.
   */
  protected abstract patch(tx: Tx, id: string, version: number, dto: TUpdate): Promise<number>;

  /** Same contract as `patch`, for the is_active flip. */
  protected abstract setActive(
    tx: Tx,
    id: string,
    version: number,
    isActive: boolean,
  ): Promise<number>;

  /**
   * Hook for validating foreign keys and secondary unique fields before an
   * insert or patch. `id` is the row being updated, and `undefined` on
   * create — a uniqueness check needs it to recognize the row re-sending
   * its own value.
   */
  protected async validateReferences(
    _dto: TCreate | TUpdate,
    _tx: Tx,
    _id?: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  /** Values to show in the audit diff. Overridden where a row has secrets. */
  protected auditSnapshot(row: TRow): Record<string, unknown> {
    return row as unknown as Record<string, unknown>;
  }

  async list(query: TQuery): Promise<Enveloped<TRow[]>> {
    const { rows, total } = await this.findPage(query);
    return new Enveloped(rows, { total, limit: query.limit, offset: query.offset });
  }

  async get(id: string): Promise<TRow> {
    const row = await this.findOne(id);
    if (row === null) {
      throw notFound(this.entityType, id);
    }
    return row;
  }

  async create(dto: TCreate): Promise<TRow> {
    try {
      return await this.deps.tenantDb.transaction(async (tx) => {
        await this.validateReferences(dto, tx);
        const row = await this.insert(tx, dto);
        await this.deps.audit.record(
          {
            action: `${this.entityType}.create`,
            entityType: this.entityType,
            entityId: row.id,
            diff: snapshotOf(this.auditSnapshot(row)),
          },
          tx,
        );
        return row;
      });
    } catch (error) {
      // The pre-check in validateReferences cannot cover a concurrent
      // create of the same name; the unique index decides, and this turns
      // its P2002 into the same field-level DUPLICATE_NAME the pre-check
      // would have produced.
      return rethrowAsDuplicate(error, this.entityType, this.duplicateField, describe(dto));
    }
  }

  /**
   * `expectedVersion` comes from `If-Match` (TZ 6.1). When the client did
   * not send one, the row's current version is used, which makes the update
   * unconditional — the header is accepted, not required.
   */
  async update(id: string, expectedVersion: number | undefined, dto: TUpdate): Promise<TRow> {
    try {
      return await this.deps.tenantDb.transaction(async (tx) => {
        const before = await this.findOneTx(tx, id);
        if (before === null) {
          throw notFound(this.entityType, id);
        }
        await this.validateReferences(dto, tx, id);

        const version = expectedVersion ?? before.version;
        const affected = await this.patch(tx, id, version, dto);
        if (affected === 0) {
          settleFailedUpdate(this.entityType, id, version, await this.findOneTx(tx, id), notFound);
        }

        const after = await this.findOneTx(tx, id);
        if (after === null) {
          throw notFound(this.entityType, id);
        }
        await this.deps.audit.record(
          {
            action: `${this.entityType}.update`,
            entityType: this.entityType,
            entityId: id,
            diff: diffOf(this.auditSnapshot(before), this.auditSnapshot(after)),
          },
          tx,
        );
        return after;
      });
    } catch (error) {
      return rethrowAsDuplicate(error, this.entityType, this.duplicateField, describe(dto));
    }
  }

  /**
   * TZ M1.1 / M1.3: archive, never delete. Historical lessons, charges and
   * payments point at these rows, so the row stays and `is_active` goes
   * false. Idempotent — archiving an archived row is a no-op that still
   * returns it, because a double-click must not 409.
   */
  archive(id: string, expectedVersion: number | undefined): Promise<TRow> {
    return this.flipActive(id, expectedVersion, false);
  }

  restore(id: string, expectedVersion: number | undefined): Promise<TRow> {
    return this.flipActive(id, expectedVersion, true);
  }

  private flipActive(
    id: string,
    expectedVersion: number | undefined,
    isActive: boolean,
  ): Promise<TRow> {
    return this.deps.tenantDb.transaction(async (tx) => {
      const before = await this.findOneTx(tx, id);
      if (before === null) {
        throw notFound(this.entityType, id);
      }
      if (before.isActive === isActive) {
        return before;
      }

      const version = expectedVersion ?? before.version;
      const affected = await this.setActive(tx, id, version, isActive);
      if (affected === 0) {
        settleFailedUpdate(this.entityType, id, version, await this.findOneTx(tx, id), notFound);
      }

      const after = await this.findOneTx(tx, id);
      if (after === null) {
        throw notFound(this.entityType, id);
      }
      await this.deps.audit.record(
        {
          action: `${this.entityType}.${isActive ? 'restore' : 'archive'}`,
          entityType: this.entityType,
          entityId: id,
          diff: diffOf(this.auditSnapshot(before), this.auditSnapshot(after)),
        },
        tx,
      );
      return after;
    });
  }
}

/**
 * Best-effort description of the offending value for a duplicate error. The
 * DTOs that can collide all carry a `name`.
 */
function describe(dto: unknown): string {
  if (typeof dto === 'object' && dto !== null && 'name' in dto) {
    const { name } = dto;
    if (typeof name === 'string') {
      return name;
    }
  }
  return '';
}
