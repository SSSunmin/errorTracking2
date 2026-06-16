---
type: Reference
title: 에러 응답 규약
description: 공통 에러 JSON 포맷과 코드·상태 매핑. 출처는 app.ts 에러 핸들러와 lib/errors.ts.
resource: packages/server/src/lib/errors.ts
tags: [api, errors, conventions]
timestamp: 2026-06-16
---

# 에러 응답 규약

## 공통 포맷
모든 에러 응답은 동일한 형태:
```json
{ "error": { "code": "STRING_CODE", "message": "사람이 읽는 설명", "details": [] } }
```
`details`는 선택(검증 에러 등에서 포함).

## 코드 ↔ 상태 매핑
| code | status | 발생 |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod 요청 검증 실패(`details`에 이슈 목록) |
| `BAD_REQUEST` | 400 | `badRequest()` |
| `UNAUTHORIZED` | 401 | 인증 누락/실패(`unauthorized()`) |
| `FORBIDDEN` | 403 | `forbidden()` |
| `NOT_FOUND` | 404 | 라우트 없음 또는 `notFound()` |
| `CONFLICT` | 409 | 중복 등(`conflict()`, 예: 이메일 중복) |
| `RATE_LIMITED` | 429 | 레이트 리밋 초과 |
| `INTERNAL_SERVER_ERROR` | 500 | 미처리 예외·직렬화 오류 |

## 구현
- `HttpError(statusCode, code, message, details?)` 클래스 + 헬퍼(`badRequest`/`unauthorized`/`forbidden`/`notFound`/`conflict`) — `lib/errors.ts`.
- 전역 에러 핸들러(`app.ts`)가 Zod 검증 에러 → 400, 직렬화 오류 → 500, `HttpError` → 지정 상태, 그 외 → 500(429는 RATE_LIMITED)로 변환.
- 5xx는 서버 로그에 기록.

## 관련 개념
- [인증 API](/api/auth-api.md) · [프로젝트 API](/api/projects-api.md) · [시스템 아키텍처](/architecture/system.md)
