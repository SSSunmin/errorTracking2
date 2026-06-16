# Change Log

OKF 번들의 변경 이력. 최신 항목이 위.

## 2026-06-16 (갱신: Phase 4~8 반영)
- 코드가 Phase 8까지 완성됨에 따라 번들을 전면 최신화.
- 신규 개념 6종: `architecture/sdk`, `architecture/ingestion-pipeline`, `architecture/dashboard`, `api/ingest-api`, `api/issues-api`, `api/alerts-api`.
- 갱신: `index`(목차에 6종 추가), `roadmap`(Phase 1~8 완료 + 범위 밖), `overview`(전체 파이프라인), `database/data-model`·`database/erd`(`Notification` 모델 + `NotificationStatus` enum), `config/environment`(REDIS/CORS/DSN/SMTP/SLACK·TEST_DATABASE_URL 변수), `architecture/system`(수집→큐→워커→그룹핑), `decisions`(큐 분리·advisory-lock 디듀프·SSRF 가드·SameSite=Strict·jti·bundler 해석·nodemailer v9), `glossary`(breadcrumb·alert rule·regression 등).

## 2026-06-16
- 초기 번들 생성. Mini-Sentry Phase 1(모노레포 + 데이터 인프라 + 인증/프로젝트 API) 기준.
- 추가된 개념: `overview/mini-sentry`, `database/data-model`, `api/auth-api`, `api/projects-api`.
- ERD를 별도 개념 `database/erd`로 분리(Mermaid `erDiagram`). `data-model`은 링크로 연결.
- 개념 8종 추가: `architecture/system`, `architecture/auth-flow`, `glossary/terms`, `config/environment`, `ops/runbook`, `reference/error-model`, `decisions/decisions`, `roadmap/roadmap`.
