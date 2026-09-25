import { Prisma, UserRole } from '@prisma/client';
import { PublicUser, UserWithPassword } from './interfaces/user.interface';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const NOW = new Date('2026-09-25T10:00:00.000Z');

const buildUser = (overrides: Partial<PublicUser> = {}): PublicUser => ({
  id: 'user-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  avatar: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  isEmailVerified: false,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('UsersService', () => {
  const tx = { tx: true } as unknown as Prisma.TransactionClient;

  let repository: jest.Mocked<UsersRepository>;
  let service: UsersService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findWithPasswordByEmail: jest.fn(),
      findWithPasswordById: jest.fn(),
      lockForUpdate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    service = new UsersService(repository);
  });

  describe('reads', () => {
    it('finds a user by id, inside the given transaction', async () => {
      const user = buildUser();
      repository.findById.mockResolvedValue(user);

      await expect(service.findById('user-1', tx)).resolves.toBe(user);
      expect(repository.findById).toHaveBeenCalledWith('user-1', tx);
    });

    it('finds a user by id outside any transaction', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('user-1')).resolves.toBeNull();
      expect(repository.findById).toHaveBeenCalledWith('user-1', undefined);
    });

    it('finds a user by email', async () => {
      repository.findByEmail.mockResolvedValue(null);

      await expect(service.findByEmail('jane@example.com')).resolves.toBeNull();
      expect(repository.findByEmail).toHaveBeenCalledWith('jane@example.com');
    });

    it('finds a user with the password hash by email', async () => {
      const record: UserWithPassword = { ...buildUser(), password: 'hash' };
      repository.findWithPasswordByEmail.mockResolvedValue(record);

      await expect(
        service.findWithPasswordByEmail('jane@example.com'),
      ).resolves.toBe(record);
      expect(repository.findWithPasswordByEmail).toHaveBeenCalledWith(
        'jane@example.com',
      );
    });

    it('finds a user with the password hash by id, inside the given transaction', async () => {
      const record: UserWithPassword = { ...buildUser(), password: 'hash' };
      repository.findWithPasswordById.mockResolvedValue(record);

      await expect(service.findWithPasswordById('user-1', tx)).resolves.toBe(
        record,
      );
      expect(repository.findWithPasswordById).toHaveBeenCalledWith(
        'user-1',
        tx,
      );
    });
  });

  describe('lockForUpdate', () => {
    it.each([true, false])(
      'locks the user row in the given transaction and reports whether it exists (%p)',
      async (found) => {
        repository.lockForUpdate.mockResolvedValue(found);

        await expect(service.lockForUpdate('user-1', tx)).resolves.toBe(found);
        expect(repository.lockForUpdate).toHaveBeenCalledWith('user-1', tx);
      },
    );
  });

  describe('create', () => {
    it('stores the password hash in the password column within the given transaction', async () => {
      const user = buildUser();
      repository.create.mockResolvedValue(user);

      await expect(
        service.create(
          {
            email: 'jane@example.com',
            passwordHash: 'bcrypt-hash',
            firstName: 'Jane',
            lastName: 'Doe',
          },
          tx,
        ),
      ).resolves.toBe(user);
      expect(repository.create).toHaveBeenCalledWith(
        {
          email: 'jane@example.com',
          password: 'bcrypt-hash',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        tx,
      );
    });

    it('leaves optional names unset and works without a transaction', async () => {
      repository.create.mockResolvedValue(
        buildUser({ firstName: null, lastName: null }),
      );

      await service.create({
        email: 'jane@example.com',
        passwordHash: 'bcrypt-hash',
      });
      expect(repository.create).toHaveBeenCalledWith(
        {
          email: 'jane@example.com',
          password: 'bcrypt-hash',
          firstName: undefined,
          lastName: undefined,
        },
        undefined,
      );
    });
  });

  describe('updates', () => {
    beforeEach(() => repository.update.mockResolvedValue(buildUser()));

    it('sets a new password hash within the given transaction', async () => {
      await service.setPassword('user-1', 'new-hash', tx);

      expect(repository.update).toHaveBeenCalledWith(
        'user-1',
        { password: 'new-hash' },
        tx,
      );
    });

    it('marks the email verified within the given transaction', async () => {
      await service.markEmailVerified('user-1', tx);

      expect(repository.update).toHaveBeenCalledWith(
        'user-1',
        { isEmailVerified: true },
        tx,
      );
    });

    it('records the login time within the given transaction and returns the updated user', async () => {
      jest.useFakeTimers({ now: NOW });
      const updated = buildUser({ lastLoginAt: NOW });
      repository.update.mockResolvedValue(updated);

      try {
        await expect(service.recordLogin('user-1', tx)).resolves.toBe(updated);
        expect(repository.update).toHaveBeenCalledWith(
          'user-1',
          { lastLoginAt: NOW },
          tx,
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
