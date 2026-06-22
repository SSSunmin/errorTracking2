# Change Log

OKF 번들의 변경 이력. 최신 항목이 위.

## 2026-06-22 (백로그 문서 추가)
- **로드맵 신규**: `roadmap/backlog` 생성. Phase 1~8 + 소스맵 이후 잔여 작업을 중요도순(P0 데이터 보존/정리 → P1 리플레이 보안 하드닝 → P2 소스맵 정확도/운영 → P3 제품 기능 확장 + 소 DX/테스트)으로 정렬, 각 항목 근거(코드/문서 참조)·범위 스케치·의존성 명시. `roadmap/roadmap`에 "잔여 작업" 절 추가해 백로그 링크. `index.md` 개요에 백로그 항목 추가.

## 2026-06-22 (소스맵 심볼리케이션 기능 추가)
- **API 신규**: `api/sourcemaps-api` 생성. 업로드(`POST /api/projects/:id/releases/:release/sourcemaps` — JWT 인증, `application/octet-stream`, 20 MiB 상한, `?filename=`, gzip 압축 upsert, 업로드 시 `Event.symbolicated` 캐시 무효화 `updateMany`, 201 응답)와 목록 조회(`GET` 동일 경로) 상세 기술. 업로드 CLI(`scripts/upload-sourcemaps.mjs` — `*.map` 재귀 스캔, `MINI_SENTRY_TOKEN` env 또는 `--token`). 알려진 한계 4종(basename 충돌·전량 메모리 로드·업로드 시 mass write·읽기 시 쓰기 중복) 명시.
- **DB**: `database/data-model`(SourceMap 모델 절 신규, Event.symbolicated 필드 추가, Project 관계에 `sourceMaps[]` 추가, 모델 수 10→11, 마이그레이션 2건 명시), `database/erd`(SourceMap 엔티티+`Project ||--o{ SourceMap` 관계 추가, Event에 `symbolicated` 필드 추가, 엔티티/관계 설명 표 갱신, 표기/주의 절에 SourceMap 관련 주의사항 추가).
- **아키텍처**: `architecture/ingestion-pipeline`에 "5단계: 소스맵 심볼리케이션" 절 신규 추가(lazy 조회 흐름, `symbolicateFrames` 처리 규칙, 업로드 시 캐시 무효화, `EventDetail.stacktrace`의 original* 필드 표). `architecture/dashboard`에 스택트레이스 심볼리케이션 렌더링 동작 추가(원본 함수명·파일:줄·contextLine 우선 표시, 미니파이 보조 ↳ 표기).
- **이슈 API**: `api/issues-api`의 `EventDetail.stacktrace` 설명에 original* 필드 표 추가(originalFilename/originalLineno/originalColno/originalFunction/contextLine). 소스맵 API·인제스트 파이프라인 관련 개념 링크 추가.
- **로드맵**: `roadmap/roadmap`에서 "소스맵 심볼리케이션"을 범위 밖 → 구현 완료로 이동.
- **index.md**: 데이터 모델 모델 수 10→11, ERD 설명 갱신, 이슈 API 설명 갱신, `api/sourcemaps-api` 항목 신규 추가.

## 2026-06-22 (fix/replay-viewport-meta — 세션 리플레이 뷰포트 버그 수정)
- **SDK (`architecture/sdk`)**: `trimReplayBuffer`가 `isMeta` 술어를 인자로 받도록 변경됨. FullSnapshot 앵커 직전의 가장 최근 Meta 이벤트(type 4, 뷰포트 width/height 포함)를 슬라이스 앞에 prepend해 업로드 스트림이 항상 `[Meta, FullSnapshot, ...]`으로 시작하도록 보장. 이전에는 Meta가 버려져 마우스 좌표가 `W_real/1280` 비율만큼 어긋나는 버그 발생. `알려진 한계` 절의 "Meta 이벤트 손실" 항목을 수정 완료 내용으로 갱신. `trimReplayBuffer` 동작 설명에 Meta prepend 단계 추가.
- **대시보드 (`architecture/dashboard`)**: `ReplayPlayer`가 스트림의 실제 Meta 이벤트에서 `data.width`/`data.height`를 읽어 뷰포트를 결정하도록 변경됨. Meta가 없거나 크기가 0 이하이면 `1280×720` placeholder로 fallback(이전 녹화 backward-compat). placeholder 합성 Meta는 Meta 자체가 없는 스트림에만 삽입. 기존 "1280×720 hardcoded" known limitation 설명을 새 동작으로 교체.

