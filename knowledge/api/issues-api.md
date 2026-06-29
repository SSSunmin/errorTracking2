---
type: API Reference
title: 이슈 API
description: 이슈 목록/상세/이벤트/통계/스냅샷/리플레이 조회 및 상태 변경 엔드포인트. JWT 인증 + 프로젝트 멤버십 스코프. 이벤트 조회 시 소스맵 심볼리케이션 lazy 적용. level/release/environment/since/until 필터 + 필터 자동완성용 facets 엔드포인트 + 담당자(assignee)·코멘트 + 릴리스 회귀 보기(P3).
resource: packages/server/src/modules/issues/routes.ts
tags: [api, issues, events, stats, pagination, snapshot, replay, symbolication, filter, assignee, comments, release, regression]
timestamp: 2026-06-23
---

# 이슈 API

프로젝트 내 이슈를 관리하는 엔드포인트. **모든 라우트에 JWT 인증(`requireAuth`) 필수**. 서비스 레이어에서 요청 사용자가 해당 프로젝트의 **멤버**인지 확인한다(비멤버는 404). 담당자 지정·코멘트 작성·상태 변경은 모든 멤버가 가능하고, 코멘트 삭제만 작성자 본인 또는 owner-role 멤버로 제한된다.

## 엔드포인트 (prefix: `/api/projects`)

### GET `/:id/issues`
이슈 목록 조회 (페이지네이션 포함).

**쿼리 파라미터:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `status` | unresolved\|resolved\|ignored | - | 상태 필터 |
| `level` | debug\|info\|warning\|error\|fatal | - | Issue.level 완전일치 필터 |
| `release` | string (1–256자) | - | 해당 release 값을 가진 이벤트가 하나 이상 존재하는 이슈만 반환 |
| `environment` | string (1–256자) | - | 해당 environment 값을 가진 이벤트가 하나 이상 존재하는 이슈만 반환 |
| `since` | ISO datetime (coerce) | - | Issue.lastSeen ≥ since (inclusive). since > until 이면 400. |
| `until` | ISO datetime (coerce) | - | Issue.lastSeen ≤ until (inclusive). since > until 이면 400. |
| `query` | string | - | 제목 부분 검색 (대소문자 무관) |
| `sort` | lastSeen\|firstSeen\|timesSeen | `lastSeen` | 정렬 기준 (항상 내림차순) |
| `limit` | 1–100 | 50 | 페이지당 항목 수 |
| `cursor` | string | - | 커서 기반 페이지네이션 (이전 응답의 `nextCursor`) |
| `page` | ≥1 | 1 | 오프셋 기반 페이지. `cursor` 있으면 무시. 오프셋 상한: **10,000** |

**필터 의미론:**

- `level` — `Issue.level` 컬럼 직접 일치 (`WHERE level = ?`).
- `release` / `environment` — `Event` 테이블 기반 관계 필터. 해당 값을 가진 이벤트가 **하나 이상(some)** 속한 이슈만 반환한다. 두 파라미터를 **동시에** 지정하면 **같은 이벤트 하나**가 `release`와 `environment`를 모두 충족해야 매치된다(Prisma `events: { some: { release, environment } }`로 구현). 각각 단독 지정하면 독립 필터.
- `since` / `until` — `Issue.lastSeen` 기준 inclusive 범위. `z.coerce.date()`로 파싱하므로 ISO 8601 문자열 전달. `since > until`이면 스키마 레벨 refine에서 400 반환.

**응답 200:** `{ issues: IssueListItem[], nextCursor: string | null }`

> `release`·`environment` 필터를 받쳐줄 `@@index([projectId, release])` / `@@index([projectId, environment])` 인덱스가 추가됨(마이그레이션 `20260623042723_event_release_env_index`). 자동완성용 distinct 값은 아래 facets 엔드포인트로 제공.

### GET `/:id/issues/facets`
이슈 필터(릴리스/환경) 자동완성을 위해, 해당 프로젝트 이벤트의 **distinct release / distinct environment** 값을 반환한다. **JWT 인증 + 프로젝트 소유권** 필수.

