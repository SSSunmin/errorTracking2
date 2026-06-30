# Mini-Sentry Knowledge Bundle

> **Open Knowledge Format (OKF v0.1) 번들.**
> 각 `.md` = 개념(concept) 1개, YAML 프론트매터의 `type`이 필수.
> 사람이 읽고(`cat`/`git`), AI 에이전트가 컨텍스트로 읽으며, 조직 간 교환이 가능합니다.

## 개념 목록 (Concepts)

### 개요
- [Mini-Sentry 프로젝트 개요](/overview/mini-sentry.md) — 무엇을·왜·아키텍처 흐름·현재 단계
- [용어집](/glossary/terms.md) — Issue/Event/fingerprint/DSN 등 도메인 용어
- [로드맵](/roadmap/roadmap.md) — Phase 1 완료 / 이후 단계
- [백로그 / 우선순위](/roadmap/backlog.md) — 잔여 작업 P0~P3 정렬·근거·범위(retention·보안·소스맵·기능)

### 아키텍처
- [시스템 아키텍처](/architecture/system.md) — 모노레포·부팅·미들웨어·전체 파이프라인
- [인증 플로우](/architecture/auth-flow.md) — JWT + 리프레시 회전·재사용 탐지
- [브라우저 SDK](/architecture/sdk.md) — 에러 캡처·DSN·전송 방식
- [인제스트 파이프라인](/architecture/ingestion-pipeline.md) — Ingest API → BullMQ → Worker → PostgreSQL
- [대시보드](/architecture/dashboard.md) — React 대시보드 구조·라우트·상태 관리

### 데이터
- [데이터 모델 (Prisma / PostgreSQL)](/database/data-model.md) — 13개 모델·관계·인덱스·enum (ProjectMember/ProjectRole 멤버십, IssueComment·Issue.assigneeId, Issue.firstRelease/Event.isRegression 추가)
- [ERD](/database/erd.md) — 엔티티 관계도(Mermaid, SourceMap 포함)

### API
- [프로젝트 랜딩 헬스 집계](/api/projects-api.md) — `GET /api/projects/overview?window=24h|7d`는 멤버 프로젝트별 이벤트 수, 열린 이슈 수, window 버킷, 전체 기간 마지막 이벤트 시각을 한 번에 제공한다.
- [인증 API](/api/auth-api.md) — register / login / refresh / logout / me
- [프로젝트 API](/api/projects-api.md) — 프로젝트·프로젝트 키 CRUD·멤버 관리(멤버십 기반 접근제어) + 프로젝트 단위 통계(stats·배포 환경별·브라우저/OS 분포)
- [인제스트 API](/api/ingest-api.md) — POST /:projectId/store 이벤트 수집
- [이슈 API](/api/issues-api.md) — 이슈 목록·상세·상태 변경·담당자(assignee)·코멘트 (level/release/environment/since/until 필터 + facets 자동완성 엔드포인트 + 릴리스 회귀 보기, hasReplay, 심볼리케이션 포함)
- [세션 리플레이 API](/api/replay-api.md) — 리플레이 업로드(DSN 인증) + 조회(JWT 인증)
- [소스맵 API](/api/sourcemaps-api.md) — 소스맵 업로드·목록 조회·DELETE(JWT 인증), 경로 접미사 매칭·2단계 메모리 바운딩·캐시 무효화, 알려진 한계
- [알림 규칙 API](/api/alerts-api.md) — AlertRule CRUD, event_threshold/event_spike 이슈별 알림
- [에러 응답 규약](/reference/error-model.md) — 공통 에러 포맷·코드

### 디자인
- [디자인 토큰 (BVDS)](/design/tokens.md) — 컬러 시스템·이름 규칙·모드 반전 (조건부: 디자인 시스템 있을 때만)

### 설정 / 운영
- [환경설정 (env)](/config/environment.md) — DB·JWT·포트·CORS·DSN 변수
- [운영 런북](/ops/runbook.md) — 셋업·인프라·검증 명령
- [데이터 보존/정리 (Retention)](/ops/retention.md) — Event/Snapshot/Replay 주기 배치 삭제 + 고아 소스맵 정리(BullMQ 잡·env·인덱스)
- [운영 배포 (Docker Compose + Caddy)](/ops/deployment.md) — 운영 스택·리플레이 오리진 격리·frame-ancestors CSP·마이그레이션·TLS

### 결정
- [설계 결정 기록 (ADR-lite)](/decisions/decisions.md) — 주요 선택과 이유

## 번들 규칙 (OKF)
- **예약 파일**: `index.md`(이 파일, 목차), `log.md`(변경 이력). 그 외 모든 `.md`는 개념.
- **필수 프론트매터**: `type` (비어있지 않을 것). 권장: `title` `description` `resource` `tags` `timestamp`.
- **링크**: 번들 루트 기준 절대경로(`/...`)를 사용 — 파일이 옮겨가도 안정적.
- **소비 측 관용**: 누락 필드·모르는 `type`·깨진 링크는 너그럽게 무시.
