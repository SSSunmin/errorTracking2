---
type: API Reference
title: 프로젝트 API
description: 프로젝트와 프로젝트 키(DSN) CRUD. 전 엔드포인트 인증 필요.
resource: packages/server/src/modules/projects/routes.ts
tags: [api, projects, keys, dsn, fastify]
timestamp: 2026-06-16
---

# 프로젝트 API

- 베이스 경로: `/api/projects`
- 출처: `packages/server/src/modules/projects/routes.ts`, `schemas.ts`
- 인증: **모든 엔드포인트 인증 필요**(`preHandler: requireAuth`). 본인 소유 프로젝트만 접근.

## 프로젝트

### GET / — 내 프로젝트 목록
- 200: `{ projects: [{ id, name, slug, platform, createdAt, updatedAt, keyCount }] }`

### POST / — 프로젝트 생성
- Body: `name`(1~120), `slug?`(1~80), `platform?`(1~80)
- 201: `{ project, key, dsn }` (기본 키 1개 + DSN 함께 발급)

### GET /:id — 단건 조회
- 200: `{ project: { id, name, slug, platform, createdAt, updatedAt } }`

### PATCH /:id — 수정
- Body: `name?`, `platform?`
- 200: `{ project }`

### DELETE /:id — 삭제
- 204: 본문 없음 (연관 키/이슈/이벤트/알림은 Cascade 삭제)

## 프로젝트 키 (DSN)

### GET /:id/keys — 키 목록
- 200: `{ keys: [ProjectKey] }`

### POST /:id/keys — 키 생성
- Body: `label?`(1~120)
- 201: `{ key, dsn }`

### POST /:id/keys/:keyId/rotate — 키 회전
- 201: `{ key, dsn }` (새 publicKey 발급)

### PATCH /:id/keys/:keyId — 키 수정(활성화 토글)
- Body: `isActive`(boolean)
- 200: `{ key, dsn }`

### ProjectKey 응답 형태
`{ id, projectId, publicKey, label, isActive, lastUsedAt, createdAt, dsn }`

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [데이터 모델](/database/data-model.md)(Project, ProjectKey) · [인증 API](/api/auth-api.md)