- null 값 제외, 오름차순 정렬, 각 최대 **100개**(LIMIT). `$queryRaw`의 `SELECT DISTINCT ... ORDER BY ... LIMIT`로 산출해 위 인덱스를 타도록 보장(`getIssueStats`와 동일한 raw 패턴).
- **100개 초과 시 조용히 잘린다** — 자동완성은 제안일 뿐 자유 텍스트 입력이 가능하므로 목록에 없는 값도 직접 입력해 필터링할 수 있다.
- 정적 세그먼트 `facets`는 Fastify에서 파라미터 `:issueId`보다 우선 매칭되므로 `/:id/issues/:issueId`와 충돌하지 않는다.
- 대시보드 `IssuesPage`가 이 엔드포인트로 환경/릴리스 입력에 `<datalist>` 자동완성을 채운다(자유 텍스트 입력은 유지 — 제안만).

**응답 200:** `{ releases: string[], environments: string[] }`

### GET `/:id/releases/:release/issues`
**릴리스 회귀 보기(P3).** 특정 릴리스에서 처음 등장한 이슈(신규)와 그 릴리스에서 재발한 이슈(회귀)를 한 번에 조회한다. **JWT 인증 + 프로젝트 소유권 필수**(`ensureOwnedProject` 선행, 미소유 시 404).

- `:release` — URL 세그먼트(인코딩됨). Fastify가 디코드한 뒤 zod로 검증(1–256자, 그 외 400).

**판별 로직:**
- `newIssues` — `Issue.firstRelease === :release` 인 이슈. `firstRelease`는 이슈 **최초 생성 시** 그 이벤트의 `release`로 기록된다(없으면 null). `lastSeen` desc, 최대 100.
- `regressedIssues` — `Event.isRegression = true AND Event.release = :release` 인 이벤트를 **하나 이상(some)** 가진 distinct 이슈. `isRegression`은 회귀를 일으킨 그 이벤트에만 `true`(resolved 이슈가 새 이벤트로 unresolved 복귀하는 시점). `ignored` 상태 이슈는 제외(이미 트리아지됨). `lastSeen` desc, 최대 100.
- 두 목록은 서로 다른 신호에서 도출되며, 어떤 이슈가 같은 릴리스에서 최초 등장과 회귀를 동시에 한 경우 양쪽에 모두 나타날 수 있다(의도된 동작, 호출 측에서 필요시 dedupe).
- 각 목록은 100건 상한. 초과 시 응답의 `*Truncated` 플래그가 `true`(나머지는 생략).

**응답 200:** `{ release: string, newIssues: IssueListItem[], newIssuesTruncated: boolean, regressedIssues: IssueListItem[], regressedIssuesTruncated: boolean }`

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

**응답 200:** `{ buckets: { bucket: string, count: number, users: number }[], affectedUsers: number }` (buckets는 ISO datetime 문자열 정렬)

- `buckets[].users` — 버킷 내 distinct 영향 사용자 시계열(아래와 동일한 식별 키).
- `affectedUsers` — 해당 window 내 이 이슈 이벤트의 **distinct 영향 사용자** 개수. 식별 키는 `COALESCE(NULLIF(userContext->>'id',''), NULLIF(userContext->>'email',''), NULLIF(userContext->>'username',''))` — `user.id` 우선, 없거나 빈 문자열이면 `email`→`username`으로 폴백(셋 다 없으면 제외). window 전체 합계 1개 숫자라 버킷별 `users`의 단순 합과 다르다(중복 사용자 1회). **한계**: 같은 사람이 한 번은 `id`로, 다른 한 번은 `email`로만 식별되면 2명으로 집계된다(교차 식별자 해소 없음).

### PATCH `/:id/issues/:issueId`
이슈 상태 변경.

**바디:** `{ status: "unresolved" | "resolved" | "ignored" }`

**응답 200:** `{ issue: IssueListItem }`

> `resolved` → 새 이벤트 수신 시 Worker가 자동으로 `unresolved`로 되돌림 (regression). `ignored`는 되돌리지 않는다.

### PATCH `/:id/issues/:issueId/assignee`
이슈 담당자 지정/해제. **멤버 접근**(비멤버 404).

**바디:** `{ assigneeId: string | null }`

