# Change Log

OKF 번들의 변경 이력. 최신 항목이 위.

## 2026-06-29 (P3 — 프로젝트 환경별 집계 뷰)
- **API 신설**: `GET /api/projects/:id/environments?window=24h|7d` → `{ environments: [{ environment: string|null, events, issues, affectedUsers }] }`. 이벤트를 `GROUP BY "environment"`로 롤업(환경별 이벤트 수·distinct 이슈·distinct 영향 사용자). null environment(태그 없음)는 한 행으로 합산. 정렬 `events DESC, "environment" ASC NULLS LAST`(결정적). 식별 키는 기존 stats와 동일한 `COALESCE(NULLIF(id,''),…email,…username)`. 소유권 미보유 404. 마이그레이션 없음(기존 `@@index([projectId, environment])` 활용).
- **코드**: `modules/projects/{schemas,service,routes}.ts`(`projectEnvironmentStatsResponseSchema`·`getProjectEnvironmentStats`·라우트, window 스키마/`getOwnedProject` 재사용). raw SQL은 `${projectId}`/`${since}` 파라미터화(A03 안전), bigint→Number 변환.
- **대시보드**: `IssuesPage`에 "환경별 분포" 카드(테이블, 환경명 클릭 시 기존 환경 필터 연동, null은 "(미지정)", isError 폴백). `api.getProjectEnvironments` + `EnvironmentStat` 타입.
- **테스트(`tests/environmentStats.test.ts`, +4)**: 그룹화·정렬·null 행, 환경 간 중복 사용자 독립 카운트·user 없는 이벤트 제외, window 제외, 프로젝트 격리+비멤버 404. 전체 231 green, typecheck·lint·dashboard build clean.
- **리뷰**: code-reviewer 별도 패스. 반영: IssuesPage `isError` 폴백(무한 Spinner 방지), `ORDER BY … NULLS LAST` 명시, 환경 간 중복 사용자 테스트 추가. (afterEach 정리 지적은 서버 프로젝트가 `setup.ts` beforeEach TRUNCATE로 전역 처리해 불요.)
- **OKF**: [프로젝트 API](/api/projects-api.md) `GET /:id/environments` 절 + index 갱신.

## 2026-06-29 (P0/P2 follow-up — 릴리스 단위 고아 소스맵 정리)
- **코드(`config/env`·`modules/retention/prune`)**: P0 retention 잡에 `SourceMap` 정리 단계 추가. 시간 단독이 아니라 **고아 릴리스**(`(projectId, release)`에 `Event`가 하나도 안 남음) + **grace**(`createdAt < cutoff`)인 맵만 삭제 — 활성 릴리스(이벤트 잔존)·신규 업로드(grace 내) 맵은 보호. 원래 P0가 소스맵을 제외한 이유("업로드 시각 기준 삭제 시 활성 릴리스 심볼리케이션 손상")를 정확히 해소. `RETENTION_SOURCEMAP_DAYS`(기본 0=비활성, 옵트인) 신설. prune 순서 replay→snapshot→event→**sourcemap**(마지막: 이벤트 prune 후 고아 상태를 봄, 같은 패스에서 정리된 릴리스 맵까지 연쇄). `pruneOrphanSourceMaps`(주입 가능한 `OrphanSourceMapDeleter`)·`PruneResult.sourcemap` 추가. 마이그레이션 없음(기존 `Event(projectId, release)` 인덱스 재사용).
- **테스트(`tests/retention`)**: +7(고아 삭제·활성 릴리스 보호·grace 보호·disabled·이벤트prune 연쇄·배치 드레인·크로스프로젝트 격리), `err.partial.sourcemap` 단언 추가. retention 15 green, 전체 217 green, typecheck·lint clean.
- **리뷰**: code-reviewer 별도 패스 — critical/보안 없음. SQL 정합성(A03: NOT EXISTS·`projectId`+`release` 매칭, 파라미터 바인딩, 상수 식별자)·NULL release 처리·활성 릴리스 보호 모두 정상 확인. 지적 반영: `batchSize<=0` 무한루프 가드(신규+기존 `pruneTable`), 배치실패 테스트 `sourcemap` partial 검증, 크로스프로젝트 격리 테스트.
- **OKF 갱신**: [데이터 보존/정리](/ops/retention.md)에 *고아 소스맵* 절·삭제 순서 4단계·env 표·인덱스 노트 추가, [환경설정](/config/environment.md) `RETENTION_SOURCEMAP_DAYS` 행, [백로그](/roadmap/backlog.md) P0·P2 follow-up 완료 기록.

