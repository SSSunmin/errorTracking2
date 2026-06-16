# Change Log

OKF 번들의 변경 이력. 최신 항목이 위.

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
