import { UserRole } from '@prisma/client';
import { UserResponseDto } from './user-response.dto';

describe('UserResponseDto.from', () => {
  const createdAt = new Date('2026-09-01T00:00:00.000Z');
  const lastLoginAt = new Date('2026-09-25T10:00:00.000Z');

  const publicUser = {
    id: 'user-1',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    avatar: null,
    role: UserRole.CUSTOMER,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt,
    createdAt,
    updatedAt: createdAt,
  };

  it('maps exactly the documented fields', () => {
    expect(UserResponseDto.from(publicUser)).toStrictEqual({
      id: 'user-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      avatar: null,
      role: UserRole.CUSTOMER,
      isActive: true,
      isEmailVerified: true,
      lastLoginAt,
      createdAt,
    });
  });

  it('drops the password hash and any column that is not explicitly mapped', () => {
    // A record that carries more than PublicUser, e.g. a future column or a
    // query that selected the hash by mistake
    const record = {
      ...publicUser,
      password: 'bcrypt-hash',
      internalNotes: 'secret',
    };

    const dto = UserResponseDto.from(record);

    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('internalNotes');
    expect(dto).not.toHaveProperty('updatedAt');
  });
});
