---
type: Project Overview
title: Mini-Sentry 프로젝트 개요
description: 브라우저 JavaScript 에러 모니터링 플랫폼. Phase 1~8 풀스택 구현 완료(SDK·수집·워커·이슈·알림·대시보드).
resource: /
tags: [mini-sentry, overview, monorepo, error-monitoring]
timestamp: 2026-06-16
---

# Mini-Sentry

브라우저 JavaScript 에러를 수집·집계·알림하는 **프로덕션 지향 에러 모니터링 플랫폼**(Sentry류). 저장소는 **Phase 1~8 전부 구현 완료** — SDK·인제스트·큐/워커·이슈·알림·대시보드까지 동작한다. [로드맵](/roadmap/roadmap.md) 참고.

## 무엇을 / 왜
- 브라우저 SDK가 보낸 에러 이벤트를 받아 **이슈(Issue)** 로 묶고(fingerprint 기반), 발생 추이를 추적하며, 조건에 따라 **알림(AlertRule)** 을 보낸다.
- 사용자는 대시보드에서 로그인 후 프로젝트를 만들고 **프로젝트 키(DSN)** 를 발급받아 SDK에 연결한다.

## 구현된 아키텍처
```text
Browser SDK ── @mini-sentry/sdk ──▶ Ingest API ──▶ Redis/BullMQ 큐
                                                        │
                                                   Worker ── fingerprint 그룹핑 ──▶ PostgreSQL
                                                        └── AlertRule ──▶ Email / Slack
React 대시보드 ◀── JWT 인증 API ◀── PostgreSQL
```
- 인제스트는 큐에 적재만 하고 즉시 202 응답(스파이크 흡수) — [인제스트 파이프라인](/architecture/ingestion-pipeline.md).
- 워커가 fingerprint로 이슈를 묶고 알림 규칙을 평가 — [알림 규칙 API](/api/alerts-api.md).

## 모노레포 구성
- `packages/server` — Fastify API 서버 + BullMQ 워커 + Prisma 데이터 계층. 핵심.
- `packages/sdk` — 브라우저 SDK([브라우저 SDK](/architecture/sdk.md)).
- `packages/dashboard` — React 대시보드([대시보드](/architecture/dashboard.md)).
- `examples/demo-app` — SDK 데모 Vite 앱.

## 기술 스택
- 런타임: Node.js 20+(24 개발), ESM, TypeScript 5.9
- 서버: Fastify, `fastify-type-provider-zod`(Zod 검증), `@fastify/cookie`/`cors`/`rate-limit`, argon2·jose(JWT), BullMQ·ioredis, Nodemailer, pino
- DB: PostgreSQL + Prisma / 큐: Redis (docker-compose로 로컬 기동)
- 프론트: React 18 + Vite + TanStack Query + React Router
- 검증/테스트: Zod, Vitest, ESLint, Prettier

## 실행 / 검증
- 의존성: `npm install`
- 인프라 기동: `npm run infra:up` (PostgreSQL + Redis) / 종료: `npm run infra:down`
- 검증: `npm run typecheck` · `npm test` · `npm run lint` · `npm run build`

## 관련 개념
- 데이터 구조: [데이터 모델](/database/data-model.md) · [ERD](/database/erd.md)
- API: [인증](/api/auth-api.md) · [프로젝트](/api/projects-api.md) · [인제스트](/api/ingest-api.md) · [이슈](/api/issues-api.md) · [알림](/api/alerts-api.md)
- 아키텍처: [시스템](/architecture/system.md) · [인제스트 파이프라인](/architecture/ingestion-pipeline.md) · [SDK](/architecture/sdk.md) · [대시보드](/architecture/dashboard.md)
