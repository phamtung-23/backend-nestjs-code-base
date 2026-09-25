import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthCleanupTask } from './auth-cleanup.task';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Lifetimes are passed per token by TokenService
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    MailModule,
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    OtpService,
    OtpRepository,
    RefreshTokenRepository,
    JwtStrategy,
    AuthCleanupTask,
  ],
})
export class AuthModule {}
