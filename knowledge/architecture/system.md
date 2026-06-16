---
type: Architecture
title: 시스템 아키텍처
description: 모노레포 구성, API 서버 부팅·미들웨어 순서, 현재 구현 범위와 계획된 인제스트 파이프라인.
resource: packages/server/src/app.ts
tags: [architecture, monorepo, fastify, pipeline]
timestamp: 2026-06-16
---

# 시스템 아키텍처

## 모노레포
- `packages/server` — Fastify API 서버(핵심). Prisma + PostgreSQL, JWT 인증.
- `packages/sdk` — 브라우저 SDK(골격).
- `packages/dashboard` — React 대시보드(골격).
- `examples/demo-app` — 데모 앱.
- 워크스페이스: `packages/*`, `examples/*` (루트 `package.json`). 빌드 `tsc -b`, 테스트 Vitest.

## API 서버 부팅 (`buildApp`)
미들웨어/등록 순서 (`app.ts`):
1. Zod validator/serializer 컴파일러 설정
2. 전역 에러 핸들러 → 공통 에러 포맷(자세히: [에러 응답 규약](/reference/error-model.md))
3. 404 핸들러, `GET /health`
4. 플러그인: `cors`(credentials, origin=CORS_ORIGIN) → `cookie` → `rate-limit`(global:false) → `authPlugin`
5. 라우트: `/api/auth`([인증 API](/api/auth-api.md)) · `/api/projects`([프로젝트 API](/api/projects-api.md))

## 현재 흐름 (Phase 1)
```text
React dashboard(예정) ──> JWT auth API ──> PostgreSQL(Prisma)
                          project/key API ─┘
```

## 계획된 흐름 (이후 단계)
```text
Browser SDK ──> Ingest API ──> Redis queue ──> Worker ──> PostgreSQL
```
> 인제스트 API·BullMQ 워커·SDK·대시보드·알림 연동은 아직 미구현. [로드맵](/roadmap/roadmap.md) 참고.

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [인증 플로우](/architecture/auth-flow.md) · [데이터 모델](/database/data-model.md) · [환경설정](/config/environment.md)
