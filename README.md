# Backend Base - Authentication & User Management API

A comprehensive **NestJS** authentication and user management system, ready to be used as a base for your next project.

## 🚀 Features

### Authentication & Security

- ✅ **User Registration** with OTP email verification
- ✅ **Login** with JWT dual-token authentication
- ✅ **Refresh Token Mechanism** with rotation and revocation
- ✅ **Password Management** (forgot password, reset password, change password)
- ✅ **OTP Authentication** (separate OTP table for all verification needs)
- ✅ **Multi-device Session Management** (logout from all devices)
- ✅ **Rate Limiting** for security-sensitive endpoints
- ✅ **Role-based Access Control** (Admin, Customer)
- ✅ **Device Tracking** (user agent, IP address)

### Technical Features

- ✅ **JWT Authentication** with Passport strategies
- ✅ **Redis Caching** for improved performance
- ✅ **Global Exception Handling**
- ✅ **Consistent API Response Format**
- ✅ **Email Service** with Nodemailer
- ✅ **Swagger/OpenAPI Documentation**
- ✅ **TypeScript** with strong typing
- ✅ **Prisma ORM** for database management
- ✅ **PostgreSQL** database

## 📋 Tech Stack

- **Framework**: NestJS 11.x
- **Language**: TypeScript
- **ORM**: Prisma 6.x
- **Database**: PostgreSQL
- **Cache**: Redis
- **Authentication**: JWT + Passport
- **Email**: Nodemailer
- **Validation**: class-validator, class-transformer
- **API Docs**: Swagger/OpenAPI

## 🗄️ Database Schema

### User Model

- Email, password (bcrypt hashed)
- Personal info (firstName, lastName, avatar)
- Role (ADMIN, CUSTOMER)
- Email verification status
- Activity tracking (lastLoginAt)
- Timestamps (createdAt, updatedAt)

### OTP Model (All verification codes in one place)
- OTP code (6 digits)
- Expiration time (10 minutes)
- Usage status (isUsed)
- Type (LOGIN, VERIFICATION, PASSWORD_RESET)
- User relation with cascade delete
- Indexed for fast lookups (userId, code)

### RefreshToken Model (JWT refresh mechanism)
- JWT refresh token string
- Expiration time (7 days)
- Revocation status (isRevoked)
- Device tracking (userAgent, ipAddress)
- User relation with cascade delete
- Indexed for fast lookups (userId, token)
- Supports token rotation for enhanced security

## 📦 Installation

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your database and SMTP credentials

# Generate Prisma Client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed database with default users
npm run prisma:seed
```

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5433/dbname?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d

# API
PORT=3000
API_PREFIX=api/v1

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@yourapp.com

# Frontend (for email links)
FRONTEND_URL=http://localhost:3000
```

## 🏃 Running the Application

```bash
# Development
npm run start:dev

# Production build
npm run build
npm run start:prod

# Open Prisma Studio (Database GUI)
npm run db:studio
```

The API will be available at:

- **API**: http://localhost:3000/api/v1
- **Swagger Docs**: http://localhost:3000/api/docs

## 🔑 Default Users

After seeding, you can login with:

**Admin Account:**

- Email: `admin@example.com`
- Password: `Admin@123`

**Customer Account:**

- Email: `customer@example.com`
- Password: `Customer@123`

## 📚 API Endpoints

### Authentication

#### Register

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password@123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password@123"
}
```

#### Verify Email (with OTP)

```http
POST /api/v1/auth/verify-email
Content-Type: application/json

{
  "email": "user@example.com",
  "otpCode": "123456"
}
```

#### Resend Verification Code

```http
POST /api/v1/auth/resend-verification
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Forgot Password (sends OTP via email)

```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Reset Password (with OTP)

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "otpCode": "123456",
  "newPassword": "NewPassword@123"
}
```

#### Change Password (Protected)

```http
PATCH /api/v1/auth/change-password
Authorization: Bearer <your-jwt-token>
Content-Type: application/json

{
  "currentPassword": "OldPassword@123",
  "newPassword": "NewPassword@123"
}
```

#### Send OTP

```http
POST /api/v1/auth/send-otp
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Verify OTP

```http
POST /api/v1/auth/verify-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otpCode": "123456"
}
```

#### Get Profile (Protected)

```http
GET /api/v1/auth/profile
Authorization: Bearer <your-jwt-token>
```

#### Refresh Access Token

```http
POST /api/v1/auth/refresh-token
Content-Type: application/json

{
  "refresh_token": "your-refresh-token-here"
}
```

#### Logout (Revoke Refresh Token)

```http
POST /api/v1/auth/logout
Content-Type: application/json

