---
type: Architecture
title: 브라우저 SDK
description: '@mini-sentry/sdk (packages/sdk). init/captureException/captureMessage/scope API, 전역 핸들러, breadcrumb 자동 계측, V8 스택 파싱, fetch 전송. 호스트 앱에 절대 throw하지 않는 방어 설계. tsup으로 ESM + IIFE 두 형태 빌드, <script> 태그 드롭인 지원. npm pack 으로 tarball 배포 가능(private: true 유지, publish는 막음). captureException 시 rrweb-snapshot으로 마스킹된 DOM 스냅샷 수집(captureReplay 기본 true). sessionReplay 옵션(기본 false)으로 rrweb 롤링 30초 버퍼 녹화 + fflate gzip 업로드 지원(feature C).'
resource: packages/sdk/src/index.ts
tags: [sdk, browser, javascript, breadcrumbs, stacktrace, transport, iife, script-tag, loader, tarball, npm-pack, replay, snapshot, session-replay, rrweb, fflate]
timestamp: 2026-06-22
---

# 브라우저 SDK (`@mini-sentry/sdk`)

## 빌드 출력 (`packages/sdk/tsup.config.ts`)

tsup으로 세 가지 출력물을 생성한다:

| 파일 | 형식 | 용도 |
|---|---|---|
| `dist/index.js` + `dist/index.d.ts` | ESM | npm 패키지 import / tarball 설치 |
| `dist/mini-sentry.global.js` | IIFE, 비압축 | `<script>` 태그 개발용 |
| `dist/mini-sentry.min.js` | IIFE, minify | `<script>` 태그 프로덕션용 |

IIFE 진입점은 `src/loader.ts`이며, 전역명 `window.MiniSentry`로 노출된다.

## 패키징 및 tarball 배포 (`packages/sdk/package.json`, `.npmignore`, `tsconfig.build.json`)

`<script>` 태그 외에, 번들러를 사용하는 프로젝트는 tarball로 설치해 ESM import + 타입을 그대로 쓸 수 있다.

### 설치 방법

```bash
# 1. SDK 디렉터리에서 tarball 생성 (prepack 훅이 빌드를 자동 실행)
cd packages/sdk
npm pack

# 2. 외부 프로젝트에서 설치
npm install ./mini-sentry-sdk-0.1.0.tgz
```

```ts
// 타입 포함 ESM import
import * as MiniSentry from '@mini-sentry/sdk';
MiniSentry.init({ dsn: '...' });
```

### 패키지 설정 요점

| 항목 | 설정값 | 설명 |
|---|---|---|
| `private` | `true` | npm publish 차단. pack은 허용 |
| `files` | `["dist"]` | tarball에 `dist/` 만 포함 |
| `prepack` | `npm run build` | pack 전 자동 빌드 실행 |
| `main` / `types` / `exports` | `dist/` 기준 | 설치 후 진입점 |
| build 스크립트 | `tsup --config tsup.config.ts && tsc -p tsconfig.build.json --emitDeclarationOnly` | ESM 번들 + 선언 파일 분리 생성 |

### 패키징 주의점

- 루트 `.gitignore`에 `dist/`가 포함되어 있어, `.npmignore` 없이 `npm pack`하면 npm이 `.gitignore`를 폴백으로 사용해 `dist/`가 tarball에서 누락된다. `packages/sdk/.npmignore`를 추가해 이 폴백을 막고, `files` 필드로 `dist/`를 명시적으로 포함시킨다.
- `packages/sdk/tsconfig.build.json`(신규): 선언 빌드 시 `src/**/*.test.ts`를 제외해 tarball에 테스트용 `.d.ts`가 섞이지 않도록 한다.
- tarball 내 구조: `package/dist/index.js`, `package/dist/index.d.ts`, IIFE 번들 포함.

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
| `data-capture-console` | `"true"`이면 console 브레드크럼 수집 활성화. 기본 비활성(`false`) |

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
- 파싱 결과: `{ publicKey, projectId, ingestUrl: "<scheme>://<host>/api/<projectId>/store", replayUrl: "<scheme>://<host>/api/<projectId>/replay" }`

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

시그니처: `instrumentBreadcrumbs(add, options?: { captureConsole?: boolean })`

