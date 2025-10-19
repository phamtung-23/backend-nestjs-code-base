# Backend Base - NestJS API with Docker Setup

## 📋 Overview

This project provides a complete backend setup using Docker Compose to orchestrate the following services:

- **PostgreSQL**: Primary database
- **Redis**: In-memory data store and cache
- **Backend**: NestJS API with Prisma ORM
- **Traefik**: Reverse proxy and load balancer

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Environment variables configured (see Environment Variables section)

### 1. Environment Setup

Create a `.env` file in the root directory with the following configuration:

```env
# Database Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=default
POSTGRES_PORT=5432

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here
JWT_REFRESH_SECRET=your-super-secret-refresh-key-here

# NestJS Configuration
NODE_ENV=development
NESTJS_PORT=3000
NESTJS_CONTAINER_PORT=3000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
API_PREFIX=api

# Domain Configuration
DOMAIN=localhost

# Frontend URL (for email links)
FRONTEND_URL=http://localhost:3000

# OTP Configuration
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RATE_LIMIT_MINUTES=1
OTP_CODE_LENGTH=6

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379

# SMTP Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

### 2. Development Mode

Start all services in development mode:

```bash
docker compose up -d
```

This will:
- Start PostgreSQL database
- Start Redis cache
- Build and start NestJS backend with hot reload
- Start Traefik reverse proxy

### 3. Development with HTTPS

For HTTPS development (requires SSL certificates):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev-https.yml up -d
```

**Note**: You need to create SSL certificates first (see HTTPS Setup section).

### 4. Production Mode

#### Production with Domain (Recommended)

For production deployment with a domain name:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

#### Production with IP Only

For servers with only IP address (no domain):

```bash
export DOMAIN=192.168.1.100
docker compose -f docker-compose.yml -f docker-compose.prod-ip.yml up -d
```

## 🔗 Service URLs

### Development (HTTP)

- **API**: http://localhost/api
- **Traefik Dashboard**: http://localhost:8080
- **Health Check**: http://localhost/api/health

### Development (HTTPS)

- **API**: https://localhost/api
- **Traefik Dashboard**: https://localhost/traefik
- **Health Check**: https://localhost/api/health

### Production (Domain)

- **API**: https://yourdomain.com/api
- **Health Check**: https://yourdomain.com/api/health

### Production (IP Only)

- **API**: http://192.168.1.100/api
- **Health Check**: http://192.168.1.100/api/health

## 🔧 HTTPS Setup

### For Development with Local Domain

1. **Add to hosts file** (requires admin privileges):

   ```bash
   # macOS/Linux
   sudo echo "127.0.0.1 localhost" >> /etc/hosts

   # Windows (run as Administrator)
   echo 127.0.0.1 localhost >> C:\Windows\System32\drivers\etc\hosts
   ```

2. **Create SSL certificate directory**:

   ```bash
   mkdir -p traefik/certs
   ```

3. **Generate self-signed certificate**:

   ```bash
   openssl req -x509 -newkey rsa:4096 -keyout traefik/certs/localhost.key \
     -out traefik/certs/localhost.crt -days 365 -nodes \
     -subj "/C=VN/ST=HCM/L=HCM/O=Dev/OU=IT/CN=localhost" \
     -addext "subjectAltName=DNS:localhost,DNS:*.localhost"

   # Set proper permissions
   chmod 600 traefik/certs/localhost.key
   chmod 644 traefik/certs/localhost.crt
   ```

