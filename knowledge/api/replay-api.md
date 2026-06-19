---
type: API Reference
title: 세션 리플레이 API
description: rrweb 녹화 버퍼를 gzip 바이트로 업로드·조회하는 엔드포인트. 업로드는 DSN 공개키 인증 + 퍼미시브 CORS (SDK 전용). 조회는 JWT 인증 (대시보드 전용).
resource: packages/server/src/modules/replay/routes.ts
tags: [api, replay, rrweb, gzip, cors, rate-limit, session-replay]
timestamp: 2026-06-19
---

# 세션 리플레이 API

rrweb 세션 녹화(feature C)를 업로드·조회하는 엔드포인트.

- **업로드** (`POST /api/:projectId/replay`): SDK가 에러 발생 직후 호출. DSN 공개키 인증 + 퍼미시브 CORS.
- **조회** (`GET /api/projects/:id/issues/:issueId/events/:eventId/replay`): 대시보드가 호출. JWT 인증. 출처: `packages/server/src/modules/issues/routes.ts` + `service.ts`.

## 업로드 엔드포인트

### OPTIONS `/api/:projectId/replay`
CORS preflight 처리. 204 반환.

### POST `/api/:projectId/replay`
gzip 압축된 rrweb events JSON 배열을 raw bytes로 수신하고 `EventReplay`에 upsert한다.

**인증**: 인제스트와 동일한 DSN 공개키 방식:
1. 요청 헤더 `x-mini-sentry-key`
2. 쿼리 파라미터 `?key=<publicKey>`

**쿼리 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `eventId` | string | 필수 | SDK가 생성한 에러 이벤트의 UUID (`clientEventId` 연결키) |
| `key` | string | 조건부 | 헤더에 없을 때만 필요 |
| `count` | number (int ≥ 0) | 선택 | 녹화된 rrweb 이벤트 수 (`EventReplay.eventCount`) |
| `durMs` | number (int ≥ 0) | 선택 | 녹화 지속 시간(ms) (`EventReplay.durationMs`) |

**요청 바디**: `Content-Type: application/octet-stream`. Raw gzip 바이트. 상한 **5 MiB** (`replayBodyLimitBytes`).

**응답**: `202 Accepted` `{ id: string }` — `clientEventId` 반환.

**레이트 리밋**: IP 기준 **50 req / 10초** (업로드·preflight 공통).

**CORS**:
```
Origin: *
Methods: POST, OPTIONS
AllowedHeaders: content-type, x-mini-sentry-key
Credentials: false
```

**Upsert 동작**: `clientEventId` unique 제약으로 upsert — SDK keepalive 재전송이나 중복 업로드가 에러를 내지 않고 덮어쓴다. `sizeBytes`는 서버가 `data.length`로 직접 계산해 저장한다.

**저장 형식**: Fastify `octet-stream` 파서가 `Buffer`로 파싱 → `Uint8Array.from(buffer)`로 복사 후 Prisma `Bytes`(`BYTEA`)에 저장. 서버는 압축 해제 없이 바이트를 그대로 보관한다.

## 조회 엔드포인트

### GET `/api/projects/:id/issues/:issueId/events/:eventId/replay`

JWT 인증 필수(`requireAuth`). 이슈 소유권(프로젝트 소유자 확인) 후 해당 이벤트의 `clientEventId`로 `EventReplay`를 조회한다.

**파라미터**: 이슈·이벤트 ID는 기존 이슈 API와 동일한 `eventSnapshotParamsSchema` 사용.

**응답**:
- **200**: `Content-Type: application/json`, `Content-Encoding: gzip` — 저장된 gzip 바이트를 그대로 전송. 브라우저 `fetch`가 자동으로 압축 해제해 rrweb events JSON 배열로 수신.
- **404**: `{ error: { code: "NOT_FOUND", message: "Replay not found" } }` — `Event.clientEventId` 없거나 `EventReplay` 미존재 시.

> 이 엔드포인트는 Fastify-Zod 응답 직렬화를 **우회**한다(바이너리 스트림). `schema.response`가 없다.

**조회 로직** (`service.ts: getEventReplay`):
1. `Event`에서 `clientEventId` 조회 (이슈·프로젝트 소유권 확인 후).
2. `EventReplay.findUnique({ where: { clientEventId } })`로 gzip 데이터 취득.
3. `Buffer`로 변환해 반환 — 라우트가 `content-encoding: gzip` 헤더와 함께 전송.

## 관련 개념
- [이슈 API](/api/issues-api.md) — `hasReplay` 필드, 동일 params 스키마
- [인제스트 API](/api/ingest-api.md) — 공개키 인증 방식 동일
- [데이터 모델](/database/data-model.md) — `EventReplay` 모델
- [브라우저 SDK](/architecture/sdk.md) — 세션 리플레이 녹화·업로드
- [대시보드](/architecture/dashboard.md) — `ReplaySection` / `ReplayPlayer` 렌더링
