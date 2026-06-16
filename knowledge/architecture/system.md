---
type: Architecture
title: 시스템 아키텍처
description: 모노레포 구성, API 서버 부팅·미들웨어 순서, 구현된 수집→워커 파이프라인.
resource: packages/server/src/app.ts
tags: [architecture, monorepo, fastify, pipeline]
timestamp: 2026-06-16
---

# 시스템 아키텍처

## 모노레포
- `packages/server` — Fastify API 서버 + BullMQ 워커(핵심). Prisma + PostgreSQL, JWT 인증.
- `packages/sdk` — 브라우저 SDK([브라우저 SDK](/architecture/sdk.md)).
- `packages/dashboard` — React 대시보드([대시보드](/architecture/dashboard.md)).
- `examples/demo-app` — SDK 데모 Vite 앱.
- 워크스페이스: `packages/*`, `examples/*` (루트 `package.json`). 빌드 `tsc -b`, 테스트 Vitest.

## API 서버 부팅 (`buildApp`)
미들웨어/등록 순서 (`app.ts`):
1. Zod validator/serializer 컴파일러 설정
2. 전역 에러 핸들러 → 공통 에러 포맷(자세히: [에러 응답 규약](/reference/error-model.md))
3. 404 핸들러, `GET /health`
4. 플러그인: `cors`(credentials, origin=CORS_ORIGIN) → `cookie` → `rate-limit`(global:false) → `authPlugin`
5. 라우트:
   - `/api/auth` — [인증 API](/api/auth-api.md)
   - `/api/projects` — [프로젝트 API](/api/projects-api.md) (하위에 [이슈 API](/api/issues-api.md)·[알림 규칙 API](/api/alerts-api.md) 중첩)
   - 공개 인제스트 `POST /api/:projectId/store` — [인제스트 API](/api/ingest-api.md) (라우트 단위 permissive CORS)

## 구현된 흐름
```text
Browser SDK ──> Ingest API ──(enqueue)──> Redis/BullMQ ──> Worker ──> fingerprint 그룹핑 ──> PostgreSQL
                                                              └── AlertRule 평가 ──> Email/Slack
React 대시보드 ──> JWT 인증 API + 이슈/프로젝트/알림 API ──> PostgreSQL
```
- 인제스트는 검증 후 큐 적재만 하고 즉시 202 — 처리/그룹핑은 워커가 비동기로. 상세: [인제스트 파이프라인](/architecture/ingestion-pipeline.md).
- 워커는 별도 엔트리(`worker.ts`)로 수평 확장 가능.

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [인제스트 파이프라인](/architecture/ingestion-pipeline.md) · [인증 플로우](/architecture/auth-flow.md) · [데이터 모델](/database/data-model.md) · [환경설정](/config/environment.md)