{
  "refresh_token": "your-refresh-token-here"
}
```

#### Logout from All Devices (Protected)

```http
POST /api/v1/auth/logout-all
Authorization: Bearer <your-jwt-token>
```

## 🔒 Password Requirements

Passwords must:

- Be at least 6 characters long
- Contain at least one uppercase letter
- Contain at least one lowercase letter
- Contain at least one number

## 🛡️ Security Features

- **Bcrypt** password hashing (10 salt rounds)
- **JWT Authentication** with dual-token system:
  - **Access Token**: Short-lived (15 minutes) for API requests
  - **Refresh Token**: Long-lived (7 days) for token renewal
  - **Token Rotation**: New refresh token issued on each refresh
- **Rate Limiting** on sensitive endpoints:
  - Login: 5 attempts per minute
  - Forgot Password: 3 attempts per minute
  - Send OTP: 3 attempts per minute
- **OTP-based verification** for all sensitive operations:
  - Email verification: 6-digit OTP (10 minutes expiry)
  - Password reset: 6-digit OTP (10 minutes expiry)
  - Login: 6-digit OTP (10 minutes expiry)
- **One-time use codes**: OTPs marked as used after verification
- **Auto-invalidation**: New OTP invalidates previous unused ones
- **Refresh Token Security**:
  - Stored in database with expiration
  - Can be revoked individually or all at once
  - Device tracking (user agent, IP address)
  - Token rotation on each refresh
- **Automatic cleanup**: Methods to remove expired tokens and OTPs

## 📖 API Documentation

Interactive API documentation is available via Swagger UI:

- Navigate to: http://localhost:3000/api/docs
- Test endpoints directly from the browser
- JWT authentication is supported in Swagger UI

## 🗂️ Project Structure

```
src/
├── common/              # Shared utilities
│   ├── filters/         # Global exception filter
│   ├── interceptors/    # Response interceptor
│   ├── helpers/         # Response helper
│   └── interfaces/      # Shared interfaces
├── modules/
│   └── auth/           # Authentication module
│       ├── decorators/ # Custom decorators (rate limit)
│       ├── dto/        # Data Transfer Objects
│       ├── guards/     # Auth guards (JWT, Local)
│       ├── interfaces/ # Auth interfaces
│       ├── services/   # Email service
│       └── strategies/ # Passport strategies
├── prisma/             # Database service
├── app.module.ts       # Root module
└── main.ts            # Application entry point

prisma/
├── schema.prisma      # Database schema
├── seed.ts           # Database seeding
└── migrations/       # Database migrations
```

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 🔄 Database Management

```bash
# Generate Prisma Client
npm run prisma:generate

# Create a new migration
npm run prisma:migrate

# Reset database (warning: deletes all data)
npm run prisma:reset

# Seed database
npm run prisma:seed

# Open Prisma Studio
npm run db:studio
```

## 📝 Response Format

All API responses follow a consistent format:

**Success Response:**

```json
{
  "status": "success",
  "message": "Request completed successfully",
  "data": { ... }
}
```

**Error Response:**

```json
{
  "status": "error",
  "message": "Error message",
  "data": null,
  "error": {
    "code": 400,
    "details": { ... }
  }
}
```

## 🌟 Best Practices

This codebase follows:

- ✅ **Clean Architecture** principles
- ✅ **SOLID** principles
- ✅ **Separation of Concerns**
- ✅ **Dependency Injection**
- ✅ **Type Safety** with TypeScript
- ✅ **Error Handling** at all levels
- ✅ **Security Best Practices**
- ✅ **RESTful API** design

## 🚧 Future Enhancements

Potential features to add:

- [x] ~~Refresh token mechanism~~ ✅ **Implemented!**
- [ ] Social authentication (Google, Facebook, GitHub)
- [ ] Two-factor authentication (2FA with TOTP)
- [ ] User profile management endpoints (update profile, avatar upload)
- [ ] Admin panel for user management
- [ ] Audit logging (track all user actions)
- [ ] File upload service (avatar, documents)
- [ ] Email templates with better design (React Email)
- [ ] WebSocket support for real-time features
- [ ] Comprehensive unit and e2e tests
- [ ] Background jobs for cleanup (Bull/BullMQ)
- [ ] API rate limiting per user/IP
- [ ] Account lockout after failed attempts

## 📄 License

This project is licensed under the UNLICENSED license.

## 🤝 Contributing

This is a base template project. Feel free to fork and customize it for your needs!

## 📞 Support

For issues and questions, please open an issue on the repository.

---

```bash
cd /Users/phamthanhtung/Learning/backend-base && npx prisma generate
cd /Users/phamthanhtung/Learning/backend-base && npx prisma migrate dev --name remove_token_fields_use_otp_only
```

**Built with ❤️ using NestJS**
