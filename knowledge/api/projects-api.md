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
- 인증: **모든 엔드포인트 인증 필요**(`preHandler: requireAuth`).
- 접근제어: **멤버십 기반**(P3). 그 프로젝트의 멤버(owner|member)면 모든 프로젝트/키 기능에 접근. 예외 — **프로젝트 삭제와 멤버 관리(추가/역할변경/삭제)는 owner 전용**(`Project.ownerId` 한정). 비멤버는 404(존재 비노출), 멤버이지만 비owner가 owner 전용 작업 시도 시 멤버 관리는 403, 프로젝트 삭제는 404. 출처: [데이터 모델 ProjectMember](/database/data-model.md).

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

## 멤버 관리 (팀, P3)

멤버 응답 형태: `{ userId, email, name|null, role("owner"|"member"), createdAt }`

### GET /:id/members — 멤버 목록
- 접근: **멤버**(팀 확인용)
- 200: `{ members: [ProjectMember] }`

### POST /:id/members — 멤버 추가
- 접근: **owner 전용**
- Body: `email`, `role?`(`"member"|"owner"`, 기본 member)
- 201: `{ member }`
- 오류: 등록된 User 없음 404 · 이미 멤버 409

### PATCH /:id/members/:userId — 역할 변경
- 접근: **owner 전용**
- Body: `role`(`"owner"|"member"`)
- 200: `{ member }`
- 오류: 멤버 아님 404 · 소유자(`Project.ownerId`) owner→강등 시도 400

### DELETE /:id/members/:userId — 멤버 제거
- 접근: **owner 전용**
- 204: 본문 없음
- 오류: 멤버 아님 404 · 소유자(`Project.ownerId`) 제거 시도 400

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [데이터 모델](/database/data-model.md)(Project, ProjectKey) · [인증 API](/api/auth-api.md)
