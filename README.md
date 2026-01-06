# Chess Community Telegram Bot (Scaffold)

Monorepo scaffold for:
- **apps/bot**: Telegram bot (grammY)
- **apps/api**: Backend API (Fastify)
- **packages/shared**: shared types + Zod schemas
- **packages/db**: Prisma schema + migrations

## Quick start

1) Install deps (pnpm recommended):
```bash
corepack enable
pnpm i
```

2) Start infra:
```bash
docker compose up -d
```

3) Run migrations:
```bash
pnpm db:migrate
```

4) Run dev:
```bash
pnpm dev
```

## Env
Copy `.env.example` to `.env` and fill values.

> This is a minimal scaffold — add handlers, auth, moderation, and rating rules as needed.
