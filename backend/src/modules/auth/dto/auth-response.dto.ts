import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { AuthSession, AuthTokens } from '../interfaces/auth.interface';

export class AuthTokensResponseDto {
  @ApiProperty({
    description: 'Bearer token for API calls (short-lived)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjbXUuLi4ifQ.sig',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Exchange at POST /auth/refresh-token; single use, rotated',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoicmVmcmVzaCJ9.sig',
  })
  refreshToken: string;

  static from(tokens: AuthTokens): AuthTokensResponseDto {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }
}

export class AuthSessionResponseDto extends AuthTokensResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  static from(session: AuthSession): AuthSessionResponseDto {
    return {
      ...AuthTokensResponseDto.from(session),
      user: UserResponseDto.from(session.user),
    };
  }
}
