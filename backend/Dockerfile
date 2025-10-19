# Multi-stage Dockerfile for both dev and prod
FROM node:22-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Set working directory
WORKDIR /app

# Development stage
FROM base AS development
# Copy package files
COPY package.json yarn.lock* ./
# Install ALL dependencies for development
RUN yarn install --frozen-lockfile
# Copy source code
COPY . .
# Ensure dist directory doesn't exist to avoid conflicts
RUN rm -rf dist
# Generate Prisma client (after copying source code)
RUN npx prisma generate
# Expose port (will be overridden by docker-compose)
EXPOSE 3001
# Start in development mode with hot reload
CMD ["yarn", "start:dev"]

# Build stage for production
FROM base AS builder
# Copy package files
COPY package.json yarn.lock* ./
# Install ALL dependencies (including dev deps for building)
RUN yarn install --frozen-lockfile
# Copy source code
COPY . .
# Generate Prisma client (after copying source code)
RUN npx prisma generate
# Build the application
RUN yarn build

# Production stage
FROM base AS production
# Copy package files
COPY package.json yarn.lock* ./
# Install ONLY production dependencies
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean --force && \
    rm -rf ~/.yarn && \
    rm -rf /tmp/*

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Copy Prisma CLI for migrations
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Change ownership to non-root user
RUN chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose port (will be overridden by docker-compose)
EXPOSE 3001

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Use npm script for production with migrations
CMD ["yarn", "start:prod:migrate"]
