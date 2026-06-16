---
type: API Reference
title: 인증 API
description: 회원가입/로그인/토큰 회전/로그아웃/현재 사용자 조회. JWT 액세스 토큰 + httpOnly 리프레시 쿠키.
resource: packages/server/src/modules/auth/routes.ts
tags: [api, auth, jwt, fastify]
timestamp: 2026-06-16
---

# 인증 API

- 베이스 경로: `/api/auth`
- 출처: `packages/server/src/modules/auth/routes.ts`, `schemas.ts`
- 인증 방식: **액세스 토큰**(JWT, 응답 바디로 전달) + **리프레시 토큰**(httpOnly 쿠키 `mini_sentry_refresh`, path `/api/auth`, sameSite=strict)
- 레이트 리밋: register/login/refresh/logout = **1분당 10회**

## 엔드포인트

### POST /register — 회원가입
- Body: `email`, `password`(≥8), `name?`(1~120)
- 201: `{ accessToken, user: { id, email, name, createdAt } }` + 리프레시 쿠키 설정

### POST /login — 로그인
- Body: `email`, `password`
- 200: `{ accessToken, user }` + 리프레시 쿠키 설정

### POST /refresh — 액세스 토큰 재발급(리프레시 회전)
- 쿠키의 리프레시 토큰 사용(없으면 401). 토큰 회전(rotate) 후 새 쿠키 설정.
- 200: `{ accessToken, user }`

### POST /logout — 로그아웃
- 쿠키의 리프레시 토큰 폐기 + 쿠키 제거
- 200: `{ ok: true }`

### GET /me — 현재 사용자
- 인증 필요(`requireAuth`, Bearer 액세스 토큰)
- 200: `{ id, email, name, createdAt }`

## 에러 형식(공통)
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```
주요 코드: `VALIDATION_ERROR`(400) · `RATE_LIMITED`(429) · `NOT_FOUND`(404) · `INTERNAL_SERVER_ERROR`(500). 인증 누락 시 401.

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [데이터 모델](/database/data-model.md)(User, RefreshToken) · [프로젝트 API](/api/projects-api.md)
