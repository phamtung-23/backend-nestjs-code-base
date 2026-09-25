import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientMetaParam } from '../../common/decorators/client-meta.decorator';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator';
import { ResponseHelper } from '../../common/helpers/response.helper';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ClientMeta } from '../../common/interfaces/client-meta.interface';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { PublicUser } from '../users/interfaces/user.interface';
import { AuthErrorCode, AuthMessage } from './auth.constants';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RegistrationService } from './registration.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { RateLimit } from './decorators/rate-limit.decorator';
import {
  AuthSessionResponseDto,
  AuthTokensResponseDto,
} from './dto/auth-response.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyEmailDto,
  VerifyOtpDto,
} from './dto/auth.dto';

const ONE_MINUTE = 60_000;

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
    private readonly passwordService: PasswordService,
  ) {}

  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Send an Idempotency-Key to retry safely: a retry replays the first response instead of answering 409.',
  })
  @ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.CREATED })
  @ApiErrorResponse(400, 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_INVALID')
  @ApiErrorResponse(
    409,
    AuthErrorCode.EMAIL_TAKEN,
    'IDEMPOTENCY_KEY_IN_PROGRESS',
  )
  @ApiErrorResponse(422, 'IDEMPOTENCY_KEY_REUSED')
  @ApiErrorResponse(503, 'SERVICE_UNAVAILABLE')
  @Public()
  @RateLimit(5, ONE_MINUTE)
  @Idempotent()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const user = await this.registrationService.register(dto);
    return ResponseHelper.success(
      UserResponseDto.from(user),
      AuthMessage.REGISTERED,
    );
  }

  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiEnvelopeResponse(AuthSessionResponseDto)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @ApiErrorResponse(401, AuthErrorCode.INVALID_CREDENTIALS)
  @ApiErrorResponse(
    403,
    AuthErrorCode.EMAIL_NOT_VERIFIED,
    AuthErrorCode.ACCOUNT_DISABLED,
  )
  @Public()
  @RateLimit(5, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @ClientMetaParam() client: ClientMeta) {
    const session = await this.authService.login(dto, client);
    return ResponseHelper.success(
      AuthSessionResponseDto.from(session),
      'Login successful',
    );
  }

  @ApiOperation({
    summary: 'Verify the email address with the emailed code',
    description:
      'Requires the account password too, so only the person who registered can verify it.',
  })
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @ApiErrorResponse(401, AuthErrorCode.INVALID_CREDENTIALS)
  @ApiErrorResponse(403, AuthErrorCode.ACCOUNT_DISABLED)
  @ApiErrorResponse(422, AuthErrorCode.INVALID_CODE)
  @Public()
  @RateLimit(5, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.registrationService.verifyEmail(dto);
    return ResponseHelper.success(null, 'Email verified');
  }

  @ApiOperation({ summary: 'Send a new email verification code' })
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @Public()
  @RateLimit(3, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    this.registrationService.resendVerification(dto.email);
    return ResponseHelper.success(null, AuthMessage.VERIFICATION_SENT);
  }

  @ApiOperation({ summary: 'Email a password reset code' })
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @Public()
  @RateLimit(3, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    this.passwordService.forgotPassword(dto.email);
    return ResponseHelper.success(null, AuthMessage.PASSWORD_RESET_SENT);
  }

  @ApiOperation({
    summary: 'Reset the password with the emailed code',
    description: 'Signs the account out of every session.',
  })
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @ApiErrorResponse(422, AuthErrorCode.INVALID_CODE)
  @Public()
  @RateLimit(5, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordService.resetPassword(dto);
    return ResponseHelper.success(null, 'Password reset. Please log in again.');
  }

  @ApiOperation({
    summary: 'Change the password',
    description:
      'Signs out every other session and returns a new token pair for this one.',
  })
  @ApiBearerAuth('JWT-auth')
  @ApiEnvelopeResponse(AuthTokensResponseDto)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @ApiErrorResponse(401, 'UNAUTHENTICATED')
  @ApiErrorResponse(422, AuthErrorCode.CURRENT_PASSWORD_INCORRECT)
  @RateLimit(5, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: PublicUser,
    @Body() dto: ChangePasswordDto,
    @ClientMetaParam() client: ClientMeta,
  ) {
    const tokens = await this.passwordService.changePassword(
      user.id,
      dto,
      client,
    );
    return ResponseHelper.success(
      AuthTokensResponseDto.from(tokens),
      'Password changed',
    );
  }

  @ApiOperation({ summary: 'Email a one-time login code' })
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @Public()
  @RateLimit(3, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('send-otp')
  sendOtp(@Body() dto: SendOtpDto) {
    this.authService.sendLoginOtp(dto.email);
    return ResponseHelper.success(null, AuthMessage.LOGIN_CODE_SENT);
  }

  @ApiOperation({ summary: 'Log in with the emailed one-time code' })
  @ApiEnvelopeResponse(AuthSessionResponseDto)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @ApiErrorResponse(422, AuthErrorCode.INVALID_CODE)
  @Public()
  @RateLimit(5, ONE_MINUTE)
  @HttpCode(HttpStatus.OK)
  @Post('verify-otp')
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @ClientMetaParam() client: ClientMeta,
  ) {
    const session = await this.authService.verifyLoginOtp(dto, client);
    return ResponseHelper.success(
      AuthSessionResponseDto.from(session),
      'Login successful',
    );
  }

  @ApiOperation({ summary: 'Get the current user' })
  @ApiBearerAuth('JWT-auth')
  @ApiEnvelopeResponse(UserResponseDto)
  @ApiErrorResponse(401, 'UNAUTHENTICATED')
  @Get('profile')
  getProfile(@CurrentUser() user: PublicUser) {
    return ResponseHelper.success(
      UserResponseDto.from(user),
      'Profile retrieved',
    );
  }

  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description: 'Refresh tokens are single use: the old one stops working.',
  })
  @ApiEnvelopeResponse(AuthTokensResponseDto)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @ApiErrorResponse(401, AuthErrorCode.INVALID_REFRESH_TOKEN)
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh-token')
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @ClientMetaParam() client: ClientMeta,
  ) {
    const tokens = await this.authService.refresh(dto.refreshToken, client);
    return ResponseHelper.success(
      AuthTokensResponseDto.from(tokens),
      'Token refreshed',
    );
  }

  @ApiOperation({
    summary: 'Log out this session (revoke the refresh token)',
    description: 'Idempotent: unknown or already revoked tokens succeed too.',
  })
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(400, 'VALIDATION_FAILED')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken);
    return ResponseHelper.success(null, 'Logged out');
  }

  @ApiOperation({ summary: 'Log out of every session' })
  @ApiBearerAuth('JWT-auth')
  @ApiEnvelopeResponse(null)
  @ApiErrorResponse(401, 'UNAUTHENTICATED')
  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: PublicUser) {
    await this.authService.logoutAll(user.id);
    return ResponseHelper.success(null, 'Logged out of all sessions');
  }
}