4. **Start with HTTPS**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev-https.yml up -d
   ```

### For Production with Domain

1. **Update Traefik configuration** in `traefik/prod.yml`:

   ```yaml
   certificatesResolvers:
     letsencrypt:
       acme:
         email: "your-email@domain.com"  # Update with your email
         storage: /acme.json
         httpChallenge:
           entryPoint: web
   ```

2. **Set environment variables**:

   ```env
   DOMAIN=yourdomain.com
   ```

3. **Deploy**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

## 📁 Project Structure

```text
backend-base/
├── backend/                    # NestJS Application
│   ├── Dockerfile             # Multi-stage build
│   ├── src/                   # Source code
│   │   ├── modules/           # Feature modules
│   │   │   └── auth/          # Authentication module
│   │   ├── common/            # Shared utilities
│   │   ├── prisma/            # Prisma configuration
│   │   └── main.ts            # Application entry point
│   ├── prisma/                # Prisma Configuration
│   │   ├── schema.prisma      # Database schema
│   │   ├── migrations/        # Database migrations
│   │   └── seed.ts            # Database seeding
│   └── package.json           # Dependencies
├── traefik/                   # Traefik configurations
│   ├── dev.yml               # Development config
│   ├── dev-https.yml         # Development HTTPS config
│   ├── prod.yml              # Production config
│   ├── prod-ip.yml           # Production IP-only config
│   ├── dynamic-dev.yml       # Development dynamic config
│   ├── dynamic-dev-https.yml # Development HTTPS dynamic config
│   ├── dynamic-prod.yml      # Production dynamic config
│   ├── dynamic-prod-ip.yml   # Production IP dynamic config
│   └── certs/                # SSL certificates (for HTTPS dev)
├── docker-compose.yml         # Base configuration
├── docker-compose.override.yml # Development overrides (auto-loaded)
├── docker-compose.dev-https.yml # HTTPS development
├── docker-compose.prod.yml    # Production overrides (with domain)
├── docker-compose.prod-ip.yml # Production overrides (IP only)
└── .env                       # Environment variables
```

## 🗄️ Database Management

### Development

#### Prisma Migrations

Run migrations in the backend container:

```bash
docker compose exec backend npx prisma migrate dev
```

#### Database Reset

Reset the database:

```bash
docker compose exec backend npx prisma migrate reset
```

#### Generate Prisma Client

Generate Prisma client:

```bash
docker compose exec backend npx prisma generate
```

#### Prisma Studio

Open Prisma Studio for database management:

```bash
docker compose exec backend npx prisma studio
```

### Production Database

#### Automatic Migrations

In production, migrations are handled automatically by the main application container:

1. **Startup Script**: The application runs `prisma migrate deploy` before starting
2. **Health Checks**: PostgreSQL health checks ensure the database is ready
3. **Simple Approach**: No separate init containers needed

#### Manual Migration (if needed)

If you need to run migrations manually in production:

```bash
# Run migrations in the main container
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

#### Run Data Seed

```bash
docker compose -f docker-compose.yml -f docker-compose.prod-ip.yml exec backend node dist/prisma/seed.js
```

## 🐳 Docker Commands

### Basic Operations

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View running services
docker compose ps

# View logs
docker compose logs -f [service-name]

# Rebuild specific service
docker compose build backend
```

### Development Workflow

```bash
# Start development environment
docker compose up -d

# Watch logs
docker compose logs -f backend

# Install new packages
docker compose exec backend yarn add <package>
docker compose restart backend

# Run tests
docker compose exec backend yarn test

# Access container shell
docker compose exec backend sh
```

## 🔍 Health Checks

### Development Health Checks

```bash
# Check NestJS health
curl http://localhost/api/health

# Check PostgreSQL connection
docker compose exec postgres pg_isready -U postgres

# Check all services
docker compose ps
```

### Production Health Checks

```bash
# Health check endpoints
curl https://yourdomain.com/api/health

# View service status
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

## 🔐 Authentication & Authorization

### JWT Configuration

- **JWT Secret**: Configured via `JWT_SECRET` environment variable
- **Refresh Token Secret**: Configured via `JWT_REFRESH_SECRET`
- **Token Expiry**: 30 minutes for access token, 7 days for refresh token

### Role-Based Access Control (RBAC)

- **Default Role**: New users automatically get "user" role
- **Role Management**: Admin can assign/remove roles
- **JWT Integration**: Roles embedded in JWT payload