## 2026-06-19 (session replay 기능 추가 — feature C)
- **DB**: `EventReplay` 모델 신규(`clientEventId` unique, `projectId` 비정규화, `data` Bytes/BYTEA gzip, `eventCount?`/`durationMs?`/`sizeBytes?` Int?, `@@index([projectId])`). `Event`에 `clientEventId String?` + `@@index([clientEventId])` 추가. 마이그레이션 `20260618083417_add_event_replay`. `database/data-model`(EventReplay 모델 절 신규, Event clientEventId 필드 추가, 모델 수 9→10), `database/erd`(ERD 다이어그램에 `EventReplay` 엔티티 + Event `clientEventId` 필드 추가, 엔티티/관계 설명 표·주의 절 갱신 — EventReplay는 FK 없이 논리적 연결임을 명시).
- **API 신규**: `api/replay-api` 생성. 업로드(`POST /api/:projectId/replay` — DSN 공개키 인증, 퍼미시브 CORS, RAW gzip octet-stream, 5 MiB 상한, `?eventId&count&durMs`, upsert by clientEventId, 202 응답)와 조회(`GET /api/projects/:id/issues/:issueId/events/:eventId/replay` — JWT 인증, content-encoding:gzip, 404 시 NOT_FOUND) 상세 기술.
- **이슈 API**: `EventDetail`에 `hasReplay: boolean` 추가(서비스 레이어가 페이지 단위 `EventReplay` 조회로 산출). 신규 엔드포인트 `GET /.../events/:eventId/replay` 문서화. `api/issues-api` 갱신.
- **SDK**: `InitOptions.sessionReplay?: boolean`(기본 false) 추가(`types.ts`). 신규 `src/sessionReplay.ts` — rrweb `record()`로 30초 롤링 버퍼, `checkoutEveryNms:15000`, `maskAllInputs:true`, `trimReplayBuffer` 순수함수(unit-testable). `src/client.ts` — `captureException`에서 250ms 딜레이 후 fflate `gzipSync` + fetch POST to `replayUrl`(`?eventId&count`). `src/dsn.ts` — `DsnComponents`에 `replayUrl` 추가. 의존성 `rrweb` + `fflate` 추가. `architecture/sdk` 갱신(세션 리플레이 절 신규, DSN 파싱 결과에 replayUrl, InitOptions에 sessionReplay 항목, known limitations 3종 명시).
- **대시보드**: `IssueDetailPage`에 `ReplaySection`/`ReplayPlayer` 컴포넌트 추가(rrweb `Replayer` 직접 사용, rrweb-player 미사용). `hasReplay` 확인 후 `api.getEventReplay()` TanStack Query 호출(`staleTime:Infinity`). Meta 이벤트(type 4) 합성(1280×720 placeholder). sandbox `allow-same-origin`만, `UNSAFE_replayCanvas` 미사용. `api.ts`에 `ReplayEvent` 인터페이스 + `getEventReplay()` 추가. `architecture/dashboard` 갱신(ReplaySection/ReplayPlayer 동작 상세, API 클라이언트 표에 replay 엔드포인트 추가).
- **index.md**: 데이터 모델 모델 수 9→10, ERD 설명 갱신, 이슈 API 설명 갱신, `api/replay-api` 항목 신규 추가.

