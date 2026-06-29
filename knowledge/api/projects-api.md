---
type: API Reference
title: 프로젝트 API
description: 프로젝트와 프로젝트 키(DSN) CRUD + 프로젝트 단위 이벤트 통계(stats). 전 엔드포인트 인증 필요.
resource: packages/server/src/modules/projects/routes.ts
tags: [api, projects, keys, dsn, fastify, stats]
timestamp: 2026-06-23
---

# 프로젝트 API

- 베이스 경로: `/api/projects`
- 출처: `packages/server/src/modules/projects/routes.ts`, `schemas.ts`
- 인증: **모든 엔드포인트 인증 필요**(`preHandler: requireAuth`).
- 접근제어: **멤버십 기반**(P3). 비멤버는 전 엔드포인트 404(존재 비노출). 멤버(owner|member)는 **읽기**(프로젝트/키/멤버 조회)와 이슈 작업에 접근. **owner 역할 전용 작업**: 프로젝트 설정 수정(PATCH /:id), DSN 키 관리(생성/회전/토글), 멤버 관리(추가/역할변경/삭제) — 비owner 멤버가 시도하면 403. **프로젝트 삭제는 founder(`Project.ownerId`) 전용** — 다른 멤버는 403. 출처: [데이터 모델 ProjectMember](/database/data-model.md).

## 프로젝트

### GET / — 내 프로젝트 목록
- 200: `{ projects: [{ id, name, slug, platform, createdAt, updatedAt, keyCount }] }`

### POST / — 프로젝트 생성
- Body: `name`(1~120), `slug?`(1~80), `platform?`(1~80)
- 201: `{ project, key, dsn }` (기본 키 1개 + DSN 함께 발급)

### GET /:id — 단건 조회
- 200: `{ project: { id, name, slug, platform, createdAt, updatedAt } }`

### PATCH /:id — 수정
- 접근: **owner 역할 전용** (비owner 멤버 403)
- Body: `name?`, `platform?`
- 200: `{ project }`

### DELETE /:id — 삭제
- 접근: **founder(`Project.ownerId`) 전용** (다른 멤버 403)
- 204: 본문 없음 (연관 키/이슈/이벤트/알림은 Cascade 삭제)

### GET /:id/stats — 프로젝트 단위 이벤트 통계
프로젝트 **전체 이벤트**(모든 이슈 합산)에 대한 발생 빈도 버킷 통계. PostgreSQL `date_trunc` GROUP BY.

- Query: `window` = `24h`(시간 버킷) | `7d`(일 버킷). 기본 `24h`.
- 200: `{ buckets: { bucket: string, count: number, users: number }[], totalEvents: number, affectedUsers: number }`
  - `buckets` — ISO datetime 문자열 정렬. `count`=버킷 내 이벤트 수, `users`=버킷 내 distinct `userContext->>'id'`(영향 사용자 시계열).
  - `totalEvents` — window 내 전체 이벤트 수.
  - `affectedUsers` — window 내 distinct `userContext->>'id'`(= SDK `user.id`) 개수. `user.id` 없는 이벤트 제외, 이메일 등 fallback은 범위 외. **window 전체 합계라 버킷별 `users`의 단순 합과 다르다**(같은 사용자가 여러 버킷에 걸쳐도 합계에선 1회).
- 소유권 미보유 시 404 (`getProject`와 동일 패턴).

## 프로젝트 키 (DSN)

키 변경(생성/회전/토글)은 **owner 역할 전용** — DSN은 SDK 인증정보. 목록 조회(GET)는 멤버 누구나.

### GET /:id/keys — 키 목록
- 200: `{ keys: [ProjectKey] }`

### POST /:id/keys — 키 생성
- 접근: **owner 역할 전용** (비owner 멤버 403)
- Body: `label?`(1~120)
- 201: `{ key, dsn }`

### POST /:id/keys/:keyId/rotate — 키 회전
- 접근: **owner 역할 전용** (비owner 멤버 403)
- 201: `{ key, dsn }` (새 publicKey 발급)

### PATCH /:id/keys/:keyId — 키 수정(활성화 토글)
- 접근: **owner 역할 전용** (비owner 멤버 403)
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