| 계측 대상 | breadcrumb type | category | 기본 동작 |
|---|---|---|---|
| `console.log/info/warn/error` | debug | console | **기본 off** — `options.captureConsole === true`일 때만 설치 |
| document click | default | ui.click | 항상 on |
| `window.popstate` | navigation | navigation | 항상 on |
| `history.pushState/replaceState` (SPA) | navigation | navigation | 항상 on |

console 계측은 재귀 방지 플래그(`inConsoleHook`) 보유.

### console 브레드크럼 활성화 방법

기본적으로 console(`log`/`info`/`warn`/`error`) 브레드크럼은 수집되지 않는다. 활성화하려면 두 가지 방법 중 하나를 사용한다:

**ESM `init` 옵션 사용:**
```ts
MiniSentry.init({ dsn: '...', captureConsole: true });
```

**스크립트 태그 `data-capture-console` 속성 사용:**
```html
<script
  src="https://sentry.example.com/sdk/mini-sentry.min.js"
  data-dsn="https://pub_abc123@sentry.example.com/1"
  data-capture-console="true"
></script>
```

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

## 세션 리플레이 (feature C) (`packages/sdk/src/sessionReplay.ts`, `src/client.ts`)

`InitOptions.sessionReplay === true`이고 `document`가 존재할 때만 활성화되는 **opt-in** 기능.

### 녹화 (`startSessionReplay`)

- rrweb `record()` 호출로 DOM mutation을 스트림으로 수집.
- `checkoutEveryNms: 15_000` — 15초마다 강제 full snapshot을 찍어 버퍼 trim 기준점을 갱신.
- `maskAllInputs: true` — `<input>` 값을 마스킹(PII 보호). `recordCanvas: false`.
- 매 이벤트마다 `trimReplayBuffer`로 **~30초 롤링 윈도** 유지:
  - cutoff(`now - 30s`) 이전에서 가장 최근 full snapshot을 앵커로 삼아 그 이전 이벤트를 제거.
  - full snapshot이 cutoff 이내에만 있으면(버퍼가 30초 미만) 가장 이른 full snapshot을 앵커로 사용 → 항상 full snapshot으로 시작하는 버퍼 보장.
  - full snapshot이 전혀 없으면 이벤트 전부 유지.
  - 앵커(FullSnapshot) 직전에 있는 가장 최근 Meta 이벤트를 슬라이스 앞에 prepend — 뷰포트 width/height 보존(fix/replay-viewport-meta).
- `snapshot()` 호출 시 내부 배열 사본 반환.
- 브라우저 환경이 아니거나 `record()` 실패 시 **inert handle** 반환(`snapshot()→[]`, `stop()→no-op`). 텔레메트리가 절대 호스트 앱에 throw하지 않는다.

### 업로드 (`Client.sendReplay`, `Client.captureException`)

`captureException` 호출 시 **250ms 딜레이(`REPLAY_FLUSH_DELAY_MS`)** 후 fire-and-forget으로 실행:

```
captureException() 호출
 └─ 에러 이벤트 fetch POST → /api/:projectId/store
 └─ setTimeout(250ms)
      └─ sessionReplay.snapshot() → rrweb events[]
      └─ fflate gzipSync(strToU8(JSON.stringify(events)))
      └─ fetch POST /api/:projectId/replay
           ?eventId=<eventId>&count=<events.length>
           Content-Type: application/octet-stream
           x-mini-sentry-key: <publicKey>
```

- 딜레이 이유: rrweb는 `MutationObserver` 기반이므로 에러 상태 렌더링(예: 에러 바운더리 폴백) 뮤테이션이 `captureException` 시점에 아직 버퍼에 없다. 250ms 대기로 최종 뮤테이션을 flush한다.
- `replayUrl`은 `parseDsn`이 DSN에서 조립: `<scheme>://<host>/api/<projectId>/replay`.
- 버퍼가 비어있으면(`events.length === 0`) 업로드하지 않는다.
- gzip/fetch 실패는 완전히 삼킴 — 리플레이 업로드가 에러 이벤트 전송이나 호스트 앱을 중단시키지 않는다.

### 알려진 한계 / 후속 과제