## 2026-06-18 (error-moment DOM snapshot 기능 추가)
- **DB**: `EventSnapshot` 모델 신규(`eventId` unique FK→Event Cascade, `projectId` 비정규화, `data` Json, `href?`, `width?`, `height?`, `@@index([projectId])`). 마이그레이션 `20260618065758_add_event_snapshot`. `Event`에 `snapshot EventSnapshot?` back-relation 추가. `database/data-model`(EventSnapshot 모델 절 + Event back-relation 추가, 모델 수 8→9), `database/erd`(ERD 다이어그램에 `EventSnapshot` 엔티티·관계 추가, 엔티티/관계 설명 표 추가, 표기/주의 절 갱신).
- **인제스트 API**: 바디 상한 256 KiB → **2 MiB** 상향. `eventPayloadSchema`에 optional `replay` 필드 추가(깊이/키 제한 우회, data 바이트 ≤1 MiB). `process.ts`에서 스냅샷을 메인 트랜잭션 **바깥** best-effort 삽입. `api/ingest-api` 갱신(바디 한도, replay 필드 상세, 저장 동작, Redis 메모리 주의사항).
- **이슈 API**: `EventDetail`에 `hasSnapshot: boolean` 추가. 신규 엔드포인트 `GET /:id/issues/:issueId/events/:eventId/snapshot` → `{ snapshot: { data, href, width, height } | null }`. `api/issues-api` 갱신(새 엔드포인트 절, EventDetail 타입에 hasSnapshot 설명 추가).
- **SDK**: `InitOptions.captureReplay?: boolean`(기본 true) 추가(`types.ts`). 신규 `src/replay.ts` — `rrweb-snapshot snapshot(document, {maskAllInputs:true, inlineStylesheet:true})`으로 DOM 캡처, `captureException`에서만 호출. 의존성 `rrweb-snapshot: "2.0.1"` 추가. `architecture/sdk` 갱신(DOM 스냅샷 캡처 절 신규, `captureReplay` InitOptions 항목 추가, 알려진 한계 명시, 관련 개념 갱신).
- **대시보드**: `IssueDetailPage`에 `SnapshotSection`/`SnapshotFrame` 컴포넌트 추가 — `hasSnapshot` 확인 후 스냅샷 API 호출, `rebuildIntoSandboxedIframe`으로 sandboxed iframe 렌더링(스크립트 실행 없음). `architecture/dashboard` 갱신(IssueDetailPage 스냅샷 렌더링 동작 추가, API 클라이언트 표에 snapshot 엔드포인트 추가).

## 2026-06-17 (SDK console 브레드크럼 기본 비활성화)
- `console.log/info/warn/error` 브레드크럼 수집이 기본 off로 변경. `InitOptions.captureConsole`(`packages/sdk/src/types.ts`)이 추가됐으며 기본값 `false`. `instrumentBreadcrumbs`의 시그니처가 `options?: { captureConsole?: boolean }`을 받도록 변경되고, console 후킹은 `captureConsole === true`일 때만 설치(`packages/sdk/src/breadcrumbs.ts`). 클릭·네비게이션 계측은 변경 없이 항상 on 유지.
- 스크립트 태그 드롭인에서는 `data-capture-console="true"` 속성으로 활성화 가능(`packages/sdk/src/loader-options.ts`).
- 갱신: `architecture/sdk`(Breadcrumb 자동 계측 표에 기본 동작 열 추가 + console 활성화 방법 예시 추가, `data-*` 속성 표에 `data-capture-console` 추가, `InitOptions`에 `captureConsole` 항목 추가, `timestamp` 갱신).

## 2026-06-16 (SDK tarball 배포 방식 추가)
- `@mini-sentry/sdk`를 `npm pack`으로 tarball 배포하는 방법 추가. `private: true`(publish 차단)를 유지한 채 `files: ["dist"]` + `prepack` 훅으로 dist를 tarball에 포함. 외부 프로젝트에서 `npm i ./mini-sentry-sdk-0.1.0.tgz` 후 ESM import + 타입 사용 가능.
- `.npmignore` 신규(`.gitignore` 폴백으로 dist 누락되는 문제 방지), `tsconfig.build.json` 신규(선언 빌드에서 테스트 파일 제외).
- 갱신: `architecture/sdk`(빌드 출력표에 tarball 용도 추가, "패키징 및 tarball 배포" 절 신규, 설명·주의점 포함).

## 2026-06-16 (SDK 스크립트 태그 드롭인 번들 + 서버 정적 서빙)
- SDK 빌드를 tsup으로 전환. ESM(`dist/index.js`) 외에 IIFE 번들(`dist/mini-sentry.global.js`, `dist/mini-sentry.min.js`, `window.MiniSentry`)을 추가 출력.
- `loader.ts`/`loader-options.ts` 신규: `<script>` 로드 시 `document.currentScript`를 읽어 `data-dsn` 또는 `data-key`+`data-project`(src origin에서 DSN 자동 조립)로 자동 init. `data-environment`/`data-release`/`data-auto-instrument` 지원.
- 서버가 `@fastify/static`으로 `packages/sdk/dist`를 `/sdk/` 프리픽스에 서빙(화이트리스트 2종, `Content-Type: application/javascript`, `Cache-Control: no-cache`, dist 없으면 스킵).
- 갱신: `architecture/sdk`(빌드 출력표 + 로더 절 + data-* 속성 상세 + 사용 예시), `api/ingest-api`(SDK 번들 정적 서빙 절 추가), `architecture/ingestion-pipeline`(전체 흐름 다이어그램 최상단에 스크립트 태그 경로 추가).