## 2026-06-29 (P3 통계 follow-up — affectedUsers 이메일/유저네임 폴백)
- **코드(`modules/issues/service`·`modules/projects/service`)**: 영향 사용자 distinct 집계 키를 `user.id` 단독 → `COALESCE(NULLIF(id,''), NULLIF(email,''), NULLIF(username,''))`로 확장(4개 쿼리: issue/project × 버킷·window총합). `id` 없이 `email`/`username`만 가진 이벤트도 카운트(Sentry 식별 우선순위), `NULLIF`로 빈 문자열 id가 폴백을 막거나 유령 사용자로 뭉치는 것 방지. `COUNT(DISTINCT …)`가 NULL을 무시하므로 기존 `FILTER/WHERE … IS NOT NULL`은 제거(중복). 마이그레이션 없음.
- **테스트(`tests/statsCharts`)**: 기존 "email-only 제외" 단언을 새 의미(카운트됨)로 갱신 + 폴백 전용 테스트 추가(id 우선·email/username 폴백·빈 문자열 id→email). 전체 210 green, typecheck clean.
- **리뷰**: code-reviewer가 빈 문자열 id 엣지(🔴)를 지적 → `NULLIF` 보강으로 해소. SQL 인젝션 없음(COALESCE 키는 상수, projectId/since는 파라미터화).
- **API 갱신(`api/issues-api`·`api/projects-api`)**: `affectedUsers`/`buckets[].users` 식별 키 설명을 폴백 식(id→email→username)으로 수정, 교차 식별자 미해소 한계 명시("이메일 등 fallback 범위 외" 문구 제거).
- **백로그(`roadmap/backlog`)**: P3 통계 follow-up ③(이메일 fallback) 완료 기록.

## 2026-06-29 (DX — dev-up.ps1 견고화)
- **스크립트(지식 외)** `scripts/dev-up.ps1`: `docker compose start`의 stderr가 스크립트 전역 `$ErrorActionPreference='Stop'` 하에서 종료성 `NativeCommandError`로 처리돼 39번째 줄에서 중단(→`up -d` 폴백 도달 못 함)되던 버그 수정. native(docker) 호출만 `ErrorActionPreference='Continue'`로 감싸 **종료코드로만 성공 판정**하는 `Invoke-Native { }` 헬퍼 도입(docker info/compose start/up 경유), `up -d`도 실패 시 명시적 throw로 Wait-For 타임아웃 대신 빠른 실패. 검증(PS 5.1): 옛 방식 중단 재현 + 새 헬퍼 exit code 반환·계속 진행, 실제 `compose start`/`info` exit 0.
- **백로그(`roadmap/backlog`)**: "(소) DX"의 dev-up.ps1 견고화 완료 기록.

