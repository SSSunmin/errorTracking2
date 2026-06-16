---
type: Playbook
title: 운영 런북
description: 로컬 셋업·인프라 기동·검증 명령. 출처는 README와 루트 package.json.
resource: package.json
tags: [ops, runbook, scripts, docker]
timestamp: 2026-06-16
---

# 운영 런북

전제: Node.js 20+, npm 11+, Docker Desktop(Compose).

## 셋업
```sh
npm install
# 필요 시 .env.example -> .env 복사 (Phase 1용 .env 동봉)
```

## 데이터 인프라 (PostgreSQL + Redis)
```sh
npm run infra:up     # docker compose up -d postgres redis
npm run infra:down   # docker compose down
```

## 검증
```sh
npm run typecheck    # tsc -b --pretty false
npm test             # vitest run
npm run lint         # eslint .
docker compose config
```

## 기타 스크립트
- `npm run build` — `tsc -b`
- `npm run dev` — 워크스페이스별 dev(존재 시)
- Prisma 시드 파일 존재: `packages/server/prisma/seed.ts`

## 관련 개념
- [환경설정](/config/environment.md) · [시스템 아키텍처](/architecture/system.md) · [프로젝트 개요](/overview/mini-sentry.md)
