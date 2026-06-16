---
type: Database Schema
title: 데이터 모델 (Prisma / PostgreSQL)
description: Mini-Sentry의 7개 Prisma 모델, 관계, 인덱스, enum. 출처는 packages/server/prisma/schema.prisma.
resource: packages/server/prisma/schema.prisma
tags: [database, prisma, postgresql, schema]
timestamp: 2026-06-16
---

# 데이터 모델

PostgreSQL + Prisma. ID는 모두 `cuid()`. 출처: `packages/server/prisma/schema.prisma`.

> 엔티티 관계 다이어그램은 별도 개념으로 분리: **[ERD](/database/erd.md)**.

## 모델

### User — 계정
`id` · `email`(unique) · `passwordHash` · `name?` · `createdAt` · `updatedAt`
관계: `projects[]`, `refreshTokens[]`

### Project — 모니터링 대상 프로젝트
`id` · `name` · `slug`(unique) · `platform`(기본 `javascript-browser`) · `ownerId` → User(onDelete: Cascade) · `createdAt` · `updatedAt`
관계: `keys[]`, `issues[]`, `events[]`, `alertRules[]` / 인덱스: `@@index([ownerId])`

### ProjectKey — 인제스트용 공개키(DSN의 기반)
`id` · `projectId` → Project(Cascade) · `publicKey`(unique) · `label?` · `isActive`(기본 true) · `lastUsedAt?` · `createdAt`
인덱스: `@@index([projectId])`

### Issue — 묶인 에러 그룹
`id` · `projectId` → Project(Cascade) · `fingerprint` · `title` · `culprit?` · `level`(IssueLevel, 기본 error) · `status`(IssueStatus, 기본 unresolved) · `timesSeen`(기본 0) · `firstSeen` · `lastSeen` · `createdAt` · `updatedAt`
제약: `@@unique([projectId, fingerprint])` / 인덱스: `@@index([projectId, status])`, `@@index([projectId, lastSeen])`

### Event — 개별 에러 발생 1건
`id` · `issueId` → Issue(Cascade) · `projectId` → Project(Cascade) · `message?` · `exceptionType?` · `exceptionValue?` · `stacktrace?`(Json) · `breadcrumbs?`(Json) · `tags?`(Json) · `userContext?`(Json) · `contexts?`(Json) · `level`(IssueLevel) · `environment?` · `release?` · `sdkName?` · `sdkVersion?` · `requestUrl?` · `userAgent?` · `timestamp` · `receivedAt`
인덱스: `@@index([issueId, receivedAt])`, `@@index([projectId, receivedAt])`

### AlertRule — 알림 규칙
`id` · `projectId` → Project(Cascade) · `name` · `channel`(AlertChannel) · `target` · `condition`(AlertCondition) · `threshold?` · `windowMinutes?` · `isActive`(기본 true) · `createdAt` · `updatedAt`
인덱스: `@@index([projectId])`

### RefreshToken — 리프레시 토큰(회전/폐기 추적)
`id` · `userId` → User(Cascade) · `tokenHash`(unique) · `expiresAt` · `revokedAt?` · `replacedByTokenHash?` · `createdAt`
인덱스: `@@index([userId])`

## Enum
- `IssueLevel`: debug · info · warning · error · fatal
- `IssueStatus`: unresolved · resolved · ignored
- `AlertChannel`: email · slack
- `AlertCondition`: new_issue · regression · event_threshold

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [프로젝트 API](/api/projects-api.md) · [인증 API](/api/auth-api.md)
