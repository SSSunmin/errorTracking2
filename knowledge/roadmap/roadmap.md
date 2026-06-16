---
type: Roadmap
title: 로드맵 / 단계
description: Phase 1~8 모두 구현 완료. 범위 밖(미구현) 항목 정리.
resource: README.md
tags: [roadmap, phases, planning]
timestamp: 2026-06-16
---

# 로드맵

## ✅ 구현 완료 (Phase 1~8)
- **Phase 1 — 모노레포 + 인프라**: npm workspaces, PostgreSQL·Redis docker-compose, 검증 스크립트(typecheck·test·lint).
- **Phase 2 — 데이터 모델**: Prisma 스키마·마이그레이션·seed — [데이터 모델](/database/data-model.md) / [ERD](/database/erd.md).
- **Phase 3 — 인증 + 프로젝트/DSN**: argon2·JWT(`jti`·alg 고정)·리프레시 회전·재사용 패밀리 회수 — [인증 API](/api/auth-api.md) / [인증 플로우](/architecture/auth-flow.md) / [프로젝트 API](/api/projects-api.md).
- **Phase 4 — 수집 + 큐 + 워커 + 이슈**: 공개 Ingest API, BullMQ 큐, 워커 fingerprint 그룹핑, 이슈 조회/관리 — [인제스트 파이프라인](/architecture/ingestion-pipeline.md) / [인제스트 API](/api/ingest-api.md) / [이슈 API](/api/issues-api.md).
- **Phase 5 — 알림**: AlertRule CRUD, Email(Nodemailer)+Slack, advisory-lock 디듀프, SSRF 가드 — [알림 규칙 API](/api/alerts-api.md).
- **Phase 6 — 브라우저 SDK**: 전역 캐치·breadcrumbs·스택 파싱·transport, 호스트 무중단 — [브라우저 SDK](/architecture/sdk.md).
- **Phase 7 — 대시보드**: React+Vite+TanStack Query+Router SPA — [대시보드](/architecture/dashboard.md).
- **Phase 8 — 통합 검증**: 엔드투엔드 검증, 보안 패치, 문서.

> 구현된 파이프라인: `Browser SDK → Ingest API → Redis/BullMQ 큐 → Worker → fingerprint 그룹핑 → PostgreSQL` + `React 대시보드 → JWT 인증 API` + `알림 → Email/Slack`. [시스템 아키텍처](/architecture/system.md) 참고.

## 🚫 범위 밖 (미구현)
- 이메일 인증 / 비밀번호 재설정 / 2FA
- 소스맵 심볼리케이션(미니파이 스택 복원)
- 멀티 조직 / 팀
- 시계열 DB 샤딩

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [시스템 아키텍처](/architecture/system.md)