## 2026-06-16 (AlertRule 쿨다운 사용자 설정 기능 추가)
- `AlertRule`에 `cooldownMinutes Int?` 컬럼 추가(마이그레이션 `20260616045858_alert_rule_cooldown`). regression 조건 전용 dedup 윈도를 규칙별로 설정 가능, 미지정 시 서버 기본값 60분.
- 갱신: `database/data-model`(AlertRule에 `cooldownMinutes` 설명·정규화 규칙 추가), `database/erd`(AlertRule 엔티티에 `cooldownMinutes` 필드 추가), `api/alerts-api`(입력·응답 스키마에 `cooldownMinutes` 추가, 동작 규칙 명시).

## 2026-06-16 (User-Agent enrichment 추가)
- 인제스트 시 서버가 요청 `User-Agent`를 캡처해 `ua-parser-js`로 파싱 → `Event.contexts.{browser,os,device}` + `Event.userAgent` 저장. SDK 변경 없음(브라우저가 헤더 자동 첨부).
- 갱신: `architecture/ingestion-pipeline`(1·3단계 + enrichment 절), `database/data-model`(Event 주석), `api/issues-api`(EventDetail에 `userAgent`).
- 코드: `modules/events/enrich.ts`(신규) + `process.ts`/`ingest/routes.ts`/`worker.ts`/`lib/queue.ts`/이슈 직렬화, 대시보드 이슈 상세 "환경" 블록.

## 2026-06-16 (ERD 설명 추가)
- `database/erd`에 **엔티티 설명**(엔티티별 1줄 의미)과 **관계 설명**(각 선의 의미·카디널리티 풀이) 표 추가. 다이어그램만 있던 것을 보완.
- 큐레이터 규칙(키트+test2): ERD에 다이어그램만 두지 말고 엔티티·관계 설명을 반드시 붙이도록 명문화.

## 2026-06-16 (디자인 토큰 추가)
- 대시보드에 BVDS 컬러 시스템 적용(`packages/dashboard/src/tokens.css` 41색×2모드 + `styles.css` 시맨틱 매핑 + 다크 기본).
- 개념 추가: `design/tokens`(`type: Design Tokens`, **조건부 — 디자인 시스템 없으면 삭제 가능**). `index`에 디자인 섹션 추가.

## 2026-06-16 (갱신: Phase 4~8 반영)
- 코드가 Phase 8까지 완성됨에 따라 번들을 전면 최신화.
- 신규 개념 6종: `architecture/sdk`, `architecture/ingestion-pipeline`, `architecture/dashboard`, `api/ingest-api`, `api/issues-api`, `api/alerts-api`.
- 갱신: `index`(목차에 6종 추가), `roadmap`(Phase 1~8 완료 + 범위 밖), `overview`(전체 파이프라인), `database/data-model`·`database/erd`(`Notification` 모델 + `NotificationStatus` enum), `config/environment`(REDIS/CORS/DSN/SMTP/SLACK·TEST_DATABASE_URL 변수), `architecture/system`(수집→큐→워커→그룹핑), `decisions`(큐 분리·advisory-lock 디듀프·SSRF 가드·SameSite=Strict·jti·bundler 해석·nodemailer v9), `glossary`(breadcrumb·alert rule·regression 등).

## 2026-06-16
- 초기 번들 생성. Mini-Sentry Phase 1(모노레포 + 데이터 인프라 + 인증/프로젝트 API) 기준.
- 추가된 개념: `overview/mini-sentry`, `database/data-model`, `api/auth-api`, `api/projects-api`.
- ERD를 별도 개념 `database/erd`로 분리(Mermaid `erDiagram`). `data-model`은 링크로 연결.
- 개념 8종 추가: `architecture/system`, `architecture/auth-flow`, `glossary/terms`, `config/environment`, `ops/runbook`, `reference/error-model`, `decisions/decisions`, `roadmap/roadmap`.
