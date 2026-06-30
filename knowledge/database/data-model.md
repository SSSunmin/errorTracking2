---
type: Database Schema
title: 데이터 모델 (Prisma / PostgreSQL)
description: Mini-Sentry의 13개 Prisma 모델, 관계, 인덱스, enum. 출처는 packages/server/prisma/schema.prisma.
resource: packages/server/prisma/schema.prisma
tags: [database, prisma, postgresql, schema, replay, sourcemap, symbolication, assignee, comments]
timestamp: 2026-06-23
---

# 데이터 모델

PostgreSQL + Prisma. ID는 모두 `cuid()`. 출처: `packages/server/prisma/schema.prisma`.

> 엔티티 관계 다이어그램은 별도 개념으로 분리: **[ERD](/database/erd.md)**.

## 모델

### User — 계정
`id` · `email`(unique) · `passwordHash` · `name?` · `createdAt` · `updatedAt`
관계: `projects[]`(소유), `memberships[]`(ProjectMember), `refreshTokens[]`, `assignedIssues[]`(IssueAssignee), `comments[]`(IssueComment)

### Project — 모니터링 대상 프로젝트
`id` · `name` · `slug`(unique) · `platform`(기본 `javascript-browser`) · `ownerId` → User(onDelete: Cascade) · `createdAt` · `updatedAt`
관계: `keys[]`, `issues[]`, `events[]`, `alertRules[]`, `sourceMaps[]`, `members[]`(ProjectMember) / 인덱스: `@@index([ownerId])`

> `ownerId`는 **소유자 포인터**(항상 ProjectMember에 role=owner로도 존재). 접근제어 자체는 멤버십 기반(아래 ProjectMember 참고). 마이그레이션: `20260623120000_project_membership`(소유자 백필 포함).

### ProjectMember — 프로젝트 멤버십(팀/접근제어, P3)
`id` · `projectId` → Project(onDelete: Cascade) · `userId` → User(onDelete: Cascade) · `role`(ProjectRole, 기본 member) · `createdAt`
제약: `@@unique([projectId, userId])` / 인덱스: `@@index([userId])`

> 접근제어의 단위. **멤버(owner|member)면 그 프로젝트의 모든 기존 기능**(프로젝트/이슈/이벤트/스냅샷/리플레이/통계/소스맵/알림/키)에 읽기·쓰기 가능. 4개 서비스(`projects`/`issues`/`sourcemaps`/`alert-rules`)의 접근 헬퍼가 `members: { some: { userId } }`로 검사한다. **owner 전용**: (1) 프로젝트 삭제(`Project.ownerId`로 한정), (2) 멤버 관리(추가/역할변경/삭제 — `userId === Project.ownerId` 판정). 소유자는 강등·제거 불가. 마이그레이션: `20260623120000_project_membership`.

### ProjectKey — 인제스트용 공개키(DSN의 기반)
`id` · `projectId` → Project(Cascade) · `publicKey`(unique) · `label?` · `isActive`(기본 true) · `lastUsedAt?` · `createdAt`
인덱스: `@@index([projectId])`

### Issue — 묶인 에러 그룹
`id` · `projectId` → Project(Cascade) · `fingerprint` · `title` · `culprit?` · `firstRelease?` · `level`(IssueLevel, 기본 error) · `status`(IssueStatus, 기본 unresolved) · `timesSeen`(기본 0) · `firstSeen` · `lastSeen` · `createdAt` · `updatedAt` · `assigneeId?` → User(onDelete: SetNull)
관계: `assignee User?`(IssueAssignee), `comments[]`(IssueComment)
제약: `@@unique([projectId, fingerprint])` / 인덱스: `@@index([projectId, status])`, `@@index([projectId, lastSeen])`, `@@index([assigneeId])`

> `assigneeId`: 이슈 담당자(P3). `PATCH /:id/issues/:issueId/assignee`로 지정/해제하며, 지정 대상은 **해당 프로젝트의 멤버여야** 한다(서비스 레이어 검증, 비멤버는 400). `onDelete: SetNull`이라 담당자 계정 삭제 시 자동 해제. 마이그레이션: `20260623130000_issue_assignee_comments`.

### IssueComment — 이슈 코멘트 스레드(P3)
`id` · `issueId` → Issue(onDelete: Cascade) · `authorId` → User(onDelete: Cascade) · `body` · `createdAt`
인덱스: `@@index([issueId, createdAt])`

