---
type: Roadmap
title: 로드맵 / 단계
description: 현재 구현 범위(Phase 1)와 이후 계획. 출처는 README.
resource: README.md
tags: [roadmap, phases, planning]
timestamp: 2026-06-16
---

# 로드맵

## ✅ Phase 1 (현재)
- 모노레포 + 데이터 인프라 골격(PostgreSQL·Redis docker-compose)
- Prisma 데이터 모델([데이터 모델](/database/data-model.md))
- 인증 API(JWT + 리프레시 회전) — [인증 API](/api/auth-api.md) / [인증 플로우](/architecture/auth-flow.md)
- 프로젝트·프로젝트 키(DSN) API — [프로젝트 API](/api/projects-api.md)
- 검증 체계: typecheck · test(Vitest) · lint

## ⏳ 이후 단계 (계획)
README의 "Later phases" 기준:
- **브라우저 SDK** (`packages/sdk` 골격 → 구현)
- **인제스트 API** (이벤트 수집 엔드포인트)
- **BullMQ 워커** (Redis 큐 소비 → 이슈 집계/저장)
- **알림 연동** (AlertRule → email/slack)
- **React 대시보드** (`packages/dashboard` 골격 → 구현)

> 목표 파이프라인: `Browser SDK → Ingest API → Redis queue → Worker → PostgreSQL`. [시스템 아키텍처](/architecture/system.md) 참고.

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [시스템 아키텍처](/architecture/system.md)
