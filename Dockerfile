# nexQ Deposit — production container.
# Multi-stage: build with full deps, then run. Postgres is external (see compose).

FROM node:20-slim AS base
WORKDIR /app
# Prisma needs openssl at build and runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- builder ----
FROM base AS builder
# Build-only placeholders (NOT used at runtime — Next runs the build with
# NODE_ENV=production, and these satisfy module init during page-data collection).
ENV AUTH_SECRET="build-only-placeholder-not-used-at-runtime-000000"
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# build = generate icons + prisma generate + next build
RUN npm run build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
# Bring over the built app (incl. node_modules with prisma CLI for migrate deploy).
COPY --from=builder /app ./
EXPOSE 3000
# Apply pending migrations, optionally seed the initial admin, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$RUN_SEED\" = \"true\" ]; then npm run seed; fi && npm run start"]