> 멤버라면 누구나 작성·조회 가능. 삭제는 **작성자 본인 또는 owner-role 멤버**만(그 외 403). 목록은 `createdAt` 오름차순·최대 200건. 마이그레이션: `20260623130000_issue_assignee_comments`.

> `firstRelease`(`String?`): 이슈가 **최초 생성**될 때 그 이벤트의 `release` 값으로 기록(없으면 null). 릴리스 회귀 보기에서 "이 릴리스에서 처음 등장한 신규 이슈" 판별에 사용. 마이그레이션: `20260623120000_release_regression_tracking`.

### Event — 개별 에러 발생 1건
`id` · `issueId` → Issue(Cascade) · `projectId` → Project(Cascade) · `message?` · `exceptionType?` · `exceptionValue?` · `stacktrace?`(Json) · `symbolicated?`(Json) · `breadcrumbs?`(Json) · `tags?`(Json) · `userContext?`(Json) · `contexts?`(Json) · `level`(IssueLevel) · `environment?` · `release?` · `isRegression Boolean`(기본 false) · `sdkName?` · `sdkVersion?` · `requestUrl?` · `userAgent?` · `timestamp` · `receivedAt` · `clientEventId String?`
관계: `snapshot EventSnapshot?`(back-relation, 0 또는 1개)
인덱스: `@@index([issueId, receivedAt])`, `@@index([projectId, receivedAt])`, `@@index([projectId, release, isRegression])`, `@@index([clientEventId])`

> `isRegression`(`Boolean @default(false)`): 이 이벤트가 **회귀를 일으킨** 이벤트인지 여부. resolved 이슈가 새 이벤트로 unresolved 복귀하는 바로 그 이벤트에만 `true`. `@@index([projectId, release, isRegression])`로 릴리스별 회귀 이벤트 조회. 마이그레이션: `20260623120000_release_regression_tracking`.

> `symbolicated`: 소스맵 심볼리케이션 결과 캐시(`Json?`, JSONB). 이벤트 조회 시 lazy 심볼리케이션 후 `{ frames: [...] }` 형태로 채운다. 소스맵 재업로드 시 해당 릴리스 이벤트 전체에 `updateMany`로 `null` 무효화된다. 마이그레이션: `20260622000000_add_source_map`.

> `clientEventId`: SDK가 이벤트 전송 페이로드에 포함한 클라이언트 생성 UUID(`eventId` 필드). 세션 리플레이(feature C)와의 논리적 연결고리로 사용. `EventReplay`에 외래 키가 없으며, 리플레이가 이벤트보다 먼저 도착할 수 있어 DB 레벨 FK 대신 `clientEventId`로 join한다. 마이그레이션: `20260618083417_add_event_replay`.

> `userAgent`(원문)와 `contexts.{browser,os,device}`는 인제스트 시 요청 User-Agent를 서버가 `ua-parser-js`로 파싱해 채운다([인제스트 파이프라인](/architecture/ingestion-pipeline.md)의 enrichment). SDK가 `contexts`를 직접 보내면 그 값이 우선한다.

### EventSnapshot — 에러 발생 시점 DOM 스냅샷
`id` · `eventId`(unique) → Event(onDelete: Cascade) · `projectId` · `data`(Json, rrweb-snapshot 직렬화 트리) · `href?` · `width?`(Int) · `height?`(Int) · `createdAt`
인덱스: `@@index([projectId])`

> Event와 1:1 관계(`eventId` unique). 마이그레이션: `20260618065758_add_event_snapshot`. 저장은 메인 트랜잭션 **바깥**에서 best-effort로 수행 — 스냅샷 저장 실패가 이벤트 자체를 롤백하지 않는다(`process.ts`). `data` 컬럼은 PostgreSQL `JSONB`. `EventSnapshot`은 `Project`에 대한 직접 FK가 **없으며** `projectId`는 비정규화 필드다(project-scope 쿼리 최적화용).

### EventReplay — 세션 리플레이 녹화 데이터 (feature C)
`id` · `clientEventId`(unique) · `projectId` · `data`(Bytes, gzip 압축 rrweb events JSON) · `eventCount?`(Int) · `durationMs?`(Int) · `sizeBytes?`(Int) · `createdAt`
인덱스: `@@index([projectId])`

