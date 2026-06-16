---
type: Architecture
title: 인제스트 파이프라인 (이벤트 수집·그룹핑·알림)
description: SDK → Ingest API → BullMQ → Worker → processEvent → 이슈 upsert + 카운터 + regression 감지 → 알림 평가 파이프라인.
resource: packages/server/src/modules/events/process.ts
tags: [architecture, ingest, pipeline, bullmq, worker, fingerprint, grouping, alerts]
timestamp: 2026-06-16
---

# 인제스트 파이프라인

## 전체 흐름

```text
Browser SDK
  │ POST /api/:projectId/store
  ▼
Ingest API (packages/server/src/modules/ingest/)
  │ publicKey 검증 → 바디 검증(Zod) → enqueueIngestEvent
  ▼
BullMQ Queue "ingest-events" (Redis)
  │ attempts:3, exponential backoff
  ▼
Worker (packages/server/src/worker.ts)
  │ concurrency:10, lockDuration:60s
  ├─ processEvent()  →  PostgreSQL (Issue upsert + Event insert)
  └─ processAlertsForEvent()  →  알림 평가 & 발송
```

## 1단계: Ingest API

- 라우트: `POST /api/:projectId/store`
- 공개키를 `x-mini-sentry-key` 헤더 또는 `?key=` 쿼리파라미터에서 추출
- `validateProjectKey`: `ProjectKey.publicKey`로 조회 → `projectId` 매칭 + `isActive` 확인
- **요청 `User-Agent` 헤더를 캡처**해 잡 데이터(`IngestEventJobData.userAgent`)에 함께 실음 — 브라우저가 자동 첨부하는 신뢰 가능한 출처(서버 측 enrichment용, SDK 변경 불필요)
- 검증 성공 → `markProjectKeyUsed`(비동기, 실패 무시) + `enqueueIngestEvent` → `202 { id }`

## 2단계: Fingerprint 계산 (`buildFingerprint`)

입력 페이로드에서 **SHA-256 해시**로 fingerprint 생성:

| 우선순위 | 입력 | 시그니처 |
|---|---|---|
| 1 | `exception` 있음 | `sha256("<type>\|<fn>\|<filename>")` — 최상위 in_app 프레임 우선, 없으면 첫 프레임 |
| 2 | `message` 만 있음 | `sha256("message\|<message>")` |
| 3 | fallback | `sha256("<level>\|<value>")` |

보조 함수:
- `buildTitle`: `exception` → `"Type: value"`, message → 그대로. 최대 250자.
- `buildCulprit`: 최상위 프레임의 `"<fn> (<filename>)"` 또는 null.

## 3단계: 이슈 upsert (`processEvent`)

Prisma 트랜잭션 내에서:

1. `Issue.findUnique({ projectId, fingerprint })` — 기존 이슈 조회
2. **신규** → `Issue.create` (`timesSeen=1`, `firstSeen=lastSeen=now`)
3. **기존** → `Issue.update` (`timesSeen++`, `lastSeen=now`, `level=max(기존,신규)`)
   - 기존 status = `resolved` → `regressed=true`, status를 `unresolved`로 복구
   - 기존 status = `ignored` → 그대로 유지 (재알림 없음)
4. `Event.create` (모든 페이로드 필드 저장 + 아래 enrichment 결과)
5. 반환: `{ issueId, eventId, isNew, regressed }`

동시성 충돌(P2002 unique 위반) 시 **1회 재시도**(`processEventOnce` 두 번 호출).

### User-Agent enrichment (`modules/events/enrich.ts`)

`processEvent`는 잡의 `userAgent`(서버가 1단계에서 캡처)를 `ua-parser-js`로 파싱해 **Sentry 스타일 `contexts`**를 만든다:

- `parseUserAgentContexts(ua)` → `{ browser:{name,version}, os:{name,version}, device:{type,model,vendor} }` (추출 불가 시 `undefined`)
- `mergeEventContexts(payload.contexts, ua)` → **SDK가 보낸 `contexts` 키가 우선**, 비어 있는 자리만 UA에서 채움
- 원문 UA는 `Event.userAgent`에 1,024자로 잘라 저장

즉 OS·브라우저·디바이스는 **서버에서 파싱**하므로 SDK는 별도 코드가 필요 없다. 대시보드 이슈 상세의 "환경" 블록에서 표시된다.

## 4단계: 알림 평가 (`processAlertsForEvent`)

1. 프로젝트의 `isActive=true` AlertRule 전체 조회
2. `event_threshold` 규칙에 필요한 윈도우별 이벤트 카운트 병렬 집계
3. `evaluateAlerts()`: 조건별 평가
   - `new_issue` → `isNew === true`
   - `regression` → `regressed === true`
   - `event_threshold` → `eventCount >= threshold` (해당 window)
4. 트리거된 규칙마다 `claimNotification()` — Postgres advisory lock으로 중복 방지
5. 알림 발송 → `Notification.status` 갱신 (`sent` | `failed`)

### Advisory Lock 중복 방지

```sql
SELECT pg_advisory_xact_lock(hashtextextended('<ruleId>:<issueId>', 0))
```

- 트랜잭션 범위 잠금: 같은 (rule, issue) 쌍에 대해 동시 워커 잡이 둘 다 알림을 보내지 못하게 막음
- `Notification` 레코드를 `pending`으로 먼저 삽입 → 다음 잡이 조회 시 백오프
- 중복 판정 기준:
  - `new_issue`: 중복 없음 (새 이슈는 1회만 발생)
  - `regression`: 60분 쿨다운
  - `event_threshold`: `windowMinutes` 쿨다운

## Worker 설정

- `concurrency: 10` — 병렬 잡 수
- `lockDuration: 60_000ms`, `lockRenewTime: 30_000ms`
- SIGINT/SIGTERM 시 graceful shutdown (`worker.close()` + `prisma.$disconnect()`)

## 관련 개념
- [인제스트 API](/api/ingest-api.md)
- [알림 API](/api/alerts-api.md)
- [데이터 모델](/database/data-model.md)
- [시스템 아키텍처](/architecture/system.md)
