import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { RequestContext } from '../../common/context/request-context';
import { AuditAction, AuditEntity } from './audit.constants';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

// Every whitelisted column, as selected when ?fields= is absent
const ALL_FIELDS_SELECT = {
  id: true,
  actorId: true,
  action: true,
  entity: true,
  entityId: true,
  changes: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  requestId: true,
  createdAt: true,
};

const buildQuery = (overrides: Partial<ListAuditLogsQueryDto> = {}) =>
  Object.assign(new ListAuditLogsQueryDto(), overrides);

describe('AuditService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;

  let repository: jest.Mocked<AuditRepository>;
  let service: AuditService;

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(undefined),
      findPage: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      deleteOlderThan: jest.fn().mockResolvedValue(7),
    } as unknown as jest.Mocked<AuditRepository>;

    service = new AuditService(repository);
  });

  describe('log', () => {
    it('writes the entry with the IP, user agent and request id of the current request, in the given transaction', async () => {
      await RequestContext.run(
        {
          requestId: 'req-1',
          ipAddress: '203.0.113.7',
          userAgent: 'Mozilla/5.0 (jest)',
        },
        () =>
          service.log(
            {
              action: AuditAction.USER_PASSWORD_CHANGED,
              entity: AuditEntity.USER,
              entityId: 'user-1',
              actorId: 'user-1',
              changes: { role: { from: 'CUSTOMER', to: 'ADMIN' } },
              metadata: { method: 'password' },
            },
            tx,
          ),
      );

      expect(repository.create).toHaveBeenCalledWith(
        {
          action: 'user.password_changed',
          entity: 'user',
          entityId: 'user-1',
          actorId: 'user-1',
          changes: { role: { from: 'CUSTOMER', to: 'ADMIN' } },
          metadata: { method: 'password' },
          ipAddress: '203.0.113.7',
          userAgent: 'Mozilla/5.0 (jest)',
          requestId: 'req-1',
        },
        tx,
      );
    });

    it('stores null for a missing actor and entity id (anonymous actions)', async () => {
      await service.log({
        action: AuditAction.SESSION_REUSE_DETECTED,
        entity: AuditEntity.SESSION,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: null, entityId: null }),
        undefined,
      );
    });

    it('keeps an explicit null actor', async () => {
      await service.log({
        action: AuditAction.SESSION_REUSE_DETECTED,
        entity: AuditEntity.SESSION,
        entityId: 'family-1',
        actorId: null,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: null, entityId: 'family-1' }),
        undefined,
      );
    });

    it('leaves the request fields empty outside a request (scheduled jobs)', async () => {
      await service.log({
        action: AuditAction.USER_LOGIN_FAILED,
        entity: AuditEntity.USER,
        entityId: 'user-1',
      });

      const [data] = repository.create.mock.calls[0];
      expect(data.ipAddress).toBeUndefined();
      expect(data.userAgent).toBeUndefined();
      expect(data.requestId).toBeUndefined();
    });

    it('propagates a failed write so the surrounding transaction rolls back', async () => {
      const error = new Error('insert failed');
      repository.create.mockRejectedValue(error);

      await expect(
        service.log(
          { action: AuditAction.USER_REGISTERED, entity: AuditEntity.USER },
          tx,
        ),
      ).rejects.toBe(error);
    });
  });

  describe('list', () => {
    it('returns the first page of all entries, newest first, with every whitelisted field', async () => {
      const page = { items: [{ id: 'log-1' }], total: 1 };
      repository.findPage.mockResolvedValue(page as never);

      await expect(service.list(buildQuery())).resolves.toBe(page);
      expect(repository.findPage).toHaveBeenCalledWith({
        where: {
          action: undefined,
          actorId: undefined,
          entity: undefined,
          entityId: undefined,
          createdAt: undefined,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: ALL_FIELDS_SELECT,
        skip: 0,
        take: 20,
      });
    });

    it('filters by action, actor, entity and entity id exactly', async () => {
      await service.list(
        buildQuery({
          action: 'user.password_changed',
          actorId: 'user-1',
          entity: 'user',
          entityId: 'user-2',
        }),
      );

      expect(repository.findPage.mock.calls[0][0].where).toMatchObject({
        action: 'user.password_changed',
        actorId: 'user-1',
        entity: 'user',
        entityId: 'user-2',
      });
    });

    it.each<[string, { createdFrom?: Date; createdTo?: Date }]>([
      [
        'both bounds',
        {
          createdFrom: new Date('2026-01-01'),
          createdTo: new Date('2026-12-31'),
        },
      ],
      ['only a start', { createdFrom: new Date('2026-01-01') }],
      ['only an end', { createdTo: new Date('2026-12-31') }],
    ])('filters by a date range with %s', async (_case, range) => {
      await service.list(buildQuery(range));

      expect(repository.findPage.mock.calls[0][0].where.createdAt).toEqual({
        gte: range.createdFrom,
        lte: range.createdTo,
      });
    });

    it('sorts by createdAt with an id tiebreaker', async () => {
      await service.list(buildQuery({ sort: 'createdAt' }));

      expect(repository.findPage.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('selects only the requested fields, always with the id', async () => {
      await service.list(buildQuery({ fields: 'action,createdAt' }));

      expect(repository.findPage.mock.calls[0][0].select).toEqual({
        id: true,
        action: true,
        createdAt: true,
      });
    });

    it('pages with skip and take', async () => {
      await service.list(buildQuery({ page: 3, limit: 10 }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it.each([
      ['an unknown sort field', { sort: 'ipAddress' }],
      [
        'sorting by action (would scan a whole action group)',
        { sort: 'action' },
      ],
      ['an unknown field', { fields: 'action,password' }],
    ])(
      'returns 400 INVALID_QUERY_PARAM for %s without querying',
      async (_case, query) => {
        const call = service.list(buildQuery(query));

        await expect(call).rejects.toBeInstanceOf(BadRequestException);
        await expect(call).rejects.toMatchObject({
          response: expect.objectContaining({
            errorCode: ErrorCode.INVALID_QUERY_PARAM,
          }),
        });
        expect(repository.findPage).not.toHaveBeenCalled();
      },
    );
  });

  describe('purgeExpired', () => {
    it('deletes entries older than the retention period and returns the count', async () => {
      jest.useFakeTimers({ now: new Date('2027-01-01T00:00:00.000Z') });
      try {
        await expect(service.purgeExpired()).resolves.toBe(7);

        expect(repository.deleteOlderThan).toHaveBeenCalledWith(
          new Date('2026-01-01T00:00:00.000Z'),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