### OTP Authentication

- **Email OTP**: Email verification for registration and password reset
- **OTP Types**: LOGIN, REGISTER, RESET_PASSWORD
- **Security**: 5-minute expiry, 3 attempts max, rate limiting

## 🚨 Troubleshooting

### Port Conflicts

If you encounter port conflicts:

1. Check if ports 80, 443, 3000, 5432, 6379 are available
2. Modify port mappings in docker-compose files
3. Update environment variables accordingly

### Database Connection Issues

1. Ensure PostgreSQL is running: `docker compose ps postgres`
2. Check database logs: `docker compose logs postgres`
3. Verify DATABASE_URL in environment variables

### Redis Connection Issues

1. Check Redis logs: `docker compose logs redis`
2. Verify Redis configuration in environment variables
3. Ensure Redis is accessible from backend container

### Build Issues

1. Clear Docker cache: `docker system prune -a`
2. Rebuild without cache: `docker compose build --no-cache`
3. Check Dockerfile syntax and dependencies

### Logs & Debugging

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f backend
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f traefik

# Debug NestJS (development only)
# Attach debugger to port 9229 in VS Code
```

## 📝 Environment Variables Reference

| Variable                  | Description                                                | Default                                       |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `NODE_ENV`                | Environment mode                                           | `development`                                 |
| `DOMAIN`                  | Primary domain (localhost or production domain)           | `localhost`                                   |
| `POSTGRES_USER`           | Database username                                          | `postgres`                                    |
| `POSTGRES_PASSWORD`       | Database password                                          | `postgres`                                    |
| `POSTGRES_DB`             | Database name                                              | `default`                                     |
| `POSTGRES_PORT`           | Database port                                              | `5432`                                        |
| `JWT_SECRET`              | JWT signing secret                                         | Required                                      |
| `JWT_REFRESH_SECRET`      | Refresh token secret                                       | Required                                      |
| `NESTJS_PORT`             | Backend application port                                   | `3000`                                        |
| `NESTJS_CONTAINER_PORT`   | Container port mapping                                     | `3000`                                        |
| `ALLOWED_ORIGINS`         | CORS allowed origins                                       | `http://localhost:3000,http://localhost:8080` |
| `API_PREFIX`              | API route prefix                                           | `api`                                         |
| `FRONTEND_URL`            | Frontend URL for email links                               | `http://localhost:3000`                       |
| `OTP_EXPIRY_MINUTES`      | OTP expiration time                                        | `5`                                           |
| `OTP_MAX_ATTEMPTS`        | Max OTP attempts                                           | `3`                                           |
| `OTP_RATE_LIMIT_MINUTES`  | OTP rate limit                                             | `1`                                           |
| `OTP_CODE_LENGTH`         | OTP code length                                            | `6`                                           |
| `REDIS_HOST`              | Redis host                                                 | `redis`                                       |
| `REDIS_PORT`              | Redis port                                                 | `6379`                                        |
| `SMTP_HOST`               | SMTP server host                                           | Required                                      |
| `SMTP_PORT`               | SMTP server port                                           | `587`                                         |
| `SMTP_USER`               | SMTP username                                              | Required                                      |
| `SMTP_PASS`               | SMTP password                                              | Required                                      |
| `SMTP_FROM`               | SMTP from email                                            | Required                                      |

## 🔄 Deployment

### Development Deployment

```bash
# Start development environment
docker compose up -d

# Prisma migrations are handled automatically
```

### Production Deployment

```bash
# Production with domain
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Production with IP only
docker compose -f docker-compose.yml -f docker-compose.prod-ip.yml up -d
```

### HTTPS Development

```bash
# For HTTPS development with SSL certificates
docker compose -f docker-compose.yml -f docker-compose.dev-https.yml up -d
```

## 📚 Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [Redis Documentation](https://redis.io/docs/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

---

**Note**: This setup is designed for development and production use with proper security configurations. Make sure to update all default passwords and secrets before deploying to production.