---
type: API Reference
title: 이슈 API
description: 이슈 목록/상세/이벤트/통계 조회 및 상태 변경 엔드포인트. JWT 인증 + 프로젝트 소유권 스코프.
resource: packages/server/src/modules/issues/routes.ts
tags: [api, issues, events, stats, pagination]
timestamp: 2026-06-16
---

# 이슈 API

프로젝트 내 이슈를 관리하는 엔드포인트. **모든 라우트에 JWT 인증(`requireAuth`) 필수**. 서비스 레이어에서 요청 사용자가 해당 프로젝트 소유자인지 확인한다.

## 엔드포인트 (prefix: `/api/projects`)

### GET `/:id/issues`
이슈 목록 조회 (페이지네이션 포함).

**쿼리 파라미터:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `status` | unresolved\|resolved\|ignored | - | 상태 필터 |
| `query` | string | - | 제목 부분 검색 (대소문자 무관) |
| `sort` | lastSeen\|firstSeen\|timesSeen | `lastSeen` | 정렬 기준 (항상 내림차순) |
| `limit` | 1–100 | 50 | 페이지당 항목 수 |
| `cursor` | string | - | 커서 기반 페이지네이션 (이전 응답의 `nextCursor`) |
| `page` | ≥1 | 1 | 오프셋 기반 페이지. `cursor` 있으면 무시. 오프셋 상한: **10,000** |

**응답 200:** `{ issues: IssueListItem[], nextCursor: string | null }`

### GET `/:id/issues/:issueId`
이슈 상세 조회 (최신 이벤트 요약 포함).

**응답 200:** `{ issue: IssueListItem & { latestEvent: EventSummary | null } }`

### GET `/:id/issues/:issueId/events`
이슈에 속한 이벤트 목록 (스택트레이스·breadcrumbs 등 전체 포함). `receivedAt` 내림차순.

**쿼리:** `limit` (1–100, 기본 50), `cursor`, `page`. 오프셋 상한 동일.

**응답 200:** `{ events: EventDetail[], nextCursor: string | null }`

### GET `/:id/issues/:issueId/stats`
이벤트 발생 빈도 버킷 통계 (PostgreSQL `date_trunc` GROUP BY).

**쿼리:** `window` = `24h`(시간 버킷) | `7d`(일 버킷). 기본 `24h`.

**응답 200:** `{ buckets: { bucket: string, count: number }[] }` (ISO datetime 문자열 정렬)

### PATCH `/:id/issues/:issueId`
이슈 상태 변경.

**바디:** `{ status: "unresolved" | "resolved" | "ignored" }`

**응답 200:** `{ issue: IssueListItem }`

> `resolved` → 새 이벤트 수신 시 Worker가 자동으로 `unresolved`로 되돌림 (regression). `ignored`는 되돌리지 않는다.

## 응답 타입

**IssueListItem:**
```
id, title, culprit(nullable), level, status, timesSeen, firstSeen(ISO), lastSeen(ISO)
```

**EventSummary:**
```
id, message, exceptionType, exceptionValue, level, environment, release, timestamp(ISO), receivedAt(ISO)
```

**EventDetail** = EventSummary + `stacktrace, breadcrumbs, tags, userContext, contexts, sdkName, sdkVersion, requestUrl`

## 관련 개념
- [인제스트 API](/api/ingest-api.md)
- [알림 API](/api/alerts-api.md)
- [데이터 모델](/database/data-model.md)
- [시스템 아키텍처](/architecture/system.md)
