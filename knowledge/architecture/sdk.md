---
type: Architecture
title: 브라우저 SDK
description: '@mini-sentry/sdk (packages/sdk). init/captureException/captureMessage/scope API, 전역 핸들러, breadcrumb 자동 계측, V8 스택 파싱, fetch 전송. 호스트 앱에 절대 throw하지 않는 방어 설계. tsup으로 ESM + IIFE 두 형태 빌드, <script> 태그 드롭인 지원.'
resource: packages/sdk/src/index.ts
tags: [sdk, browser, javascript, breadcrumbs, stacktrace, transport, iife, script-tag, loader]
timestamp: 2026-06-16
---

# 브라우저 SDK (`@mini-sentry/sdk`)

## 빌드 출력 (`packages/sdk/tsup.config.ts`)

tsup으로 세 가지 출력물을 생성한다:

| 파일 | 형식 | 용도 |
|---|---|---|
| `dist/index.js` + `dist/index.d.ts` | ESM | npm 패키지 import (기존) |
| `dist/mini-sentry.global.js` | IIFE, 비압축 | `<script>` 태그 개발용 |
| `dist/mini-sentry.min.js` | IIFE, minify | `<script>` 태그 프로덕션용 |

IIFE 진입점은 `src/loader.ts`이며, 전역명 `window.MiniSentry`로 노출된다.

## 스크립트 태그 드롭인 로더 (`packages/sdk/src/loader.ts`)

IIFE 번들의 진입점. 스크립트가 실행되는 시점에:

1. `window.MiniSentry`에 공개 API 객체를 할당한다.
2. `document.currentScript`로 자기 자신의 `<script>` 요소를 읽고 `autoInit()`을 실행한다.
3. `readInitOptionsFromScript`가 `data-*` 속성을 읽어 `InitOptions`를 구성하면, 내부에서 `init()`을 자동 호출한다.

`window.MiniSentry`에 노출되는 API: `init` / `getClient` / `captureException` / `captureMessage` / `setUser` / `setTag` / `setContext` / `addBreadcrumb` / `close`.

### data-* 속성으로 자동 init (`packages/sdk/src/loader-options.ts`)

`readInitOptionsFromScript`는 스크립트 요소의 `dataset`을 다음 순서로 처리한다:

| 속성 | 설명 |
|---|---|
| `data-dsn` | 명시적 DSN. 있으면 그대로 사용 |
| `data-key` + `data-project` | `data-dsn`이 없을 때 사용. `buildDsnFromScriptOrigin`이 스크립트 자신의 `src` origin에서 DSN을 조립: `https://key@host/project` |
| `data-environment` | `InitOptions.environment` |
| `data-release` | `InitOptions.release` |
| `data-auto-instrument` | `"false"`이면 자동 계측 비활성화. 기본 활성(`true`) |

`data-dsn`도 없고 `data-key`/`data-project`도 모두 없으면 자동 init을 건너뛴다(수동 `MiniSentry.init()` 사용 가능).

**사용 예시 (`data-key` + `data-project` 방식, 서버 자체 서빙):**
```html
<script
  src="https://sentry.example.com/sdk/mini-sentry.min.js"
  data-key="pub_abc123"
  data-project="1"
  data-environment="production"
></script>
```
→ DSN은 `https://pub_abc123@sentry.example.com/1`으로 자동 조립된다.

**사용 예시 (`data-dsn` 명시 방식):**
```html
<script
  src="https://sentry.example.com/sdk/mini-sentry.min.js"
  data-dsn="https://pub_abc123@sentry.example.com/1"
></script>
```

## 공개 API (`packages/sdk/src/index.ts`)

| 함수 | 설명 |
|---|---|
| `init(options)` | SDK 초기화. 두 번 호출하면 이전 클라이언트를 닫고 교체. DSN 파싱 실패 등 오류 시 `console.error`만 하고 `null` 반환 (절대 throw 안 함) |
| `captureException(error)` | `Error` 객체 또는 임의 값을 캡처. eventId 반환. |
| `captureMessage(message, level?)` | 메시지 문자열 캡처. 기본 level: `info` |
| `setUser(user \| null)` | scope에 사용자 컨텍스트 설정/초기화 |
| `setTag(key, value)` | scope에 태그 추가 (키/값 각 200자 상한) |
| `setContext(key, context)` | scope에 컨텍스트 객체 추가 |
| `addBreadcrumb(breadcrumb)` | 수동으로 breadcrumb 추가 |
| `close()` | 글로벌 핸들러·계측 해제 |
| `getClient()` | 현재 Client 인스턴스 반환 |

