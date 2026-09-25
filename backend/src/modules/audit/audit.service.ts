import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../../common/context/request-context';
import { buildSelect, parseSort } from '../../common/query';
import {
  AUDIT_DEFAULT_SORT,
  AUDIT_FIELDS,
  AUDIT_INCLUDABLE,
  AUDIT_RETENTION_DAYS,
  AUDIT_SORTABLE,
} from './audit.constants';
import { AuditRepository } from './audit.repository';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

export interface AuditEntry {
  // A constant: AuditAction for core actions, `<Module>AuditAction` in the
  // module's constants for its own (`article.created`, ...)
  action: string;
  entity: string;
  entityId?: string | null;
  // null for anonymous actions
  actorId?: string | null;
  // Changed fields only, secrets removed: { field: { from, to } }
  changes?: Prisma.InputJsonObject;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AuditService {
  constructor(private readonly auditRepository: AuditRepository) {}

  // Pass the transaction of the change being recorded, so the entry and the
  // change commit (or roll back) together. IP, user agent and request id come
  // from the current request.
  log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const request = RequestContext.current();
    return this.auditRepository.create(
      {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        actorId: entry.actorId ?? null,
        changes: entry.changes,
        metadata: entry.metadata,
        ipAddress: request?.ipAddress,
        userAgent: request?.userAgent,
        requestId: request?.requestId,
      },
      tx,
    );
  }

  async list(query: ListAuditLogsQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      action: query.action,
      actorId: query.actorId,
      entity: query.entity,
      entityId: query.entityId,
      createdAt:
        query.createdFrom || query.createdTo
          ? { gte: query.createdFrom, lte: query.createdTo }
          : undefined,
    };

    return this.auditRepository.findPage({
      where,
      orderBy: parseSort(query.sort, AUDIT_SORTABLE, AUDIT_DEFAULT_SORT),
      select: buildSelect<Prisma.AuditLogSelect>(query, {
        fields: AUDIT_FIELDS,
        includable: AUDIT_INCLUDABLE,
      }),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  // Retention, run by AuditRetentionTask. Returns how many entries it removed.
  purgeExpired(): Promise<number> {
    const day = 24 * 60 * 60 * 1000;
    return this.auditRepository.deleteOlderThan(
      new Date(Date.now() - AUDIT_RETENTION_DAYS * day),
    );
  }
}
