import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  normalizeEmail,
  trimString,
} from '../../../common/helpers/transform.helpers';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  OTP_LENGTH,
  OTP_PATTERN,
} from '../auth.constants';

// Policy for passwords a user chooses (register, reset, change)
function IsStrongPassword(example: string) {
  return applyDecorators(
    ApiProperty({
      example,
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      description:
        'At least one lowercase letter, one uppercase letter and one digit',
    }),
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(PASSWORD_PATTERN, {
      message:
        'password must contain at least one lowercase letter, one uppercase letter and one digit',
    }),
  );
}

// A password the user already has (login, verify-email, current password): no
// strength rules, so accounts created under older rules keep working
function IsExistingPassword() {
  return applyDecorators(
    ApiProperty({ example: 'Passw0rd!', maxLength: PASSWORD_MAX_LENGTH }),
    IsString(),
    IsNotEmpty(),
    MaxLength(PASSWORD_MAX_LENGTH),
  );
}

export class EmailDto {
  @ApiProperty({ example: 'jane@example.com', maxLength: 254 })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class LoginDto extends EmailDto {
  @IsExistingPassword()
  password: string;
}

export class RegisterDto extends EmailDto {
  @IsStrongPassword('Passw0rd!')
  password: string;

  @ApiPropertyOptional({ example: 'Jane', maxLength: 100 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', maxLength: 100 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  lastName?: string;
}

export class OtpCodeDto extends EmailDto {
  @ApiProperty({ example: '123456', pattern: OTP_PATTERN.source })
  @IsString()
  @Matches(OTP_PATTERN, { message: `otpCode must be ${OTP_LENGTH} digits` })
  otpCode: string;
}

export class ResetPasswordDto extends OtpCodeDto {
  @IsStrongPassword('NewPassw0rd!')
  newPassword: string;
}

export class ChangePasswordDto {
  @IsExistingPassword()
  currentPassword: string;

  @IsStrongPassword('NewPassw0rd!')
  newPassword: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  refreshToken: string;
}

// One DTO per operation, so each can evolve on its own
export class ResendVerificationDto extends EmailDto {}
export class ForgotPasswordDto extends EmailDto {}
export class SendOtpDto extends EmailDto {}
// The password proves the verifier is the registrant (see AuthService.verifyEmail)
export class VerifyEmailDto extends OtpCodeDto {
  @IsExistingPassword()
  password: string;
}
export class VerifyOtpDto extends OtpCodeDto {}
export class LogoutDto extends RefreshTokenDto {}
