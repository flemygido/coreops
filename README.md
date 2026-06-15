# CoreOps

AI operations layer for Indian SMBs. Connects WhatsApp, Zoho Books/Tally, and Gmail to surface receivables insights and deliver owner briefings.

## Status: Phase 0 — Scaffold

> This repo is in active development. See [CLAUDE.md](./CLAUDE.md) for project context and [PROGRESS.md](./PROGRESS.md) for current status.

## Prerequisites

- Node.js 24 LTS (`nvm use` will pick up `.nvmrc`)
- npm 10+

## Setup

```bash
# Install dependencies
npm install

# Copy and fill environment variables
cp .env.example .env

# Run the API dev server
npm run dev -w apps/api
```

## Commands

| Command | What it does |
|---------|-------------|
| `npm run lint` | ESLint across all workspaces |
| `npm run type-check` | TypeScript type-check (no emit) |
| `npm test` | Vitest across all workspaces |
| `npm run build` | Compile all workspaces |

## Architecture

- **`apps/api/`** — Fastify 5 + TypeScript backend
- **`apps/web/`** — Next.js dashboard (Phase 6)
- **`packages/shared/`** — Shared types and utilities
- **`docs/adr/`** — Architecture Decision Records

## Docs

- [CLAUDE.md](./CLAUDE.md) — Project context, tech stack, phase map, conventions
- [PROGRESS.md](./PROGRESS.md) — Current phase status and blockers
- [docs/adr/](./docs/adr/) — Architecture decisions
