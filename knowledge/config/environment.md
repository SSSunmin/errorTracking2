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
| `REDIS_URL` | ✅ | URL | BullMQ 큐(Redis) 접속 — 인제스트→워커 |
| `SMTP_HOST` / `SMTP_PORT` | - | host / 포트 | 이메일 알림 SMTP 서버 |
| `SMTP_USER` / `SMTP_PASSWORD` | - | 자격증명 | SMTP 인증 |
| `SMTP_FROM` | - | 보내는 주소 | 이메일 From (SMTP 설정 시 필수) |

> 4개 SMTP 자격증명(HOST·PORT·USER·PASSWORD)이 모두 있어야 실제 SMTP 전송. 미설정 시 Nodemailer `jsonTransport`로 폴백(개발: 페이로드 로그만). **Slack 알림 대상은 환경변수가 아니라 AlertRule의 `target`(hooks.slack.com URL)** 으로 지정한다. [알림 규칙 API](/api/alerts-api.md) 참고.

## 파생 기본값
- `CORS_ORIGIN` 미지정 시 → `http://localhost:<DASHBOARD_PORT>`
- `DSN_HOST` 미지정 시 → `localhost:<API_PORT>`
- test 모드 + `TEST_DATABASE_URL` 있으면 → `DATABASE_URL` 대신 사용

## 주의
- 시크릿(`.env`)은 커밋 금지. `.env.example`로 형태만 공유.
- 로컬 개발 머신은 포트 충돌 회피로 비표준 포트(Postgres 5433 / Redis 6380 / API 4100)를 쓸 수 있음(.env). `.env.example`은 표준 기본값.

## 관련 개념
- [인증 플로우](/architecture/auth-flow.md) · [시스템 아키텍처](/architecture/system.md) · [운영 런북](/ops/runbook.md)