> `Event`와 직접 FK 관계가 없다. `clientEventId`로 논리적 연결 — SDK가 에러 이벤트와 동일한 `eventId`(UUID)를 리플레이 업로드의 `?eventId=` 쿼리 파라미터로 전달한다. 리플레이가 이벤트 처리보다 먼저 도착할 수 있으므로 FK 대신 upsert(`clientEventId` unique)로 중복을 처리한다. `data`는 PostgreSQL `BYTEA`(Prisma Bytes). 서버는 gzip 바이트를 **그대로 저장**하고 읽을 때도 그대로 내려보낸다(재압축 없음). 마이그레이션: `20260618083417_add_event_replay`.

> `projectId`는 비정규화 필드(project-scope 쿼리 최적화용). `Project`에 대한 직접 FK는 없다.

### SourceMap — 소스맵 (심볼리케이션용)
`id` · `projectId` → Project(Cascade) · `release` · `filename`(미니파이 artifact basename) · `data`(Bytes, gzip된 소스맵 JSON) · `sizeBytes?`(Int) · `createdAt` · `updatedAt`
제약: `@@unique([projectId, release, filename])` / 인덱스: `@@index([projectId, release])`

> `filename`은 업로드 시 `frameBasename()`이 추출한 basename 값이다(URL/경로/쿼리·해시 제거 후 basename). 스택 프레임의 filename basename과 매칭 키로 사용된다. `data`는 PostgreSQL `BYTEA`(Prisma Bytes). 업로드 시 서버가 비동기 gzip 압축해 저장. 조회 시 gunzip해 메모리에서 사용. 마이그레이션: `20260622000000_add_source_map`(모델·인덱스·Event.symbolicated 컬럼), `20260622000100_source_map_project_fk`(Project FK + Cascade).

### AlertRule — 알림 규칙
`id` · `projectId` → Project(Cascade) · `name` · `channel`(AlertChannel) · `target` · `condition`(AlertCondition) · `threshold?` · `windowMinutes?` · `cooldownMinutes?` · `baselineMinutes?` · `spikeMultiplier?`(Decimal(5,2)) · `minEvents?` · `isActive`(기본 true) · `createdAt` · `updatedAt`
인덱스: `@@index([projectId])`

> `cooldownMinutes`: `condition=regression|event_threshold|event_spike`일 때 의미를 가진다. regression은 미지정 시 서버 기본값 60분, threshold/spike는 미지정 시 `windowMinutes`로 dedup 윈도를 폴백한다. `new_issue`에서는 서비스 레이어(`normalizeCooldownMinutes`)가 null로 강제 저장한다. 마이그레이션: `20260616045858_alert_rule_cooldown`.
>
> `event_spike`: 이슈별 급증 감지 조건. `windowMinutes`는 최근 구간, `baselineMinutes`는 최근 구간을 제외한 베이스라인 상한(`[now-baselineMinutes, now-windowMinutes)`), `spikeMultiplier`는 분당 율 비교 배수, `minEvents`는 최근 구간 최소 건수다. 마이그레이션: `20260630062634_alert_event_spike`.

### RefreshToken — 리프레시 토큰(회전/폐기 추적)
`id` · `userId` → User(Cascade) · `tokenHash`(unique) · `expiresAt` · `revokedAt?` · `replacedByTokenHash?` · `createdAt`
인덱스: `@@index([userId])`

### Notification — 알림 전송 기록(디듀프 + 감사)
`id` · `alertRuleId` → AlertRule(Cascade) · `issueId` → Issue(Cascade) · `channel`(AlertChannel) · `status`(NotificationStatus) · `error?` · `sentAt`(기본 now)
인덱스: `@@index([alertRuleId, issueId])`
> 워커가 알림 발송 전 advisory lock 아래 `pending` 행을 선점(claim)해 동시성 중복 발송을 막고, 발송 결과를 `sent`/`failed`로 갱신한다. [알림 규칙 API](/api/alerts-api.md) 참고.

## Enum
- `IssueLevel`: debug · info · warning · error · fatal
- `IssueStatus`: unresolved · resolved · ignored
- `AlertChannel`: email · slack
- `AlertCondition`: new_issue · regression · event_threshold · event_spike
- `NotificationStatus`: pending · sent · failed
- `ProjectRole`: owner · member

## 관련 개념
- [프로젝트 개요](/overview/mini-sentry.md) · [프로젝트 API](/api/projects-api.md) · [인증 API](/api/auth-api.md) · [이슈 API](/api/issues-api.md) · [인제스트 API](/api/ingest-api.md) · [소스맵 API](/api/sourcemaps-api.md)