- `assigneeId`가 `null`이 아니면 그 사용자가 **해당 프로젝트의 멤버여야 한다**(`ProjectMember` 존재 확인). 멤버가 아니면 400(`BAD_REQUEST`). 단순 User 존재만으로는 부족 — 외부인에게 이슈를 배정할 수 없다.
- `null`이면 담당자 해제. `Issue.assigneeId`는 `onDelete: SetNull`이라 담당자 계정 삭제 시 자동 해제된다.

**응답 200:** `{ issue: IssueListItem }` (갱신된 담당자 포함)

### GET `/:id/issues/:issueId/comments`
이슈 코멘트 목록. **멤버 접근**(비멤버 404). `createdAt` 오름차순, 최대 **200건**(안전 상한).

**응답 200:** `{ comments: IssueComment[] }`

### POST `/:id/issues/:issueId/comments`
코멘트 작성. **멤버 접근**. `authorId`는 현재 사용자.

**바디:** `{ body: string }` — 트림 후 1–5,000자. 빈/공백 전용 본문은 400.

**응답 201:** `{ comment: IssueComment }`

### DELETE `/:id/issues/:issueId/comments/:commentId`
코멘트 삭제. **멤버 접근**하되 **작성자 본인 또는 owner-role 멤버만** 삭제 가능(그 외 멤버는 403). 존재하지 않는 코멘트는 404.

**응답 204:** (본문 없음)

## 응답 타입

**IssueListItem:**
```
id, title, culprit(nullable), level, status, timesSeen, firstSeen(ISO), lastSeen(ISO),
assignee: { userId, email, name } | null
```

> `assignee`는 목록·상세 양쪽에 포함된다(목록은 Prisma relation include로 산출). 담당자 미지정 시 `null`.

**IssueComment:**
```
id, body, author: { userId, email, name }, createdAt(ISO)
```

**EventSummary:**
```
id, message, exceptionType, exceptionValue, level, environment, release, timestamp(ISO), receivedAt(ISO)
```

**EventDetail** = EventSummary + `stacktrace, breadcrumbs, tags, userContext, contexts, sdkName, sdkVersion, requestUrl, userAgent, hasSnapshot, hasReplay`

- `hasSnapshot: boolean` — 해당 이벤트에 DOM 스냅샷(feature B)이 존재하는지 여부. `true`일 때 스냅샷 엔드포인트로 실제 데이터 조회 가능.
- `hasReplay: boolean` — 해당 이벤트에 세션 리플레이 녹화(feature C)가 존재하는지 여부. 서비스 레이어가 이벤트 페이지의 `clientEventId` 목록을 한 번의 쿼리로 `EventReplay` 테이블과 대조해 산출한다. `true`일 때 리플레이 엔드포인트로 조회 가능.
- `stacktrace`: 소스맵이 업로드되어 있으면 서비스 레이어(`resolveStacktraces`)가 lazy 심볼리케이션을 수행한 뒤 결과를 반환한다. 심볼리케이션된 프레임에는 다음 필드가 추가된다:

| 필드 | 타입 | 설명 |
|---|---|---|
| `originalFilename` | string | 원본 소스 파일 경로 |
| `originalLineno` | number | 원본 줄 번호 |
| `originalColno` | number | 원본 컬럼 번호 |
| `originalFunction` | string? | 원본 함수명 (소스맵에 이름 있을 때) |
| `contextLine` | string? | 원본 줄 코드 한 줄 (sourcesContent 있을 때, 최대 240 코드포인트) |

미니파이 위치(`filename`, `lineno`, `colno`)는 그대로 보존된다. 소스맵 미업로드·미매칭 프레임은 원본 유지. `stacktrace` 응답 스키마는 `z.unknown()`이므로 필드 추가에 스키마 변경 없음.

> `contexts`에는 서버가 User-Agent에서 파싱한 `browser`/`os`/`device`가 포함되며, `userAgent`는 원문 문자열이다.

## 관련 개념
- [인제스트 API](/api/ingest-api.md)
- [소스맵 API](/api/sourcemaps-api.md)
- [세션 리플레이 API](/api/replay-api.md)
- [알림 API](/api/alerts-api.md)
- [데이터 모델](/database/data-model.md)
- [인제스트 파이프라인](/architecture/ingestion-pipeline.md)
- [시스템 아키텍처](/architecture/system.md)
