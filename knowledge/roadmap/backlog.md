---
type: Backlog
title: 백로그 / 우선순위
description: Phase 1~8 + 소스맵 이후 잔여 작업. 중요도(P0~P3)순 정렬·근거·범위 스케치.
resource: roadmap.md
tags: [backlog, planning, priority, retention, security, sourcemap]
timestamp: 2026-06-22
---

# 백로그 (Phase 1~8 + 소스맵 이후)

로드맵의 핵심 단계는 완료됨([로드맵](/roadmap/roadmap.md)). 이 문서는 잔여 작업을 **중요도/위험도순**으로 정렬한다. 우선순위는 "운영에서 당장 문제가 되는가 / 보안 노출 전에 필요한가 / 정확도·기능"을 기준으로 한다.

## 권장 작업 순서 (요약)
1. **P0 — 데이터 보존/정리(retention)**: 무한 증가 방지. 운영 시작 전 필수.
2. **P1 — 리플레이 보안 하드닝(별도 오리진)**: 신뢰 못 할 녹화 노출 전 필요.
3. **P2 — 소스맵 정확도/운영(full-path 매칭·삭제 API·메모리)**: 정확도·견고성.
4. **P3 — 제품 기능 확장(검색/담당자/환경·릴리스/차트)**: 가치 추가, 비차단.
5. **(소) DX·테스트**: 사이사이 처리 가능한 작은 항목.

---

## P0 — 데이터 보존/정리 (retention & pruning)
**왜**: `Event`·`EventSnapshot`·`EventReplay`·`SourceMap`이 무한 증가한다. 특히 리플레이/스냅샷은 건당 수백 KB~1 MiB라 DB·디스크가 빠르게 커지고 조회 성능도 악화된다. 정리 잡이 없으면 운영에서 곧바로 병목.

**근거**: [데이터 모델](/database/data-model.md)(EventSnapshot/Replay 대용량 Bytes/JSONB), [ERD](/database/erd.md) L201(SourceMap 전량 메모리 로드), `packages/server/src/modules/replay/routes.ts`.

**범위(스케치)**:
- 보존기간 설정(env 전역 + 가능하면 프로젝트별). 대상별 차등(예: 리플레이 7~14일, 이벤트 30~90일).
- BullMQ **repeatable job**으로 주기 정리(워커에 이미 BullMQ 인프라 있음). 인덱스(`projectId`, `createdAt`) 활용한 배치 삭제, 한 번에 N건씩.
- 삭제 시 연관 정리(Event↔EventSnapshot 1:1, symbolicated 캐시). 메트릭/로그로 삭제량 노출.
- 검증: retention 경계 케이스 단위 테스트 + 실제 삭제 통합 테스트.

**의존성**: 없음(독립). 가장 먼저 권장.

---

## P1 — 리플레이 보안 하드닝 (stored-XSS 차단)
**왜**: 리플레이가 대시보드와 **같은 오리진**의 `allow-same-origin` iframe에서 렌더된다. 신뢰할 수 없는 녹화를 그대로 재생하면 stored XSS 위험. 실제/외부 녹화를 노출하기 전에 닫아야 하는 known limitation.

**근거**: [대시보드](/architecture/dashboard.md) L93, [브라우저 SDK](/architecture/sdk.md) L244, `packages/dashboard/src/pages/IssueDetailPage.tsx`(SECURITY 주석).

**범위(스케치)**:
- 리플레이 뷰를 **별도 오리진**(또는 최소권한 sandbox/`srcdoc`)에서 서빙해 대시보드 오리진과 격리. 정적 서브도메인/전용 라우트 + CSP 검토.
- (부수, 작게) 소스맵 메모리 로드 개선은 P2와 겹침 — 보안 범위 내에선 제외 가능.

**의존성**: 배포/오리진 구성과 맞물림(메모리: 운영 VPS+compose+Caddy). 운영 노출 전 처리.

---

## P2 — 소스맵 정확도 / 운영
**왜**: 프레임 매칭이 **basename-only**라 서로 다른 경로의 동명 파일(`app.js`)이 충돌할 수 있다. 또 조회 시 해당 릴리스 소스맵을 **전량 메모리 로드**해 대용량/다수 릴리스에서 부담. 삭제 API도 없다(upload+list만).

**근거**: `packages/server/src/modules/sourcemaps/symbolicate.ts`(`frameBasename`), [소스맵 API](/api/sourcemaps-api.md) "알려진 한계", [ERD](/database/erd.md) L201.

**범위(스케치)**:
- 매칭을 `release` + (가능하면) 전체 경로 기준으로 업그레이드해 동명 파일 오매칭 방지.
- 소스맵 **삭제 API**(`DELETE …/releases/:release/sourcemaps?filename=`) + 릴리스 단위 정리(P0 retention과 연계).
- 심볼리케이션 시 **필요한 파일만** 로드(프레임에 등장하는 basename/경로만 쿼리) — 전량 로드 회피.

**의존성**: P0(retention) 정책과 일부 연계. 정확도 개선은 독립 가능.

---

## P3 — 제품 기능 확장
**왜**: 핵심 파이프라인은 완성. 데모·실사용 가치를 높이는 사용자 대면 기능.

**후보**:
- 이슈 **검색/필터** 강화(레벨·릴리스·환경·기간·정렬), 이슈 **담당자/코멘트**.
- **환경(environment)·릴리스 추적**(이벤트에 env 태깅, 릴리스별 회귀 보기).
- 이벤트 **통계 차트** 개선(시계열 추세, 영향 사용자 수 등).

**의존성**: 일부는 스키마 추가 필요(environment 등). 비차단, 범위가 넓어 개별 티켓화 권장.

---

## (소) DX · 테스트 백로그
- **dev-up.ps1 견고화**: docker `info` 오탐 + `docker compose` stderr를 종료성 에러로 처리해 중간에 멈춤(인프라는 보통 기동됨). docker 체크 분리 + stderr 비리다이렉트 + 구간 ErrorAction 완화. (메모: dev-up-docker-stderr-abort)
- **대시보드 컴포넌트 테스트 환경 부재**: `ReplayPlayer` 등 UI 로직이 무테스트. @testing-library 등 도입 여부는 별도 결정(현재 새 라이브러리 임의 도입 금지 원칙).
- **리플레이 no-Meta 폴백**: Meta가 전혀 없는 녹화는 `1280×720`으로 추정 스케일(데이터에 크기 없음). 구 SDK 번들 녹화에서 발생 — 신규 녹화는 실제 뷰포트 보존. 데이터 한계라 플레이어 단독 해결 불가.

## 관련 개념
- [로드맵](/roadmap/roadmap.md) · [시스템 아키텍처](/architecture/system.md) · [데이터 모델](/database/data-model.md) · [소스맵 API](/api/sourcemaps-api.md)