- **Meta 이벤트 보존 (fix/replay-viewport-meta)**: `trimReplayBuffer`가 `isMeta` 술어를 인자로 받아, FullSnapshot 앵커 이전에 있는 가장 최근 Meta 이벤트(type 4, 뷰포트 width/height 포함)를 슬라이스 앞에 자동으로 prepend한다. rrweb은 `Meta(4) → FullSnapshot(2) → incremental(3…)` 순으로 emit하므로, 이전에는 슬라이스 시작이 `[FullSnapshot, ...]`이 되어 뷰포트 크기가 소실되었다. 수정 후 스트림은 항상 `[Meta, FullSnapshot, ...]`으로 시작한다. Meta가 앵커 이전에 없는 경우(버퍼 최초 초기화 직후 등)에는 prepend 없이 기존 동작을 유지한다.
- **보관 한도 없음**: `EventReplay`에 TTL/quota 정책이 없다. 리플레이가 누적되면 스토리지를 무제한으로 차지한다(추후 과제).
- **보안**: 리플레이 뷰가 대시보드와 같은 오리진에서 렌더링된다(`allow-same-origin`). 신뢰할 수 없는 녹화는 별도 오리진에서 서빙해야 한다(현재 미구현).
- **captureMessage 미지원**: 세션 리플레이 업로드는 `captureException`에서만 실행된다.

## DOM 스냅샷 캡처 (`packages/sdk/src/replay.ts`)

에러 발생 시점의 페이지 모양을 rrweb-snapshot으로 캡처한다. `captureException`에서만 호출되며(`captureMessage`는 해당 없음), `captureReplay !== false`일 때 활성화된다.

### 동작

```ts
snapshot(document, { maskAllInputs: true, inlineStylesheet: true })
```

- **`maskAllInputs: true`**: `<input>` 값을 마스킹 처리해 PII 노출 방지.
- **`inlineStylesheet: true`**: 외부 CSS를 인라인으로 포함해 재현 시 스타일이 올바르게 표시됨.
- `location.href`, `window.innerWidth`, `window.innerHeight`를 함께 첨부한다.
- `document`가 없는 환경(SSR 등) 또는 `snapshot()` 실패 시 `undefined`를 반환 — 이벤트는 스냅샷 없이 정상 전송된다.
- 캡처 결과는 `SentryEvent.replay` 필드에 첨부되어 인제스트 페이로드에 포함된다.

### 의존성

`rrweb-snapshot: "2.0.1"` (`packages/sdk/package.json`의 `dependencies`).

### 알려진 한계

- `maskAllInputs`는 `<textarea>` 및 `contenteditable` 요소를 마스킹하지 않는다.
- 캡처된 스냅샷(최대 ~1MB)은 BullMQ 잡 데이터로 Redis에 적재된다 — 스냅샷이 많으면 Redis 메모리 사용량이 늘어난다.
- `captureReplay`가 기본 `true`이므로 opt-out하지 않으면 모든 `captureException` 호출에서 스냅샷을 시도한다.

## InitOptions

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `dsn` | string | 필수 | DSN 문자열 |
| `release` | string | - | 앱 릴리스 버전 |
| `environment` | string | - | 환경 (production 등) |
| `maxBreadcrumbs` | number | 50 | breadcrumb 버퍼 크기 |
| `autoInstrument` | boolean | true | 전역 핸들러 + breadcrumb 계측 자동 설치 |
| `captureConsole` | boolean | false | console 브레드크럼 수집 여부. 기본 비활성. `true`로 설정해야 console.log/info/warn/error를 breadcrumb으로 수집 |
| `captureReplay` | boolean | true | `captureException` 호출 시 rrweb-snapshot으로 DOM 스냅샷 캡처(feature B). 기본 **활성**. 비활성하려면 `false`로 명시 |
| `sessionReplay` | boolean | false | rrweb 롤링 30초 버퍼 녹화 + 에러 시 fflate gzip 업로드(feature C). **기본 비활성** — rrweb 로드 비용이 있으므로 opt-in. `true`이고 `document`가 있을 때만 시작 |

## 관련 개념
- [인제스트 API](/api/ingest-api.md)
- [인제스트 파이프라인](/architecture/ingestion-pipeline.md)
- [이슈 API](/api/issues-api.md)
- [데이터 모델](/database/data-model.md)
- [용어집](/glossary/terms.md)
