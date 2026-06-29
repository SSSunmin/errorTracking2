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
> 상태(2026-06-29): P0·P1·P2 핵심·P3 핵심 모두 **완료**. 잔여는 비차단 follow-up과 (소) DX뿐.
1. ~~**P0 — 데이터 보존/정리(retention)**~~ → **완료**(PR #6·#7). 무한 증가 방지 잡 가동.
2. ~~**P1 — 리플레이 보안 하드닝(별도 오리진)**~~ → **완료**(앱+배포 계층).
3. **P2 — 소스맵 정확도/운영**: 정확도·삭제·메모리 **완료**. 오브젝트 스토리지 이전만 비차단 잔여.
4. **P3 — 제품 기능 확장(검색/담당자/환경·릴리스/차트)**: 핵심 **완료**. `affectedUsers` 이메일 fallback만 잔여.
5. **(소) DX·테스트**: `dev-up.ps1` 견고화 등 사이사이 처리 가능한 작은 항목.

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

### 완료 (2026-06-22, PR #6·#7, feat/retention)
확정 계획(아래)의 구현 단계 1~7을 모두 코드로 반영·머지 완료. 리뷰 지적(W-1·2·3·5)도 PR #7에서 해소.
- **env**(`config/env.ts`): `RETENTION_ENABLED`(zod v4 `z.stringbool()`)·`RETENTION_REPLAY_DAYS`(14)·`SNAPSHOT_DAYS`(14)·`EVENT_DAYS`(90)·`BATCH_SIZE`·`CRON`. 소스맵은 범위 제외(릴리스 산출물).
- **인덱스 마이그레이션** `20260622063456_add_retention_indexes`: `EventReplay.createdAt`·`EventSnapshot.createdAt` 인덱스 추가(배치 삭제용).
- **큐/스케줄러**(`lib/queue.ts`): `getRetentionQueue`/`closeRetentionQueue`/`scheduleRetentionJob`(`upsertJobScheduler`로 멱등 등록). 큐 lazy 싱글톤 패턴 유지.
- **prune 배치 로직**(`modules/retention/prune.ts`): cutoff 계산 + LIMIT N 배치 삭제(배치 간 sleep, concurrency 1), 삭제 순서 `EventReplay`(독립 고아)→`EventSnapshot`→`Event`(snapshot cascade), 삭제량 `PruneResult` 반환. `RetentionPruneError`로 부분 진행 보존, `BatchDeleter` 주입으로 실패 경로 테스트.
- **워커**(`worker.ts`): retention Worker 등록(concurrency 1)·부팅 시 스케줄·completed/failed 로깅·shutdown에 `closeRetentionQueue`.
- **테스트** `tests/retention.test.ts`(8 green): cutoff 경계·disabled·대상별 차등·배치 경계·고아 replay 독립삭제·Event cascade.
- **OKF**: [데이터 보존/정리](/ops/retention.md) 개념 문서 + [환경변수](/config/environment.md)·index·log 갱신.
- **삭제 순서 정합성(2026-06-29 재확인)**: 이후 추가된 멤버십/담당자·코멘트/릴리스 회귀 마이그레이션 어느 것도 Event를 FK로 참조하지 않음(유일한 Event 참조는 `EventSnapshot.event` cascade). 삭제 순서 무영향.

**남은 follow-up(비차단)**: 릴리스 단위 retention(오래된 릴리스 소스맵 자동 정리)을 P2 소스맵 삭제 API와 묶는 건 미착수 — 현재 retention은 replay/snapshot/event만 대상.

### 확정 계획 (2026-06-22) — 구현됨(위 "완료" 참조)
코드 근거(impl-planner) 검토 후 결정·착수.

**확정 결정**:
- 보존기간(env 전역): 리플레이 14일 / 스냅샷 14일 / 이벤트 90일 / 소스맵 0(비활성).
- 정책 범위: **env 전역만**. 잡 로직은 "프로젝트별 cutoff 계산" 함수로 설계해 추후 Project override 확장 용이(후속 티켓).
- 소스맵: **이번 범위 제외** — 릴리스 산출물이라 시간 삭제 시 활성 릴리스 심볼리케이션 손상. P2(소스맵 삭제 API)와 통합.
- boolean env: zod v4 `z.stringbool()` (`RETENTION_ENABLED`).
- 인덱스 마이그레이션: 일반 `CREATE INDEX`(Phase 1·소규모). 운영 대용량 전환 시 `CONCURRENTLY` 수동 — 운영 노트.

**핵심 코드 사실**:
- `Event→EventSnapshot` 1:1, FK `onDelete: Cascade` → Event 삭제 시 snapshot 자동 정리.
- `Event↔EventReplay` **FK 없음**(`clientEventId` 문자열 매칭) → Event 지워도 **리플레이 고아 잔존 → 독립 삭제 필수**(이 P0의 핵심 위험).
- `EventReplay`·`EventSnapshot`은 `createdAt` 단독 인덱스 부재 → 배치 삭제용 인덱스 추가 필요.
- BullMQ 큐는 `ingest-events` 하나뿐, repeatable job 없음. 큐 lazy 싱글톤 패턴(`lib/queue.ts`), 워커 별도 프로세스(`worker.ts`).

**구현 단계**:
1. env 스키마 확장(`config/env.ts`에 `RETENTION_*`).
2. 마이그레이션: `EventReplay`/`EventSnapshot`에 `createdAt`(또는 `[projectId, createdAt]`) 인덱스.
3. retention 큐/스케줄러 인프라(`lib/queue.ts` `getRetentionQueue`/`closeRetentionQueue`, `upsertJobScheduler`로 멱등 등록, `app.ts` onClose 연결).
4. prune 배치 로직(`modules/retention/prune.ts`): cutoff 계산 + LIMIT N 배치 삭제(배치 단위 커밋, 배치 간 sleep, concurrency 1). 순서 `EventReplay`(독립)→`Event`(snapshot cascade). 삭제량 메트릭 반환.
5. 워커 등록 + 스케줄러 부트스트랩(`worker.ts`에 retention Worker, completed/failed 로깅, shutdown에 close).
6. Vitest 테스트: cutoff 경계·disabled·대상별 차등·배치 경계·고아 replay 독립삭제·Event cascade.
7. OKF 문서(retention 개념 + index/log, env 문서).

**위험**: 단일 트랜잭션 대량삭제 금지(lock/WAL) → 배치 필수. 고아 EventReplay 독립 삭제 누락 시 리플레이 영구 잔존. DELETE 후 디스크는 autovacuum 의존(운영 모니터링).

---

## P1 — 리플레이 보안 하드닝 (stored-XSS 차단)
**왜**: 리플레이가 대시보드와 **같은 오리진**의 `allow-same-origin` iframe에서 렌더됐다. 신뢰할 수 없는 녹화를 그대로 재생하면 stored XSS 위험.

**근거**: [대시보드](/architecture/dashboard.md)(오리진 격리 절), `packages/dashboard/src/pages/IssueDetailPage.tsx`.

### 앱 계층 격리 — 완료 (2026-06-23, PR #8, feat/replay-origin-isolation)
- `VITE_REPLAY_ORIGIN` 설정 시 리플레이/스냅샷을 별도 오리진 `replay-viewer.html`(cross-origin iframe + postMessage 브리지)에서 렌더 → 뷰어는 토큰·네트워크 없음, 신뢰 못 할 녹화가 대시보드 토큰·DOM·`/api`에 도달 불가. 비어있으면 기존 인페이지 렌더(로컬 dev).
- rrweb 렌더 코어 `src/replay/render.ts` 단일화, 신뢰경계 `src/replay/messaging.ts`(순수함수+테스트 12), iframe `sandbox`, 뷰어 CSP `<meta>`.

### 남은 follow-up — 배포 계층 — 완료 (2026-06-23, feat/replay-deploy-hardening)
앱 코드만으론 못 막는 두 가지 + 미코드화 운영 배포를 코드화. 상세: [운영 배포](/ops/deployment.md).
- **`frame-ancestors` 헤더 — 완료**: `deploy/Caddyfile`의 `{$REPLAY_DOMAIN}` 사이트블록이 응답에 `Content-Security-Policy: frame-ancestors https://{$DASHBOARD_DOMAIN}`를 준다(임의 사이트의 뷰어 iframe 임베드=클릭재킹 차단). `<meta>` 불가 → 서빙 계층 헤더로만 가능.
- **`replay.<host>` 서브도메인 서빙 — 완료**: Caddy가 같은 dist 번들을 `{$DASHBOARD_DOMAIN}`(SPA+`/api` 프록시)와 `{$REPLAY_DOMAIN}`(뷰어 정적·SPA fallback/`/api` 없음 격리) 두 오리진에 서빙. 자동 TLS(운영 VPS) / Cloudflare Tunnel(테스트) 주석.
- **운영 docker-compose — 완료**: `docker-compose.prod.yml`(postgres/redis/migrate/server/worker/caddy) + `packages/server/Dockerfile`(멀티스테이지, server/worker/migrate 이미지 공유) + `deploy/Dockerfile.dashboard`(Vite 빌드→Caddy, `VITE_REPLAY_ORIGIN` 빌드 ARG) + `.env.prod.example`. 1회성 `migrate` 서비스(`prisma migrate deploy`) 완료 후 server/worker 기동.
- **참고**: 빌드타임 env는 `VITE_REPLAY_ORIGIN`(compose가 caddy 빌드 ARG로 전달). dev compose는 무수정.

**의존성**: (해소됨) 배포/오리진 구성.

---

## P2 — 소스맵 정확도 / 운영
**왜**: 프레임 매칭이 **basename-only**라 서로 다른 경로의 동명 파일(`app.js`)이 충돌할 수 있다. 또 조회 시 해당 릴리스 소스맵을 **전량 메모리 로드**해 대용량/다수 릴리스에서 부담. 삭제 API도 없다(upload+list만).

**근거**: `packages/server/src/modules/sourcemaps/symbolicate.ts`, [소스맵 API](/api/sourcemaps-api.md) "알려진 한계", [ERD](/database/erd.md) L201.

### 완료 (2026-06-23, PR 진행, feat/sourcemap-precision-delete)
- **정밀도**: basename 완전일치 → **경로 접미사(suffix) 매칭**으로 격상(`pathSegments`/`resolveTracerName`, 가장 긴 일치 우선). 저장 키는 정규화 상대 경로(`canonicalArtifactName`), CLI는 `--dir` 기준 상대 경로 전송. basename-only 업로드는 무회귀.
- **삭제 API**: `DELETE …/releases/:release/sourcemaps` — `?filename=`이면 단일, 생략하면 릴리스 전체. 삭제 시 `Event.symbolicated` 캐시 무효화. (`{ deleted: number }`)
- **메모리**: `loadSourceMapsByName` **2단계 로드** — `filename`만 싸게 조회 → 프레임에 등장하는 basename에 해당하는 행의 `data` blob만 로드. 안 쓰는 맵은 gunzip 안 함.
- 테스트 +11(suffix 매칭 단위 4, delete 통합 5, 경로 정밀도 통합 1, 입력검증 1). 전체 149 green.

### 남은 follow-up (비차단)
- **오브젝트 스토리지 이전**: 참조된 맵은 여전히 전부 메모리에 gunzip. 진짜 대용량은 S3류 외부 스토리지로 이전 여지.
- **릴리스 단위 retention 연계**: 삭제 API를 P0 retention 잡과 묶어 오래된 릴리스 소스맵 자동 정리(현재는 수동 호출만).

**의존성**: P0(retention) 정책과 일부 연계. 정확도/삭제/메모리는 완료.

---

## P3 — 제품 기능 확장
**왜**: 핵심 파이프라인은 완성. 데모·실사용 가치를 높이는 사용자 대면 기능.

**후보**:
- 이슈 **검색/필터** 강화(레벨·릴리스·환경·기간·정렬), 이슈 **담당자/코멘트**.
- **환경(environment)·릴리스 추적**(이벤트에 env 태깅, 릴리스별 회귀 보기).
- ~~이벤트 **통계 차트** 개선(시계열 추세, 영향 사용자 수 등).~~ → **완료**(아래)

### 통계 차트 개선 — 완료 (2026-06-23, feat/stats-charts)
- 이슈 stats(`GET /:id/issues/:issueId/stats`) 응답에 `affectedUsers` 추가 — window 내 distinct `userContext->>'id'`(SDK `user.id`), null id 제외. 마이그레이션 없음.
- 프로젝트 단위 stats 신설: `GET /api/projects/:id/stats?window=24h|7d` → `{ buckets, totalEvents, affectedUsers }`. 프로젝트 전체 이벤트(모든 이슈 합산) 버킷 집계. 소유권 미보유 404.
- 대시보드: `IssueDetailPage`에 "영향 사용자 N명" 표시. `IssuesPage` 상단에 프로젝트 추세 차트(기존 SVG `StatsChart` 재사용) + 24h/7d 토글 + 전체/영향 사용자 요약.
- 테스트 +4(affectedUsers distinct/null/타이슈·window 제외, 프로젝트 합산, 프로젝트 격리, 소유권 404). 전체 160 green. 근거: [이슈 API](/api/issues-api.md)·[프로젝트 API](/api/projects-api.md) 갱신.
- **follow-up**: ① ~~bucket별 사용자 수(시계열)~~ → **완료(2026-06-29)**: project/issue stats 양쪽 `buckets[].users`(버킷별 distinct `user.id`) 추가 + 대시보드 `StatsChart` 영향-사용자 추세 오버레이. window 총합 `affectedUsers`는 중복 제거 위해 별도 쿼리 유지. 테스트 +2(버킷별 distinct 결정적 검증, 전체 201 green). ② ~~인덱스(`Event.receivedAt`)~~ → **이미 존재**(스키마에 `@@index([projectId, receivedAt])` — stats 쿼리 `projectId=? AND receivedAt>=?`를 커버. 2026-06-22 백로그 노트가 인덱스 추가 이전이라 outdated였음). ③ `affectedUsers`는 `user.id` 기준만 — 이메일 등 fallback 식별자는 여전히 범위 외(미착수).

### 검색/필터 강화 — 완료 (2026-06-23, feat/issue-search-filters)
- `GET /:id/issues`에 필터 4종 추가(마이그레이션 없음): `level`(Issue.level 직접일치), `release`/`environment`(해당 이벤트를 가진 이슈만 — `events.some`, 둘 다 주면 같은 이벤트가 동시 충족), `since`/`until`(Issue.lastSeen inclusive 범위, since>until→400). 기존 status/query/sort/cursor 유지.
- 대시보드 `IssuesPage`에 레벨 셀렉트·환경/릴리스 입력·기간(date) 입력 추가(로컬 날짜→UTC inclusive 경계 변환).
- 테스트 +7(level/release/environment/combined/range/검증). 전체 156 green. 근거: [소스맵 API](/api/issues-api.md) 갱신.
- **follow-up**: ① ~~`Event.release`·`environment` 인덱스 부재~~ → **완료(2026-06-23, feat/issue-filter-followup)**: `@@index([projectId, release])` / `@@index([projectId, environment])` 추가(마이그레이션 `20260623042723_event_release_env_index`). ② ~~release/environment 자동완성 드롭다운~~ → **완료(동 PR)**: `GET /:id/issues/facets`(distinct release/environment, null 제외·asc·각 ≤100) 신설 + 대시보드 `<datalist>` 자동완성(자유 텍스트 유지). ③ 통계 차트 개선은 미착수(이슈 담당자/코멘트는 C3b, 릴리스 회귀 보기는 별도 완료).

### 팀/멤버십 모델 + 접근제어 재설계 (C3a) — 완료 (2026-06-23, feat/team-membership)
- 단일 소유자(`Project.ownerId`) → **멤버십 기반 접근제어**. 새 모델 `ProjectMember(projectId, userId, role: owner|member)` + enum `ProjectRole`. 마이그레이션 `20260623120000_project_membership`(기존 프로젝트 owner를 멤버로 백필).
- 4개 서비스(`projects`/`issues`/`sourcemaps`/`alert-rules`)의 접근 헬퍼를 `members: { some: { userId } }`로 교체(시그니처 유지, 최소 diff). update/delete는 멤버십 선검사 후 `{id}`로 수행. **owner 전용**: 프로젝트 삭제(`{id, ownerId}` 유지), 멤버 관리.
- 멤버 관리 API 4종(`GET/POST /:id/members`, `PATCH/DELETE /:id/members/:userId`): owner 전용 판정 `userId === Project.ownerId`. 소유자 강등/제거 방지(400), 중복 409, 미존재 User 404. 대시보드 `MembersPage` + 이슈 페이지 링크.
- 테스트 +5(membership.test.ts: owner membership 생성/멤버 접근·비멤버 404/listProjects 포함/비owner 거부/멤버 CRUD). 전체 161 green. 근거: [데이터 모델](/database/data-model.md), [프로젝트 API](/api/projects-api.md).
- **불변식 유지**: 소유자가 모든 걸 하던 기존 테스트 전부 통과(백필로 owner가 멤버이므로).

### 이슈 담당자 + 코멘트 (C3b) — 완료 (2026-06-23, feat/issue-assignee-comments)
- 스키마: `Issue.assigneeId?`(→User, `onDelete: SetNull`, `@@index([assigneeId])`) + 새 모델 `IssueComment(issueId, authorId, body, createdAt, @@index([issueId, createdAt]))`. 마이그레이션 `20260623130000_issue_assignee_comments`.
- 담당자: `PATCH /:id/issues/:issueId/assignee` `{ assigneeId: string|null }`. 멤버 접근(비멤버 404), 지정 대상은 **해당 프로젝트 멤버여야 함**(`ProjectMember` 확인, 아니면 400 — 단순 User 존재로는 불충분). `assignee:{userId,email,name}|null`을 getIssue·listIssues(relation include) 양쪽에 노출.
- 코멘트: `GET/POST /:id/issues/:issueId/comments`(멤버 접근, 목록 createdAt asc·최대 200, body 트림 1–5000자), `DELETE .../comments/:commentId`(작성자 본인 또는 owner-role 멤버만, 그 외 403, 없으면 404).
- 대시보드: `IssueDetailPage`에 담당자 셀렉트(멤버 목록 재사용) + 코멘트 스레드(목록/작성/삭제 — 작성자·owner에게만 삭제 버튼). `api.ts`에 setAssignee/listComments/addComment/deleteComment.
- 테스트 +7(issueAssigneeComments.test.ts: 지정/해제·비멤버 지정 400·비멤버 호출 404·노출, 코멘트 생성/순서·비멤버 404·삭제 권한 3종·미존재 404·빈 body 400). 전체 170 green.
- **설계 판단**: 담당자 검증은 멤버십(존재만 X)으로 외부인 배정 차단. 코멘트 삭제 권한은 멤버 권한 모델(owner-role)과 일관 — 작성자 self-delete + owner 모더레이션.

### 릴리스 회귀 보기 — 완료 (2026-06-23, feat/release-regression-view)
- 스키마+마이그레이션(`20260623120000_release_regression_tracking`): `Issue.firstRelease String?`(최초 생성 시 이벤트 release 기록), `Event.isRegression Boolean @default(false)`(회귀를 일으킨 이벤트만 true), `@@index([projectId, release, isRegression])`.
- `process.ts`(핫패스, 보수적 수정): create 시 `firstRelease` optional-spread 저장, 이벤트 create data에 `isRegression: regressed` 추가. fingerprint-conflict 재시도 경로도 동일 동작.
- `GET /:id/releases/:release/issues` → `{ release, newIssues, regressedIssues }`. newIssues=`firstRelease===release`, regressedIssues=`events.some(isRegression && release)` distinct 이슈, 각 lastSeen desc·최대 100. `ensureOwnedProject` 선행(미소유 404).
- 대시보드 `ReleasesPage`(신규 라우트 `/projects/:projectId/releases`, IssuesPage에 링크 추가), `api.getReleaseIssues`.
- 테스트 +7(process 2: firstRelease/isRegression true·false, 엔드포인트 5: newIssues/regressedIssues/격리/빈결과/소유권404). 전체 162 green.

**의존성**: 일부는 스키마 추가 필요(environment 등). 비차단, 범위가 넓어 개별 티켓화 권장.

---

## (소) DX · 테스트 백로그
- ~~**dev-up.ps1 견고화**~~ → **완료(2026-06-29)**: `docker compose start`의 stderr가 `$ErrorActionPreference='Stop'` 하에서 종료성 `NativeCommandError`로 둔갑해 39번째 줄에서 스크립트가 중단되던 문제(`up -d` 폴백 도달 못 함) 해결. native(docker) 호출만 `ErrorActionPreference='Continue'`로 감싸고 **종료코드로만 성공 판정**하는 `Invoke-Native` 헬퍼 도입(docker info/compose start/up 모두 경유), `up -d`마저 실패 시 명시적 throw. 검증: PS 5.1에서 옛 방식=중단 재현·새 헬퍼=exit code 반환·계속 진행, 실제 `compose start`/`info` exit 0 확인.
- ~~**대시보드 컴포넌트 테스트 환경 부재**~~ → **완료(2026-06-29)**: 새 라이브러리(@testing-library 등) 도입 없이 기존 자산만으로 해결. vitest를 `server`(DB·globalSetup·직렬)/`ui`(무DB) **projects 2개로 분리** → UI/SDK 유닛 테스트가 Postgres 없이 실행 가능(`fileParallelism`은 루트 전용 옵션이라 루트에 유지). 순수 프레젠테이션 컴포넌트는 `react-dom/server`의 `renderToStaticMarkup`로 검증(`packages/dashboard/src/components.test.tsx`: StatsChart 분기·relativeTime 경계·badges, +7). **남은 한계**: `ReplayPlayer` 등 stateful/effectful 컴포넌트는 여전히 무테스트(jsdom 환경은 SDK처럼 `// @vitest-environment jsdom` 프라그마로 진입 가능하나 rrweb/캔버스 의존이라 별도 작업 필요).
- **리플레이 no-Meta 폴백**: Meta가 전혀 없는 녹화는 `1280×720`으로 추정 스케일(데이터에 크기 없음). 구 SDK 번들 녹화에서 발생 — 신규 녹화는 실제 뷰포트 보존. 데이터 한계라 플레이어 단독 해결 불가.

## 관련 개념
- [로드맵](/roadmap/roadmap.md) · [시스템 아키텍처](/architecture/system.md) · [데이터 모델](/database/data-model.md) · [소스맵 API](/api/sourcemaps-api.md)
