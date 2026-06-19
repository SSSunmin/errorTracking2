---
type: API Reference
title: 인제스트 API
description: 브라우저 SDK가 에러 이벤트를 전송하는 공개 엔드포인트. DSN 공개키 인증, 퍼미시브 CORS, IP 기반 레이트 리밋, BullMQ 큐 비동기 처리. replay 필드로 DOM 스냅샷 수신.
resource: packages/server/src/modules/ingest/routes.ts
tags: [api, ingest, events, cors, rate-limit, bullmq, snapshot]
timestamp: 2026-06-18
---

# 인제스트 API

공개 이벤트 수집 엔드포인트. 브라우저 SDK에서 직접 호출하며 JWT 인증이 아닌 **DSN 공개키(publicKey)** 로 인증한다.

## 엔드포인트

### OPTIONS `/api/:projectId/store`
프리플라이트(CORS preflight) 처리. 204 반환.

### POST `/api/:projectId/store`
이벤트 페이로드를 수신하여 BullMQ 큐에 넣는다.

- **응답**: `202 Accepted` `{ id: string }` — 잡 ID

## 인증

공개키는 다음 순서로 조회한다:
1. 요청 헤더 `x-mini-sentry-key`
2. 쿼리파라미터 `?key=<publicKey>`

키가 없거나 해당 프로젝트와 매칭되지 않거나 비활성(`isActive=false`)이면 `401 Unauthorized` 반환.
성공 시 `ProjectKey.lastUsedAt`을 비동기로 갱신(실패해도 요청 자체는 성공).

## CORS

인제스트 라우트는 전역 CORS 설정과 독립적으로 **퍼미시브 CORS**를 적용한다:
```
Origin: *
Methods: POST, OPTIONS
AllowedHeaders: content-type, x-mini-sentry-key
Credentials: false
```
이를 통해 어느 도메인의 브라우저 앱에서도 이벤트를 전송할 수 있다.

## 레이트 리밋

IP 기준 **50 req / 10초**. `@fastify/rate-limit` 플러그인, `global: false`로 이 라우트에만 개별 적용.

## 요청 바디 검증 (`eventPayloadSchema`)

- 최대 바디 크기: **2 MiB** (`bodyLimit: 2 * 1_024 * 1_024`) — replay DOM 스냅샷 수용을 위해 256 KiB에서 상향. per-IP 레이트 리밋(50 req / 10s)이 남용을 제한.
- 최대 JSON 중첩 깊이: **8**, 배열/오브젝트 키: **100**
- `message` 또는 `exception` 중 하나 필수
- `timestamp` 클락 스큐 허용 범위: 과거 **24시간** ~ 미래 **5분**

| 필드 | 타입 | 제약 |
|---|---|---|
| `eventId` | uuid | optional — 있으면 BullMQ jobId로 중복 방지 |
| `timestamp` | ISO datetime | 클락 스큐 범위 내 필수 |
| `level` | IssueLevel enum | 기본 `error` |
| `message` | string | 최대 8,192자 |
| `exception.type/value` | string | 최대 8,192자 |
| `exception.stacktrace.frames` | StackFrame[] | 최대 100 프레임 |
| `breadcrumbs` | array | 최대 100 항목 |
| `tags/user/contexts` | record | 키 최대 256자, 최대 100키 |
| `release/environment/platform` | string | 최대 256자 |
| `request.url` | string | 최대 2,048자 |
| `replay` | object | optional — DOM 스냅샷. 깊이/키 제한 **없음**(DOM 트리는 깊고 넓으므로 별도 제한 적용). `replay.data` 바이트 크기 상한: **1 MiB**(UTF-8 직렬화 기준). `href`(최대 2,048자), `width`/`height`(non-negative int) optional |

### `replay` 필드 상세

`replay`는 `eventPayloadSchema`의 최상위 optional 필드다. 다른 필드들과 달리 `boundedJson` 깊이/키 검증을 **우회**하며, 대신 `replay.data`를 `JSON.stringify` 후 UTF-8 바이트 크기가 **1,048,576 bytes(1 MiB) 이하**인지만 검사한다(`schemas.ts: maxReplayBytes`).

```
replay: {
  data:   unknown          // rrweb-snapshot 직렬화 DOM 트리 (불투명)
  href?:  string           // 캡처 시점 location.href
  width?: number (int ≥ 0) // window.innerWidth
  height?: number (int ≥ 0) // window.innerHeight
}
```

**저장 동작**: 인제스트 워커가 이벤트를 처리할 때, `replay`가 있으면 `EventSnapshot`을 메인 트랜잭션 **바깥**에서 best-effort로 삽입한다. 스냅샷 저장 실패가 이벤트 자체를 롤백하지 않는다(`process.ts`).

**주의**: `replay` 페이로드(최대 ~1MB)는 BullMQ 잡 데이터로 직렬화되어 Redis에 적재된다 — 스냅샷이 많을수록 Redis 메모리 사용량이 증가한다.

## BullMQ 큐

`enqueueIngestEvent`가 `ingest-events` 큐에 잡을 추가한다. 잡 옵션:
- 재시도: **3회**, 지수 백오프 (초기 1초)
- 완료 잡 보관: 최근 **1,000**건
- 실패 잡 보관: 최근 **5,000**건

## SDK 번들 정적 서빙 (`packages/server/src/app.ts`)

서버가 `@fastify/static`을 통해 SDK IIFE 번들을 직접 서빙한다. 빌드 결과물 디렉터리(`packages/sdk/dist`)가 존재할 때만 등록되며, 존재하지 않으면 플러그인 등록을 건너뛴다.

| 항목 | 값 |
|---|---|
| URL prefix | `/sdk/` |
| 서빙 루트 | `packages/sdk/dist` (서버 기준 `../../sdk/dist`) |
| 허용 파일 | `mini-sentry.global.js`, `mini-sentry.min.js` (화이트리스트, 그 외 경로 차단) |
| `Content-Type` | `application/javascript; charset=utf-8` |
| `Cache-Control` | `no-cache` |
| 인증 | 불필요 — 스크립트 태그 로드는 CORS 무관 |
| 디렉터리 인덱스 | `false` (index.html 없음) |
| 와일드카드 | `false` (화이트리스트 `allowedPath`로만 제한) |

클라이언트는 아래 URL로 번들을 내려받는다:
- `GET /sdk/mini-sentry.min.js` — 프로덕션 minified 번들
- `GET /sdk/mini-sentry.global.js` — 개발용 비압축 번들

스크립트 태그 자동 init 방법은 [브라우저 SDK](/architecture/sdk.md)의 "스크립트 태그 드롭인 로더" 절 참고.

## 관련 개념
- [시스템 아키텍처](/architecture/system.md)
- [브라우저 SDK](/architecture/sdk.md)
- [이슈 API](/api/issues-api.md)
- [환경설정](/config/environment.md)
- [데이터 모델](/database/data-model.md)
