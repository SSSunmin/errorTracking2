---
type: Architecture
title: 인증 플로우
description: 액세스(JWT) + 리프레시(불투명 토큰) 이중 토큰, 리프레시 회전·재사용 탐지, 비밀번호 해싱.
resource: packages/server/src/lib/tokens.ts
tags: [auth, jwt, refresh-token, security]
timestamp: 2026-06-16
---

# 인증 플로우

출처: `lib/tokens.ts`, `modules/auth/service.ts`, `plugins/auth.ts`.

## 토큰 종류
- **액세스 토큰**: JWT(HS256, `JWT_ACCESS_SECRET` 서명), 만료 **15분**, `sub`=userId, `jti`=uuid. 응답 바디로 전달, 요청 시 `Authorization: Bearer`.
- **리프레시 토큰**: **불투명 랜덤** 32바이트 hex(JWT 아님). DB에는 `sha256` 해시만 저장. 만료 **7일**. httpOnly 쿠키 `mini_sentry_refresh`(path `/api/auth`, sameSite=strict, prod에서 secure).

## 비밀번호
- **argon2id** 해시(memoryCost 65536, timeCost 3, parallelism 1). `passwordHash`만 저장.

## 흐름
- **register**: argon2 해시 → 트랜잭션으로 User 생성 + 토큰쌍 발급. 이메일 중복(P2002) → `409 CONFLICT`.
- **login**: 이메일 조회 + argon2 검증 실패 시 `401`("Invalid email or password"). 성공 시 토큰쌍 발급.
- **refresh (회전)**: 쿠키 토큰 해시로 조회 →
  - 없음/만료 → `401`.
  - **이미 폐기된 토큰 재사용 감지** → 해당 유저의 살아있는 리프레시 토큰을 **전부 폐기**하고 `401` (토큰 탈취 대응).
  - 정상 → 새 리프레시 토큰 생성, 기존 토큰 `revokedAt`+`replacedByTokenHash` 기록(회전).
- **logout**: 쿠키 토큰 해시로 살아있는 토큰 폐기 + 쿠키 제거.

## 액세스 토큰 검증 (`requireAuth`)
- `Authorization: Bearer <token>` 파싱 → `jwtVerify`(HS256) → `sub` 필수. 실패 시 `401`.
- 성공 시 `request.user = { id: sub }` 주입. 보호 라우트는 `preHandler: requireAuth`.

## 레이트 리밋
- auth 라우트(register/login/refresh/logout): **1분당 10회**.

## 관련 개념
- [인증 API](/api/auth-api.md) · [데이터 모델](/database/data-model.md)(User, RefreshToken) · [환경설정](/config/environment.md) · [결정 기록](/decisions/decisions.md)
