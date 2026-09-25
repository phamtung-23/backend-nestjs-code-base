import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthConfig, authConfig } from '../../config/auth.config';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthCleanupTask } from './auth-cleanup.task';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CodeDeliveryService } from './code-delivery.service';
import { CredentialsService } from './credentials.service';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { RegistrationService } from './registration.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      // Lifetimes are passed per token by TokenService
      useFactory: (config: AuthConfig) => ({ secret: config.jwtSecret }),
    }),
    MailModule,
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RegistrationService,
    PasswordService,
    CredentialsService,
    CodeDeliveryService,
    TokenService,
    OtpService,
    OtpRepository,
    RefreshTokenRepository,
    JwtStrategy,
    AuthCleanupTask,
  ],
})
export class AuthModule {}
