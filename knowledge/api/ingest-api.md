---
type: API Reference
title: 인제스트 API
description: 브라우저 SDK가 에러 이벤트를 전송하는 공개 엔드포인트. DSN 공개키 인증, 퍼미시브 CORS, IP 기반 레이트 리밋, BullMQ 큐 비동기 처리.
resource: packages/server/src/modules/ingest/routes.ts
tags: [api, ingest, events, cors, rate-limit, bullmq]
timestamp: 2026-06-16
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

- 최대 바디 크기: **256 KiB** (`bodyLimit`)
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

## BullMQ 큐

`enqueueIngestEvent`가 `ingest-events` 큐에 잡을 추가한다. 잡 옵션:
- 재시도: **3회**, 지수 백오프 (초기 1초)
- 완료 잡 보관: 최근 **1,000**건
- 실패 잡 보관: 최근 **5,000**건

## 관련 개념
- [시스템 아키텍처](/architecture/system.md)
- [이슈 API](/api/issues-api.md)
- [환경설정](/config/environment.md)
- [데이터 모델](/database/data-model.md)
