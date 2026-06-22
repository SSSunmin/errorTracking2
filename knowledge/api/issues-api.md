---
type: API Reference
title: 이슈 API
description: 이슈 목록/상세/이벤트/통계/스냅샷/리플레이 조회 및 상태 변경 엔드포인트. JWT 인증 + 프로젝트 소유권 스코프.
resource: packages/server/src/modules/issues/routes.ts
tags: [api, issues, events, stats, pagination, snapshot, replay]
timestamp: 2026-06-19
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

### GET `/:id/issues/:issueId/events/:eventId/snapshot`
이벤트의 DOM 스냅샷을 조회한다. **JWT 인증 필수.**

**응답 200:** `{ snapshot: { data: unknown, href: string | null, width: number | null, height: number | null } | null }`

- 스냅샷이 없는 이벤트는 `snapshot: null` 반환.
- 호출 전 `EventDetail.hasSnapshot`으로 존재 여부를 먼저 확인하는 것이 권장 패턴(대시보드가 이 방식 사용).
- `data`는 rrweb-snapshot이 직렬화한 DOM 트리 원본(불투명 JSON). 최대 약 1MB.

### GET `/:id/issues/:issueId/events/:eventId/replay`
이벤트에 연결된 세션 리플레이 녹화 데이터를 조회한다. **JWT 인증 필수.**

**응답**:
- **200**: `Content-Type: application/json`, `Content-Encoding: gzip` — gzip 바이트 그대로 전송. 브라우저가 자동 압축 해제해 rrweb events JSON 배열로 수신. Fastify-Zod 직렬화 우회(바이너리 전송).
- **404**: `{ error: { code: "NOT_FOUND", message: "Replay not found" } }` — 이벤트에 `clientEventId` 없거나 `EventReplay` 미존재 시.

- 호출 전 `EventDetail.hasReplay`로 존재 여부를 먼저 확인하는 것이 권장 패턴(대시보드가 이 방식 사용).
- 세부 동작은 [세션 리플레이 API](/api/replay-api.md) 참고.

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

**EventDetail** = EventSummary + `stacktrace, breadcrumbs, tags, userContext, contexts, sdkName, sdkVersion, requestUrl, userAgent, hasSnapshot, hasReplay`

- `hasSnapshot: boolean` — 해당 이벤트에 DOM 스냅샷(feature B)이 존재하는지 여부. `true`일 때 스냅샷 엔드포인트로 실제 데이터 조회 가능.
- `hasReplay: boolean` — 해당 이벤트에 세션 리플레이 녹화(feature C)가 존재하는지 여부. 서비스 레이어가 이벤트 페이지의 `clientEventId` 목록을 한 번의 쿼리로 `EventReplay` 테이블과 대조해 산출한다. `true`일 때 리플레이 엔드포인트로 조회 가능.

> `contexts`에는 서버가 User-Agent에서 파싱한 `browser`/`os`/`device`가 포함되며, `userAgent`는 원문 문자열이다.

## 관련 개념
- [인제스트 API](/api/ingest-api.md)
- [세션 리플레이 API](/api/replay-api.md)
- [알림 API](/api/alerts-api.md)
- [데이터 모델](/database/data-model.md)
- [시스템 아키텍처](/architecture/system.md)
