import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PublicUser } from '../interfaces/user.interface';

export class UserResponseDto {
  @ApiProperty({ example: 'cmufs79e80009o4gpupls7i3y' })
  id: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;

  @ApiProperty({ nullable: true, type: String, example: 'Jane' })
  firstName: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Doe' })
  lastName: string | null;

  @ApiProperty({ nullable: true, type: String, example: null })
  avatar: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.CUSTOMER })
  role: UserRole;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: false })
  isEmailVerified: boolean;

  @ApiProperty({
    nullable: true,
    type: Date,
    example: '2026-01-01T08:30:00.000Z',
  })
  lastLoginAt: Date | null;

  @ApiProperty({ example: '2026-01-01T08:00:00.000Z' })
  createdAt: Date;

  // Explicit mapping: new columns stay private until they're added here
  static from(user: PublicUser): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