## 2026-06-29 (문서 정정 — P0 retention 완료 상태 반영)
- **백로그(`roadmap/backlog`)**: P0 "데이터 보존/정리"가 코드상 이미 완료(PR #6·#7)인데 backlog는 "확정 계획(착수 예정)" 톤으로 뒤처져 있던 불일치 정정. impl-planner 재확인 + `retention.test.ts` 8 green 실행 확인 후 P0 섹션에 "### 완료 (2026-06-22, PR #6·#7)" 블록 추가(env·인덱스 마이그레이션·큐/스케줄러·prune 배치·워커·테스트·OKF 7단계 모두 구현 근거 명시), "권장 작업 순서" 요약도 현재 완료 상태로 갱신. 코드 변경 없음(문서만).
- **재확인 사실**: 2026-06-22 이후 추가된 멤버십/담당자·코멘트/릴리스 회귀 마이그레이션 어느 것도 Event를 FK로 참조하지 않음(유일한 Event 참조는 `EventSnapshot.event` cascade) → retention 삭제 순서 무영향.

## 2026-06-29 (DX — 대시보드 컴포넌트 테스트 환경)
- **테스트 인프라(지식 외)**: `vitest.config.ts`를 `server`/`ui` **projects 2개로 분리**. `server`(DB 의존 통합 테스트)만 `globalSetup`(테스트 DB 생성+마이그레이션)·`setupFiles`(per-file TRUNCATE)를 받고, `ui`(dashboard/sdk/examples 유닛)는 인프라 없이 실행. `fileParallelism: false`는 vitest 루트 전용 옵션이라 루트 유지(server는 단일 DB 공유→직렬 필수). 이로써 SDK/대시보드 테스트가 Postgres 없이 돌아감(증명: `TEST_DATABASE_URL` 미설정으로 `--project ui` 49 green).
- **신규 테스트(지식 외)**: `packages/dashboard/src/components.test.tsx`(+7) — 순수 컴포넌트를 `react-dom/server` `renderToStaticMarkup`로 검증(새 라이브러리 도입 0). StatsChart 분기(빈 상태/hasUsers false·단일·다중 버킷 polyline≥2 조건), relativeTime 단위 경계, badges 한국어 레이블+클래스. 전체 209 green, typecheck·lint clean.
- **백로그(`roadmap/backlog`)**: "(소) DX·테스트"의 "대시보드 컴포넌트 테스트 환경 부재"를 완료로 갱신, 남은 한계(ReplayPlayer 등 stateful 컴포넌트) 명시.

## 2026-06-29 (P3 통계 follow-up — 버킷별 영향 사용자 시계열)
- **API 갱신(`api/projects-api`·`api/issues-api`)**: project/issue stats 응답의 `buckets[]`에 `users`(버킷별 distinct `userContext->>'id'`) 추가. window 총합 `affectedUsers`는 중복 제거 위해 별도 쿼리 유지(버킷별 합과 다름 명시).
- **백로그(`roadmap/backlog`)**: P3 통계 follow-up ①(bucket별 사용자 시계열) 완료 기록. ②(`Event.receivedAt` 인덱스)는 **이미 존재**(`@@index([projectId, receivedAt])`)로 정정 — 2026-06-22 노트가 outdated였음.
- **코드(지식 외)**: `projects/service.ts`·`issues/service.ts` 버킷 SQL에 distinct-users 집계 추가, 응답 zod 스키마 2종에 `users` 필드, 대시보드 `StatBucket` 타입 + `StatsChart`에 영향-사용자 추세 오버레이(polyline). 테스트 +2(버킷별 distinct 결정적 검증). 전체 201 green.

## 2026-06-23 (P1 배포 계층 보안 하드닝 — feat/replay-deploy-hardening)
- **개념 신규(`ops/deployment`)**: 운영 배포 스택 문서화. 서비스 구성표(postgres/redis/migrate/server/worker/caddy, 외부 노출은 Caddy 80/443만, 이미지 1개 공유), 두 오리진(`{$DASHBOARD_DOMAIN}` SPA+`/api` 프록시 / `{$REPLAY_DOMAIN}` 격리 정적+`frame-ancestors` CSP), 보안 근거(별도 오리진·frame-ancestors는 `<meta>` 불가→Caddy 헤더), 기동/마이그레이션(1회성 `migrate` 서비스 `prisma migrate deploy`→server/worker `service_completed_successfully` 대기)/TLS(운영 자동 vs Cloudflare Tunnel), env(`VITE_REPLAY_ORIGIN`은 빌드 ARG), 한계(SDK 서빙 제외·node_modules 통째 복사) 명시.
- **백로그(`roadmap/backlog`)**: P1 "남은 follow-up — 배포 계층"을 완료로 갱신(frame-ancestors·replay 서브도메인·운영 compose 3종 코드화, `ops/deployment` 링크).
- **index.md**: 설정/운영 섹션에 `ops/deployment` 항목 추가.
- **코드(지식 외)**: `packages/server/Dockerfile`(멀티스테이지, server/worker/migrate 공유), `deploy/Dockerfile.dashboard`(Vite→Caddy, `VITE_REPLAY_ORIGIN` ARG), `deploy/Caddyfile`(2 오리진·frame-ancestors·Tunnel 주석), `docker-compose.prod.yml`, `.env.prod.example` 신규. `.gitignore`에 `.env.prod` 추가, `packages/dashboard/.env.example` 주석에 deploy/ 참고 한 줄.

## 2026-06-24 (프로젝트 설정·DSN 키 owner-role 게이팅 — feat/dashboard-ux-profile, PR #18 리뷰 반영)
- **접근제어 강화**: `updateProject`·`createProjectKey`·`rotateProjectKey`·`updateProjectKey`를 멤버십 검사(아무 member) → **owner 역할 전용**(`getAdminProject` 신규 헬퍼)으로 전환. 멤버 관리(owner-only)와 정책 일치. 비멤버 404·비owner 멤버 403. 읽기(GET project/keys/members)와 이슈 작업은 멤버 그대로.
- **프로젝트 API(`api/projects-api`)**: 접근제어 절 + PATCH/:id·키 변경 3종에 owner-role 전용 명시. (기존 문서의 "프로젝트 삭제 404" 오기 → 코드·테스트대로 **403** 정정.)
- **테스트**: `membership.test.ts` +1(비owner 멤버의 설정 수정·키 생성/회전/토글 403, 승격된 owner-role 멤버는 200/201). 멤버십 8 green.
- **DB(`database/data-model`)**: `Issue.assigneeId?`(→User, `onDelete: SetNull`, `@@index([assigneeId])`) + `assignee`/`comments` 관계 추가. 새 모델 `IssueComment(issueId→Issue Cascade, authorId→User Cascade, body, createdAt, @@index([issueId, createdAt]))`. `User`에 `assignedIssues[]`·`comments[]` 역관계. 모델 수 12→13. 마이그레이션 `20260623130000_issue_assignee_comments`(드리프트 회피 위해 SQL 수기 작성 후 `migrate deploy` 적용 — 공유 dev DB).
- **이슈 API(`api/issues-api`)**: 엔드포인트 3종 추가. `PATCH /:id/issues/:issueId/assignee`(멤버 접근, assigneeId null 가능, 비null은 **프로젝트 멤버여야** 함→아니면 400). `GET/POST /:id/issues/:issueId/comments`(멤버 접근, 목록 createdAt asc·최대 200, body 트림 1–5000자). `DELETE .../comments/:commentId`(작성자 본인 또는 owner-role 멤버만→403, 없으면 404). `IssueListItem`에 `assignee:{userId,email,name}|null`(목록·상세 양쪽, relation include). 새 응답 타입 `IssueComment`.
- **대시보드**: `IssueDetailPage`에 담당자 셀렉트(members 쿼리 재사용) + `CommentsSection`(목록/textarea 작성/삭제 — 작성자·owner에게만 삭제 버튼, useAuth.user.id + 멤버 role로 판정). `api.ts`에 `IssueAssignee`/`IssueComment` 타입 + setAssignee/listComments/addComment/deleteComment.
- **테스트**: `issueAssigneeComments.test.ts` +7. 전체 170 green(회귀 0 — 기존 `listIssuesResponseSchema` 사용처는 assignee 추가로도 통과). typecheck·lint clean.
- **설계 판단**: 담당자는 멤버십 검증(단순 User 존재 X)으로 외부인 배정 차단. 코멘트 삭제 권한은 멤버 권한 모델과 일관(작성자 self-delete + owner 모더레이션).

## 2026-06-23 (P3 팀/멤버십 모델 + 접근제어 재설계 — feat/team-membership)
- **DB(`database/data-model`)**: 새 모델 `ProjectMember(projectId, userId, role)` + enum `ProjectRole(owner|member)` 추가. `User.memberships[]`·`Project.members[]` 관계 추가. `Project.ownerId`는 소유자 포인터로 유지(접근제어는 멤버십 기반). 마이그레이션 `20260623120000_project_membership`(기존 프로젝트 owner를 owner-role 멤버로 백필).
- **접근제어**: 단일 소유자(`ownerId` 일치) 검사 → 멤버십(`members.some.userId`) 검사로 전환. 4개 서비스(`projects`/`issues`/`sourcemaps`/`alert-rules`)의 ensure/get 헬퍼·`listProjects`·`createProject`(owner membership nested create)·update/delete where 교체(시그니처 유지, 최소 diff). **owner 전용**: 프로젝트 삭제(`{id, ownerId}` 유지), 멤버 관리.
- **프로젝트 API(`api/projects-api`)**: 접근제어 멤버십 기반 명시 + 멤버 관리 4종(`GET/POST /:id/members`, `PATCH/DELETE /:id/members/:userId`) 문서화. GET은 멤버, 나머지는 owner 전용. 소유자 강등/제거 400, 중복 409, 미존재 User 404.
- **대시보드**: `MembersPage` 신규(멤버 목록 + owner일 때 이메일 추가/역할/삭제), 라우트 `/projects/:projectId/members`, 이슈 페이지에 링크. `api.ts`에 listMembers/addMember/updateMemberRole/removeMember.
- **테스트**: `membership.test.ts` +5. 전체 161 green(기존 회귀 0 — 소유자 백필로 불변식 유지).

## 2026-06-23 (P3 이슈 필터 follow-up — facets 엔드포인트 + 인덱스 + 자동완성 — feat/issue-filter-followup)
- **이슈 API(`api/issues-api`)**: `GET /:id/issues/facets` 신규 문서화 — 프로젝트 이벤트의 distinct release/environment(null 제외, asc, 각 최대 100)를 `{ releases, environments }`로 반환(JWT+소유권). 자유 텍스트 필터의 자동완성용. `GET /:id/issues`의 "알려진 한계" 2종(인덱스 부재·자동완성 미구현)을 해소 내용으로 교체(인덱스 추가됨, facets 엔드포인트 제공). 코드: `modules/issues/{service,schemas,routes}.ts`.
- **DB**: `Event`에 `@@index([projectId, release])` / `@@index([projectId, environment])` 추가(마이그레이션 `20260623042723_event_release_env_index`, 인덱스 전용 — 생성 클라이언트 타입 변화 없음).
- **대시보드**: `api.ts`에 `listIssueFacets(projectId)`, `IssuesPage`가 facets useQuery로 환경/릴리스 input에 `<datalist>` 자동완성 부착(자유 텍스트 유지).
- **테스트**: `tests/issueFacets.test.ts` 신규 5개(distinct/중복제거·null 제외·프로젝트 스코프·빈 배열·비소유 404). typecheck·lint 클린, 전체 161 green(156+5).
- **index.md**: 이슈 API 설명에 facets 엔드포인트 명시.

## 2026-06-23 (P3 릴리스 회귀 보기 — feat/release-regression-view)
- **이슈 API(`api/issues-api`)**: `GET /:id/releases/:release/issues` 엔드포인트 추가 반영(`{ release, newIssues, regressedIssues }`). 판별 로직 명시 — newIssues=`Issue.firstRelease===release`, regressedIssues=`Event.isRegression && release` distinct 이슈. `:release` URL 세그먼트 디코드/검증(1–256자), `ensureOwnedProject` 선행(미소유 404), 각 목록 lastSeen desc·최대 100.
- **데이터 모델(`database/data-model`)**: `Issue.firstRelease String?`(최초 생성 시 이벤트 release 기록), `Event.isRegression Boolean @default(false)`(회귀 유발 이벤트만 true), `@@index([projectId, release, isRegression])` 반영. 마이그레이션 `20260623120000_release_regression_tracking`.
- **백로그(`roadmap/backlog`)**: P3 "릴리스 회귀 보기 — 완료" 절 추가. 이전 검색/필터 follow-up에서 "릴리스 회귀 보기" 미착수 표기 제거.
- **index.md**: 이슈 API·데이터 모델 항목 설명 갱신.
- **코드**: `prisma/schema.prisma`+마이그레이션, `process.ts`(firstRelease·isRegression 기록, 핫패스 보수적), `issues/{schemas,service,routes}.ts`, 대시보드 `ReleasesPage.tsx`(신규 라우트)·`App.tsx`·`IssuesPage.tsx`(링크)·`api.ts`. 테스트 +7(process 2·엔드포인트 5). typecheck·lint·전체 테스트 162개 그린.

## 2026-06-23 (P3 통계 차트 개선 — feat/stats-charts)
- **이슈 API(`api/issues-api`)**: `GET /:id/issues/:issueId/stats` 응답에 `affectedUsers` 추가 — window 내 distinct `userContext->>'id'`(= SDK `user.id`), null id 제외, 이메일 등 fallback 범위 외. 별도 `$queryRaw`(`COUNT(DISTINCT ... ) WHERE ... IS NOT NULL`)로 buckets와 동일 시간창 집계.
- **프로젝트 API(`api/projects-api`)**: `GET /:id/stats?window=24h|7d` 엔드포인트 신규. 프로젝트 전체 이벤트(모든 이슈 합산) 버킷 집계 + `totalEvents` + `affectedUsers`. 응답 `{ buckets, totalEvents, affectedUsers }`. 소유권 미보유 404(`getProject` 패턴). 마이그레이션 없음.
- **대시보드**: `IssueDetailPage`에 "영향 사용자 N명" 텍스트, `IssuesPage` 상단에 프로젝트 추세 차트(기존 SVG `StatsChart` 재사용)+24h/7d 토글+전체/영향 사용자 요약. `api.ts`에 `getProjectStats` 추가, `getStats` 반환에 `affectedUsers` 추가.
- **코드**: `modules/issues/{service,schemas}.ts`·`modules/projects/{service,schemas,routes}.ts`·`dashboard/src/{api.ts,pages/IssueDetailPage.tsx,pages/IssuesPage.tsx}`. 테스트 `tests/statsCharts.test.ts` 신규 4개. typecheck·lint clean, 전체 160 green.
- **index.md**: 프로젝트 API 항목 설명에 stats 명시.

## 2026-06-23 (P3 이슈 검색/필터 강화 — feat/retention-pruning)
- **이슈 API(`api/issues-api`)**: `GET /:id/issues` 쿼리 파라미터에 신규 필터 4종 추가 반영. `level`(Issue.level 완전일치), `release`/`environment`(Event 관계 기반 `some` 매칭 — 동시 지정 시 같은 이벤트 하나가 양쪽 충족 필요), `since`/`until`(Issue.lastSeen inclusive 범위, `since > until`이면 400). 필터 의미론 절 신규(각 필터 구현 방식 명시). 알려진 한계 2종 추가: Event.release·environment 전용 인덱스 없음(대용량 시 추가 권고), release/environment 자동완성 미구현(자유 텍스트 입력).
- **index.md**: 이슈 API 항목 설명에 신규 필터 명시.

## 2026-06-23 (P2 소스맵 정밀 매칭·메모리 바운딩·DELETE API — feat/sourcemap-precision-delete)
- **소스맵 API(`api/sourcemaps-api`)**: 세 가지 변경을 반영해 전면 갱신. (1) **경로 접미사 매칭**: 업로드 시 `canonicalArtifactName`으로 `--dir` 기준 상대 경로를 저장 키로 사용(`basename` → `assets/routes/index.js`). 심볼리케이션은 `resolveTracerName`(longest-suffix wins)으로 프레임 URL과 대조 — `routes/index.js` vs `utils/index.js` 충돌 해소, basename-only 키는 하위 호환. (2) **2단계 메모리 바운딩**: `loadSourceMapsByName`이 filename 컬럼만 먼저 SELECT하고 `referencedBasenames`와 교차한 뒤, 참조된 행의 `data` blob만 두 번째 쿼리로 로드. 미참조 맵은 메모리에 올라오지 않음. (3) **DELETE 엔드포인트 신규**: `DELETE /:id/releases/:release/sourcemaps?filename=` — filename 있으면 단일 artifact, 없으면 릴리스 전체 삭제. 삭제 row > 0이면 `Event.symbolicated` 무효화. 응답 `{ deleted: number }`. (4) **업로드 CLI**: `--dir` 기준 상대 경로를 `?filename=`으로 전송하도록 변경(`node:path relative()` + POSIX 슬래시). (5) **알려진 한계 갱신**: 한계 #1(basename 충돌) → 해결됨·잔여 주의점 재기술, 한계 #2(전량 메모리 로드) → 완화됨·잔여 주의점 재기술.
- **index.md**: 소스맵 API 항목 설명 갱신(DELETE·경로 접미사 매칭·2단계 바운딩 명시).

## 2026-06-23 (P1 리플레이 오리진 격리 — feat/replay-origin-isolation)
- **대시보드(`architecture/dashboard`)**: 스냅샷·리플레이 렌더링을 `VITE_REPLAY_ORIGIN` env로 두 모드 전환하도록 문서화. (1) rrweb 마운트/스케일 로직을 `src/replay/render.ts`(`mountSnapshot`/`mountReplay`)로 단일화 — 인페이지·격리 뷰어가 동일 코어 사용. (2) env 비어있으면 기존처럼 대시보드 오리진 인페이지 렌더, 설정 시 별도 오리진(`replay-viewer.html`, Vite 2nd 엔트리)에서 cross-origin iframe + postMessage 브리지로 격리 — 뷰어는 토큰·네트워크 없음, `event.origin`을 `?parent=` 대조 검증, 명시 targetOrigin(절대 `*` 아님). (3) postMessage 프로토콜·origin 검증을 `src/replay/messaging.ts` 순수함수로 분리해 `messaging.test.ts` 12개로 검증. (4) 뷰어에 CSP `<meta>` 심층방어. 기존 known-limitation("별도 오리진 미구현")을 구현 완료 + 배포계층 follow-up(`replay.<host>` 서빙·`frame-ancestors` 헤더)으로 갱신.
- **범위**: 앱 계층 격리만(사용자 결정). 배포 인프라(Caddy 서버블록·운영 compose·Tunnel 2nd hostname·`frame-ancestors` 헤더)는 후속 티켓. 로컬 dev는 env 미설정으로 same-origin 유지(마찰 0).
- **코드**: `packages/dashboard` — `src/replay/{render,messaging,config}.ts`·`messaging.test.ts`·`replay-viewer/main.ts`·`replay-viewer.html` 신규, `IssueDetailPage.tsx`(인페이지/iframe 분기), `vite.config.ts`(멀티페이지 입력), `vite-env.d.ts`·`.env.example` 신규. typecheck·lint·build·전체 테스트(138개) 그린.

## 2026-06-22 (P0 retention 구현 — feat/retention-pruning)
- **개념 신규(`ops/retention`)**: 데이터 보존/정리 메커니즘 문서화. env 6종(`RETENTION_ENABLED`/`_REPLAY_DAYS`/`_SNAPSHOT_DAYS`/`_EVENT_DAYS`/`_BATCH_SIZE`/`_CRON`), 삭제 순서(EventReplay 독립→EventSnapshot→Event cascade)와 근거(EventReplay는 Event와 FK 없음·`days<=0` 비활성·배치 삭제로 lock 회피), BullMQ retention 큐 + `upsertJobScheduler` 멱등 스케줄 + concurrency 1 Worker, 인덱스 마이그레이션, 알려진 한계(autovacuum 디스크 회수·대규모 EXPLAIN 미검증·스케줄 실패 로그만) 명시.
- **DB**: `EventReplay`·`EventSnapshot`에 `@@index([createdAt])` 추가(마이그레이션 `20260622063456_add_retention_indexes`). `Event`는 기존 `[projectId, receivedAt]`로 커버.
- **코드**: `config/env.ts`(RETENTION_* Zod), `lib/queue.ts`(retention 큐·`scheduleRetentionJob`·`closeRetentionQueue`), `modules/retention/prune.ts` 신규(배치 삭제), `worker.ts`(retention Worker+부트스트랩 스케줄). `app.ts` onClose는 retention 큐 미소유라 닫지 않음.
- **테스트**: `tests/retention.test.ts` 신규 7개(cutoff 경계·비활성·차등 보존·배치 경계 2종·고아 replay 독립삭제·Event cascade). typecheck·lint·전체 테스트 그린.

## 2026-06-22 (P0 retention 확정 계획 기록)
- **백로그(`roadmap/backlog`)**: P0 데이터 보존/정리 항목에 "확정 계획(2026-06-22)" 절 추가. 확정 결정(보존기간 replay14/snapshot14/event90/sourcemap0, env 전역만, 소스맵 제외, `z.stringbool()`, 일반 `CREATE INDEX`), 핵심 코드 사실(Event→Snapshot cascade / Event↔Replay FK 없음 → 고아 독립삭제 필수 / createdAt 인덱스 부재 / BullMQ 단일 큐·repeatable 없음), 7단계 구현 계획, 위험 명시. impl-planner 코드 근거 검토 결과 반영. 구현 착수.

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
