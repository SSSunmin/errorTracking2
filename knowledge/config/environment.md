---
type: Config
title: 환경설정 (env)
description: 서버 환경변수 — DB·JWT 시크릿·포트·CORS·DSN. Zod로 부팅 시 검증.
resource: packages/server/src/config/env.ts
tags: [config, env, secrets]
timestamp: 2026-06-16
---

# 환경설정

`config/env.ts`에서 `.env`(레포 루트)를 읽고 **Zod로 부팅 시 검증**한다. 누락/형식 오류면 기동 실패.

## 변수

| 변수 | 필수 | 기본/제약 | 용도 |
|---|---|---|---|
| `NODE_ENV` | - | development/test/production (기본 development) | 실행 모드 |
| `DATABASE_URL` | ✅ | URL | PostgreSQL 접속 |
| `TEST_DATABASE_URL` | - | URL | test 모드 시 DB 대체 |
| `JWT_ACCESS_SECRET` | ✅ | 최소 32자 | 액세스 토큰(JWT) 서명 |
| `JWT_REFRESH_SECRET` | ✅ | 최소 32자 | (검증되나 현재 토큰 발급 코드는 액세스 시크릿만 사용 — 리프레시는 불투명 랜덤 토큰) |
| `API_PORT` | - | 기본 4000 | API 포트 |
| `DASHBOARD_PORT` | - | 기본 5173 | 대시보드 포트 |
| `CORS_ORIGIN` | 조건부 | URL | CORS 허용 오리진. **production에선 필수** |
| `DSN_HOST` | - | 기본 `localhost:<API_PORT>` | DSN 호스트 |
| `DSN_SCHEME` | - | http/https (기본: prod=https, 그 외 http) | DSN 스킴 |

## 파생 기본값
- `CORS_ORIGIN` 미지정 시 → `http://localhost:<DASHBOARD_PORT>`
- `DSN_HOST` 미지정 시 → `localhost:<API_PORT>`
- test 모드 + `TEST_DATABASE_URL` 있으면 → `DATABASE_URL` 대신 사용

## 주의
- 시크릿(`.env`)은 커밋 금지. `.env.example`로 형태만 공유.

## 관련 개념
- [인증 플로우](/architecture/auth-flow.md) · [시스템 아키텍처](/architecture/system.md) · [운영 런북](/ops/runbook.md)
