import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  ValidationPipe,
  Get,
  Patch,
  Req,
  Ip,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  AuthResponseDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
  SendOtpDto,
  VerifyOtpDto,
  ChangePasswordDto,
  MessageResponseDto,
  RefreshTokenDto,
  RefreshTokenResponseDto,
} from './dto/auth.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RateLimit } from './decorators/rate-limit.decorator';
import { AuthenticatedRequest } from './interfaces/auth.interface';
import { ResponseHelper } from '../../common/helpers/response.helper';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Login user' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: AuthResponseDto,
  })
  @RateLimit(5, 60000) // 5 attempts per minute
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(
    @Request() req: AuthenticatedRequest,
    @Req() request: any,
    @Ip() ipAddress: string,
  ) {
    const userAgent = request.headers['user-agent'];
    const result = await this.authService.login(req.user, userAgent, ipAddress);
    return ResponseHelper.success(result, 'Login successful');
  }

  @ApiOperation({ summary: 'Register new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: MessageResponseDto,
  })
  @Post('register')
  async register(@Body(new ValidationPipe()) registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @ApiOperation({ summary: 'Verify email address with OTP' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
    type: MessageResponseDto,
  })
  @Post('verify-email')
  async verifyEmail(
    @Body(new ValidationPipe()) verifyEmailDto: VerifyEmailDto,
  ) {
    return this.authService.verifyEmail(
      verifyEmailDto.email,
      verifyEmailDto.otpCode,
    );
  }

  @ApiOperation({ summary: 'Resend verification email' })
  @ApiBody({ type: SendOtpDto })
  @ApiResponse({
    status: 200,
    description: 'Verification email sent successfully',
    type: MessageResponseDto,
  })
  @Post('resend-verification')
  async resendVerificationEmail(
    @Body(new ValidationPipe()) sendOtpDto: SendOtpDto,
  ) {
    return this.authService.resendVerificationEmail(sendOtpDto.email);
  }

  @ApiOperation({ summary: 'Forgot password' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset email sent if user exists',
    type: MessageResponseDto,
  })
  @RateLimit(3, 60000) // 3 attempts per minute
  @Post('forgot-password')
  async forgotPassword(
    @Body(new ValidationPipe()) forgotPasswordDto: ForgotPasswordDto,
  ) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @ApiOperation({ summary: 'Reset password with OTP' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
    type: MessageResponseDto,
  })
  @Post('reset-password')
  async resetPassword(
    @Body(new ValidationPipe()) resetPasswordDto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(
      resetPasswordDto.email,
      resetPasswordDto.otpCode,
      resetPasswordDto.newPassword,
    );
  }

  @ApiOperation({ summary: 'Change password' })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
    type: MessageResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body(new ValidationPipe()) changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(req.user.id, changePasswordDto);
  }

  @ApiOperation({ summary: 'Send OTP code' })
  @ApiBody({ type: SendOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully',
    type: MessageResponseDto,
  })
  @RateLimit(3, 60000) // 3 attempts per minute
  @Post('send-otp')
  async sendOtp(@Body(new ValidationPipe()) sendOtpDto: SendOtpDto) {
    return this.authService.sendOtp(sendOtpDto.email);
  }

  @ApiOperation({ summary: 'Verify OTP code and login' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP verified and user logged in',
    type: AuthResponseDto,
  })
  @Post('verify-otp')
  async verifyOtp(
    @Body(new ValidationPipe()) verifyOtpDto: VerifyOtpDto,
    @Req() request: any,
    @Ip() ipAddress: string,
  ) {
    const userAgent = request.headers['user-agent'];
    return this.authService.verifyOtp(
      verifyOtpDto.email,
      verifyOtpDto.otpCode,
      userAgent,
      ipAddress,
    );
  }

  @ApiOperation({ summary: 'Get current user profile' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: 'Current user profile',
  })
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: AuthenticatedRequest) {
    const userProfile = {
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      role: req.user.role,
      isActive: req.user.isActive,
      avatar: req.user.avatar,
      createdAt: req.user.createdAt,
    };
    return ResponseHelper.success(
      userProfile,
      'Profile retrieved successfully',
    );
  }

  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'New tokens generated',
    type: RefreshTokenResponseDto,
  })
  @Post('refresh-token')
  async refreshToken(
    @Body(new ValidationPipe()) refreshTokenDto: RefreshTokenDto,
    @Req() request: any,
    @Ip() ipAddress: string,
  ) {
    const userAgent = request.headers['user-agent'];
    const result = await this.authService.refreshAccessToken(
      refreshTokenDto.refresh_token,
      userAgent,
      ipAddress,
    );
    return ResponseHelper.success(result, 'Token refreshed successfully');
  }

  @ApiOperation({ summary: 'Logout (revoke refresh token)' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
    type: MessageResponseDto,
  })
  @Post('logout')
  async logout(
    @Body(new ValidationPipe()) refreshTokenDto: RefreshTokenDto,
  ) {
    return this.authService.revokeRefreshToken(refreshTokenDto.refresh_token);
  }

  @ApiOperation({ summary: 'Logout from all devices (revoke all refresh tokens)' })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: 'Logged out from all devices',
    type: MessageResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Request() req: AuthenticatedRequest) {
    return this.authService.revokeAllUserRefreshTokens(req.user.id);
  }
}
