import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersRepository } from './users.repository';

// Every column except the password hash
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatar: true,
  role: true,
  isActive: true,
  isEmailVerified: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

const buildClient = () => ({
  user: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'user-1' }),
    update: jest.fn().mockResolvedValue({ id: 'user-1' }),
  },
  $queryRaw: jest.fn(),
});

describe('UsersRepository', () => {
  let prisma: ReturnType<typeof buildClient>;
  let tx: ReturnType<typeof buildClient>;
  let repository: UsersRepository;

  const asTx = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    prisma = buildClient();
    tx = buildClient();
    repository = new UsersRepository(prisma as unknown as PrismaService);
  });

  describe('public reads', () => {
    it('finds by id without selecting the password hash', async () => {
      await repository.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: PUBLIC_USER_SELECT,
      });
      expect(prisma.user.findUnique.mock.calls[0][0].select).not.toHaveProperty(
        'password',
      );
    });

    it('finds by email without selecting the password hash', async () => {
      await repository.findByEmail('jane@example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane@example.com' },
        select: PUBLIC_USER_SELECT,
      });
    });

    it('uses the transaction client when one is given', async () => {
      await repository.findById('user-1', asTx());
      await repository.findByEmail('jane@example.com', asTx());

      expect(tx.user.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('credential reads', () => {
    it('selects the password hash in findWithPasswordByEmail', async () => {
      await repository.findWithPasswordByEmail('jane@example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane@example.com' },
        select: { ...PUBLIC_USER_SELECT, password: true },
      });
    });

    it('selects the password hash in findWithPasswordById', async () => {
      await repository.findWithPasswordById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { ...PUBLIC_USER_SELECT, password: true },
      });
    });

    it('reads the hash through the transaction client when one is given', async () => {
      await repository.findWithPasswordByEmail('jane@example.com', asTx());
      await repository.findWithPasswordById('user-1', asTx());

      expect(tx.user.findUnique).toHaveBeenNthCalledWith(1, {
        where: { email: 'jane@example.com' },
        select: { ...PUBLIC_USER_SELECT, password: true },
      });
      expect(tx.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: 'user-1' },
        select: { ...PUBLIC_USER_SELECT, password: true },
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('lockForUpdate', () => {
    it('locks the user row with SELECT ... FOR UPDATE, passing the id as a bound parameter', async () => {
      tx.$queryRaw.mockResolvedValue([{ id: 'user-1' }]);

      await expect(repository.lockForUpdate('user-1', asTx())).resolves.toBe(
        true,
      );

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(strings.join('?').replace(/\s+/g, ' ').trim()).toBe(
        'SELECT "id" FROM "users" WHERE "id" = ? FOR UPDATE',
      );
      expect(values).toEqual(['user-1']);
    });

    it('returns false when the user does not exist', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(repository.lockForUpdate('missing', asTx())).resolves.toBe(
        false,
      );
    });
  });

  describe('writes', () => {
    const data = { email: 'jane@example.com', password: 'bcrypt-hash' };

    it('creates a user and returns it without the password hash', async () => {
      await expect(repository.create(data)).resolves.toEqual({ id: 'user-1' });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data,
        select: PUBLIC_USER_SELECT,
      });
    });

    it('creates within the given transaction', async () => {
      await repository.create(data, asTx());

      expect(tx.user.create).toHaveBeenCalledWith({
        data,
        select: PUBLIC_USER_SELECT,
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('updates by id and returns the user without the password hash', async () => {
      await repository.update('user-1', { isEmailVerified: true });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isEmailVerified: true },
        select: PUBLIC_USER_SELECT,
      });
    });

    it('updates within the given transaction', async () => {
      await repository.update('user-1', { password: 'new-hash' }, asTx());

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { password: 'new-hash' },
        select: PUBLIC_USER_SELECT,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
