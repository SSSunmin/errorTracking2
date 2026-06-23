---
type: Concept
title: 데이터 보존/정리 (Retention & Pruning)
description: 무한 증가하는 Event/EventSnapshot/EventReplay를 주기 BullMQ 잡으로 배치 삭제하는 P0 정리 메커니즘.
resource: packages/server/src/modules/retention/prune.ts
tags: [retention, pruning, bullmq, worker, cron, ops]
timestamp: 2026-06-22
---

# 데이터 보존/정리 (Retention & Pruning)

`Event`·`EventSnapshot`·`EventReplay`가 무한 증가하는 것을 막기 위해, 보존기간을 지난 행을 **주기 BullMQ 잡**으로 **배치 삭제**한다. (배경·우선순위는 [백로그 P0](/roadmap/backlog.md).)

## 설정 (env)
`packages/server/src/config/env.ts`의 `envSchema`에서 검증. 값은 일(day) 단위, `0`이면 **해당 대상 비활성**(전량 삭제 아님).

| 변수 | 기본값 | 의미 |
|---|---|---|
| `RETENTION_ENABLED` | `true` | 스케줄 등록 여부(`z.stringbool()`). `false`면 잡 미등록. |
| `RETENTION_REPLAY_DAYS` | `14` | `EventReplay` 보존기간. `0`=비활성. |
| `RETENTION_SNAPSHOT_DAYS` | `14` | `EventSnapshot` 보존기간. `0`=비활성. |
| `RETENTION_EVENT_DAYS` | `90` | `Event` 보존기간. `0`=비활성. |
| `RETENTION_BATCH_SIZE` | `1000` | 한 배치당 최대 삭제 행 수. |
| `RETENTION_CRON` | `"0 3 * * *"` | repeatable 잡 cron(매일 03:00). |

> `SourceMap`은 **이번 범위 제외**(릴리스 산출물 — 시간 삭제 시 활성 릴리스 심볼리케이션 손상). 정리는 P2(소스맵 삭제 API)와 통합 예정.

## 동작 (`modules/retention/prune.ts`)
- `pruneRetention(config?)`: 대상별 cutoff(`now - days*86400000`)를 계산해 순서대로 정리. `days <= 0`이면 그 대상은 건너뜀.
- **삭제 순서**(중요):
  1. **`EventReplay`** — `Event`와 **외래키가 없다**(`clientEventId` 문자열로만 논리 연결). 독립 삭제하지 않으면 영구 고아로 남으므로 **반드시 자기 `createdAt` 기준으로 먼저 정리**한다.
  2. **`EventSnapshot`** — 자기 `createdAt` 기준. 부모 `Event`가 살아있어도 더 짧은 스냅샷 보존을 독립 적용.
  3. **`Event`** — `receivedAt` 기준. 남은 스냅샷은 FK `onDelete: Cascade`로 함께 삭제된다.
- **배치 삭제**: `DELETE ... WHERE id IN (SELECT id ... WHERE <time> < $cutoff ORDER BY <time> ASC LIMIT $batch)`를 삭제 수 < `batchSize`가 될 때까지 반복. 배치 사이 짧은 sleep(부하 분산). 단일 대량 트랜잭션을 만들지 않아 lock/WAL 폭증을 피한다.
- 반환: `{ replay, snapshot, event, durationMs }`(대상별 삭제 건수). cascade로 사라진 스냅샷은 `event`에만 집계되고 `snapshot`에는 잡히지 않는다.

## 잡 인프라 (`lib/queue.ts` · `worker.ts`)
- 큐: `retentionQueueName = "retention"`. 기존 `ingest-events`와 별개. `getRetentionQueue()`/`closeRetentionQueue()`는 lazy 싱글톤 패턴(인제스트 큐와 동일).
- 스케줄: `scheduleRetentionJob()`가 BullMQ `upsertJobScheduler(retentionSchedulerId, { pattern: cron }, { name })`로 등록. **stable id(`"retention-prune"`)** 덕에 워커 재시작 시 repeatable 잡이 중복 누적되지 않는다(멱등). `RETENTION_ENABLED=false`면 no-op.
- 실행: `worker.ts`가 `retention` 큐에 **concurrency 1** Worker를 등록(중복 대량삭제 방지)하고, 부트스트랩에서 `scheduleRetentionJob()`을 1회 호출. shutdown 시 두 Worker + retention 큐를 정리.
- 소유권: **워커 프로세스만** retention 큐(프로듀서)와 Worker(컨슈머)를 연다. API 서버(`app.ts`)는 retention 큐를 열지 않으므로 onClose에서 닫지 않는다.

## 인덱스 / 마이그레이션
- 배치 삭제(`WHERE <time> < cutoff ORDER BY <time>`)를 위해 `EventReplay`·`EventSnapshot`에 `@@index([createdAt])` 추가 — 마이그레이션 `20260622063456_add_retention_indexes`.
- `Event`는 기존 `@@index([projectId, receivedAt])`로 cutoff 삭제 커버.

## 알려진 한계 / 운영 노트
- **디스크 즉시 회수 안 됨**: PostgreSQL은 DELETE 후 dead tuple을 autovacuum이 정리할 때까지 디스크가 줄지 않는다. 대량 삭제 후 `VACUUM` 모니터링 필요(코드 범위 밖).
- **대규모 실행 계획 미검증**: 수백만 행 운영 데이터에서 배치 삭제 패턴은 `EXPLAIN ANALYZE`로 검증하고, 필요 시 CTE DELETE로 교체 검토.
- **스케줄 등록 실패는 로그만**: Redis 장애 등으로 등록 실패 시 워커는 계속 돌지만 정리는 안 된다(인제스트까지 죽이지 않으려는 의도). 운영 알림으로 보강 여지.

## 관련 개념
- [백로그 / 우선순위](/roadmap/backlog.md) · [데이터 모델](/database/data-model.md) · [인제스트 파이프라인](/architecture/ingestion-pipeline.md) · [환경설정 (env)](/config/environment.md) · [운영 런북](/ops/runbook.md)
