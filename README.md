# SleekTodo

A Notion-style collaborative to-do application.

## Prerequisites
- Node 20 (`nvm use`)
- pnpm (`corepack enable`)
- Docker + Docker Compose

## Quick start
```bash
cp .env.example .env
docker compose up --build
# API: http://localhost:3000  •  Health: http://localhost:3000/health/ready
```

## Development
```bash
pnpm install
pnpm api:dev          # watch mode (needs local postgres+redis or `docker compose up postgres redis`)
pnpm api:test         # unit tests
pnpm api:test:int     # integration tests (Testcontainers; needs Docker running)
```
