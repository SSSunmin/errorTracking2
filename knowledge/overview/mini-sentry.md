---
type: Project Overview
title: Mini-Sentry 프로젝트 개요
description: 브라우저 JavaScript 에러 모니터링 플랫폼. 현재 Phase 1(모노레포 + 데이터 인프라 + 인증/프로젝트 API) 단계.
resource: /
tags: [mini-sentry, overview, monorepo, error-monitoring]
timestamp: 2026-06-16
---

# Mini-Sentry

브라우저 JavaScript 에러를 수집·집계·알림하는 **프로덕션 지향 에러 모니터링 플랫폼**(Sentry류). 현재 저장소는 **Phase 1**(모노레포 골격 + 데이터 인프라 + 인증/프로젝트 API)까지 구현되어 있다.

## 무엇을 / 왜
- 브라우저 SDK가 보낸 에러 이벤트를 받아 **이슈(Issue)** 로 묶고(fingerprint 기반), 발생 추이를 추적하며, 조건에 따라 **알림(AlertRule)** 을 보낸다.
- 사용자는 대시보드에서 로그인 후 프로젝트를 만들고 **프로젝트 키(DSN)** 를 발급받아 SDK에 연결한다.

## 목표 아키텍처 (의도된 흐름)
```text
Browser SDK -> Ingest API -> Redis queue -> Worker -> PostgreSQL
React dashboard -> JWT auth API
```
> Phase 1 시점에는 인증 API와 프로젝트/키 관리 API, 데이터 모델까지 존재. 인제스트 API·BullMQ 워커·SDK·대시보드·알림 연동은 이후 단계.

## 모노레포 구성
- `packages/server` — Fastify API 서버 (Prisma + PostgreSQL, JWT 인증). 핵심.
- `packages/sdk` — 브라우저 SDK (골격).
- `packages/dashboard` — React 대시보드 (골격).
- `examples/demo-app` — 데모 앱.

## 기술 스택
- 런타임: Node.js 20+, ESM, TypeScript 5.9
- 서버: Fastify, `fastify-type-provider-zod`(Zod 검증), `@fastify/cookie`/`cors`/`rate-limit`
- DB: PostgreSQL + Prisma / 큐: Redis (docker-compose로 로컬 기동)
- 검증/테스트: Zod, Vitest, ESLint, Prettier

## 실행 / 검증
- 의존성: `npm install`
- 인프라 기동: `npm run infra:up` (PostgreSQL + Redis) / 종료: `npm run infra:down`
- 검증: `npm run typecheck` · `npm test` · `npm run lint` · `docker compose config`

## 관련 개념
- 데이터 구조: [데이터 모델](/database/data-model.md)
- API: [인증 API](/api/auth-api.md) · [프로젝트 API](/api/projects-api.md)