## DSN 파싱 (`parseDsn`)

형식: `<scheme>://<publicKey>@<host>[:port]/<projectId>`

- 비밀번호 포함 시 즉시 오류 (실수로 시크릿 노출 방지)
- 파싱 결과: `{ publicKey, projectId, ingestUrl: "<scheme>://<host>/api/<projectId>/store" }`

## Client 클래스 (`packages/sdk/src/client.ts`)

**SDK_NAME** = `@mini-sentry/sdk`, **SDK_VERSION** = `0.1.0`

### Scope
- `user`: `Record<string, unknown> | undefined`
- `tags`: `Record<string, string>`
- `contexts`: `Record<string, unknown>`

### Breadcrumb 버퍼
- `BreadcrumbBuffer(max)`: 고정 크기 롤링 버퍼 (기본 50, `maxBreadcrumbs` 옵션으로 설정)
- 오래된 항목부터 자동 제거 (shift)

### 전송 (`send`)

- `safeStringify` 로 circular reference 방어 후 JSON 직렬화
- `fetch(ingestUrl?key=<publicKey>, { method: POST, keepalive: true, credentials: omit })`
- 전송 오류는 완전히 삼킴(swallow) — 텔레메트리가 호스트 앱을 절대 중단시키지 않음
- URL에 query/hash 제외한 `origin + pathname`만 포함 (토큰/PII 노출 방지)

### 전역 핸들러 (`installGlobalHandlers`)

`autoInstrument !== false` 일 때 자동 설치:
- `window.addEventListener("error", ...)` — `ErrorEvent.error` 또는 `event.message`로 `captureException`
- `window.addEventListener("unhandledrejection", ...)` — `PromiseRejectionEvent.reason`으로 `captureException`

## Breadcrumb 자동 계측 (`instrumentBreadcrumbs`)

`autoInstrument !== false` 일 때 활성화. teardown 함수 반환으로 정리 가능.

| 계측 대상 | breadcrumb type | category |
|---|---|---|
| `console.log/info/warn/error` | debug | console |
| document click | default | ui.click |
| `window.popstate` | navigation | navigation |
| `history.pushState/replaceState` (SPA) | navigation | navigation |

콘솔 계측은 재귀 방지 플래그(`inConsoleHook`) 보유.

## V8 스택 파싱 (`parseStack`)

V8/Chromium `Error.stack` 형식(`at fn (loc)` 또는 `at loc`) 파싱.

- `in_app`: `filename`에 `node_modules` 미포함 → `true`
- `getTopFrame`: `in_app=true` 프레임 우선, 없으면 첫 프레임 (fingerprint 계산에 사용)
- 최대 **50 프레임**

## Serialize 유틸 (`packages/sdk/src/serialize.ts`)

| 함수 | 설명 |
|---|---|
| `sanitize(value, depth)` | 깊이 6, 문자열 1024자, 배열 50개, 키 50개 상한. circular ref 방지. function/symbol/undefined → 제거 |
| `sanitizeRecord` | `sanitize` wrapper |
| `safeStringify` | `JSON.stringify` + try/catch. 실패 시 `null` 반환 |
| `truncate(str, max=1024)` | 문자열 truncation |

## InitOptions

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `dsn` | string | 필수 | DSN 문자열 |
| `release` | string | - | 앱 릴리스 버전 |
| `environment` | string | - | 환경 (production 등) |
| `maxBreadcrumbs` | number | 50 | breadcrumb 버퍼 크기 |
| `autoInstrument` | boolean | true | 전역 핸들러 + breadcrumb 계측 자동 설치 |

## 관련 개념
- [인제스트 API](/api/ingest-api.md)
- [인제스트 파이프라인](/architecture/ingestion-pipeline.md)
- [용어집](/glossary/terms.md)
