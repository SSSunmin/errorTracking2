---
type: Architecture
title: React 대시보드
description: packages/dashboard. React + Vite + TanStack Query + React Router SPA. 인메모리 액세스 토큰 + 리프레시 쿠키, 코얼레스드 refresh, 페이지별 구성. IssueDetailPage에서 DOM 스냅샷(feature B)을 sandboxed iframe으로, 세션 리플레이(feature C)를 rrweb Replayer로 렌더링. 신뢰 못 할 녹화는 VITE_REPLAY_ORIGIN으로 별도 오리진 iframe+postMessage 격리(P1). 심볼리케이션된 프레임의 원본 위치 우선 표시.
resource: packages/dashboard/src/App.tsx
tags: [dashboard, react, vite, tanstack-query, spa, auth, snapshot, replay, rrweb, symbolication, origin-isolation, csp, postmessage]
timestamp: 2026-06-23
---

# React 대시보드 (`packages/dashboard`)

## 기술 스택

- **빌드/개발**: Vite + `@vitejs/plugin-react`
- **라우팅**: React Router (`react-router-dom`)
- **서버 상태**: TanStack Query (useQuery / useMutation / useQueryClient)
- **언어**: TypeScript

## Dev 프록시

`vite.config.ts`에서 `/api` 경로를 백엔드로 프록시:
```
/api → http://localhost:4100 (기본, VITE_API_TARGET 환경변수로 재정의)
```
이를 통해 개발 시 대시보드와 API가 같은 오리진을 공유 → CORS 불필요, 리프레시 쿠키 정상 동작.

## 라우트 구조 (`App.tsx`)

| 경로 | 컴포넌트 | 설명 |
|---|---|---|
| `/` | ProjectsPage | 프로젝트 목록 + DSN 표시 |
| `/projects/:projectId` | IssuesPage | 이슈 목록 (필터/정렬/검색) |
| `/projects/:projectId/issues/:issueId` | IssueDetailPage | 이슈 상세 + 이벤트 빈도 차트 |
| `/projects/:projectId/alerts` | AlertsPage | 알림 규칙 목록 + 생성 폼 |
| 미인증 시 전체 | LoginPage | 로그인/회원가입 |

## 인증 흐름 (`auth.tsx`, `api.ts`)

### 토큰 저장
- **액세스 토큰**: 인메모리 변수 (`let accessToken: string | null`). XSS로 localStorage 탈취 방지.
- **리프레시 토큰**: HttpOnly 쿠키 (서버가 Set-Cookie로 설정, 브라우저가 자동 전송).

### 세션 복원 (`restoreSession`)
앱 초기화 시 `POST /api/auth/refresh`를 호출해 쿠키로 액세스 토큰을 갱신한 후 `/api/auth/me`로 사용자 정보 조회.

### 코얼레스드 리프레시 (Coalesced Refresh)
401 응답 발생 시 동시 다수 요청이 모두 refresh를 시도하는 문제 방지:
```typescript
let refreshPromise: Promise<boolean> | null = null;
const refresh = () => {
  refreshPromise ??= doRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
};
```
N개의 병렬 401이 단 1회의 토큰 회전만 발생시킨다.

### 자동 재시도
- `request()` 함수: 401 수신 시 refresh 후 1회 재시도 (`retry: false`로 무한루프 방지)
- `/api/auth/` 경로는 재시도 안 함

## 페이지 주요 기능

### ProjectsPage
- 프로젝트 목록 조회 + 생성
- 프로젝트 키(DSN) 표시 (`/api/projects/:id/keys`에서 활성 키 우선 조회)
- 생성 직후 DSN + SDK 스니펫 표시

### IssuesPage
- 상태(unresolved/resolved/ignored) 필터, 정렬(lastSeen/firstSeen/timesSeen), 제목 검색
- TanStack Query: `queryKey: ["issues", projectId, status, query, sort]`

### IssueDetailPage
- 이슈 메타 + 상태 변경 버튼 (Resolve / Ignore / Unresolve)
- 이벤트 빈도 차트 (24h | 7d 토글, `StatsChart` 컴포넌트)
- 이벤트 선택기 — 이벤트 목록을 드롭다운/이전·다음 버튼으로 탐색하고 선택한 이벤트의 상세(스택트레이스, breadcrumbs, tags, userContext, 환경)를 렌더링
- `useMutation` + `queryClient.invalidateQueries`로 낙관적 갱신
- **rrweb 렌더 코어 공유 (`src/replay/render.ts`, P1)**: 스냅샷·리플레이의 rrweb 마운트/스케일 로직은 `render.ts`의 `mountSnapshot` / `mountReplay`로 단일화돼 있다(프레임워크·DOM 비의존). 인페이지 렌더와 격리 뷰어가 같은 코어를 써서 재생·스케일 동작(특히 커서 정렬을 좌우하는 뷰포트 스케일링, 커밋 ca13901·18e2c67)이 두 경로에서 동일하다.
- **DOM 스냅샷 렌더링** (`SnapshotSection` / `SnapshotFrame`, feature B):
  - 선택한 이벤트의 `hasSnapshot === true`일 때 `SnapshotSection`이 렌더링된다.
  - `api.getEventSnapshot(projectId, issueId, eventId)` 호출 (`TanStack Query`, `staleTime: Infinity` — ~1MB 블롭 재요청 방지).
  - `mountSnapshot`이 `rebuildIntoSandboxedIframe(data, { root, cache, mirror })`를 호출해 rrweb-snapshot이 생성한 sandboxed iframe(`sandbox="allow-same-origin"`, 스크립트 실행 없음)에 DOM을 재현한다.
  - 재현 실패 시 "스냅샷을 표시할 수 없습니다." 안내 메시지로 graceful degrade.
  - 의존성: `rrweb-snapshot` (dashboard `package.json`).
- **세션 리플레이 렌더링** (`ReplaySection` / `ReplayPlayer`, feature C):
  - 선택한 이벤트의 `hasReplay === true`일 때 `ReplaySection`이 렌더링된다.
  - `api.getEventReplay(projectId, issueId, eventId)` 호출 (`TanStack Query`, `staleTime: Infinity`). 404는 `null`로 처리해 에러로 throw하지 않는다.
  - `mountReplay`가 rrweb `Replayer`를 사용해 DOM을 재생한다(`rrweb/dist/style.css` 임포트). rrweb-player(별도 패키지)가 아닌 rrweb 내장 `Replayer` 직접 사용.
  - **뷰포트 크기 결정 (fix/replay-viewport-meta)**: SDK trim 수정으로 업로드 스트림이 이제 `[Meta(4), FullSnapshot(2), ...]`으로 시작한다. `mountReplay`는 스트림에서 첫 번째 Meta 이벤트를 찾아(`events.find(e => e.type === EventType.Meta)`) `data.width` / `data.height`를 실제 녹화 뷰포트로 사용한다. Meta가 없거나(`meta === undefined`) 값이 0 이하이면 `1280×720` placeholder로 fallback한다(이전 녹화 backward-compat). placeholder는 Meta 없이 FullSnapshot으로 시작하는 스트림에만 합성 삽입한다.
  - `Replayer` 옵션: `{ root: container, mouseTail: false, speed: 1, skipInactive: true }`. 생성 직후 첫 프레임만 paused로 그리고 사용자가 재생을 누른다(자동재생 안 함). `.replayer-wrapper`를 rrweb `Resize` 이벤트의 현재 뷰포트 기준으로 카드 너비에 맞게 scale down(`ResizeObserver`로 재조정).
  - 재생 컨트롤은 `mountReplay`가 반환하는 컨트롤러(`play`/`pause`/`resume`/`destroy`)로 구동되고, 상태(idle/playing/paused/finished/failed)는 콜백으로 UI에 전달된다.
  - 초기화 실패 시 "리플레이를 재생할 수 없습니다." 안내로 graceful degrade.
  - 의존성: `rrweb` (dashboard `package.json`, `rrweb/dist/style.css`포함).
- **오리진 격리 (stored-XSS 하드닝, P1)** — `VITE_REPLAY_ORIGIN`으로 두 모드 전환:
  - **비어 있음(기본, 로컬 dev)**: 스냅샷·리플레이를 대시보드 오리진에서 인페이지 렌더(위 `mountSnapshot`/`mountReplay`). rrweb의 `allow-same-origin`-only sandbox(no `allow-scripts`)가 캡처 `<script>` 실행을 차단 — 액티브 XSS는 막히지만 같은 오리진이라 회귀(`UNSAFE_replayCanvas`/`allow-scripts` 추가) 시 위험.
  - **설정 시(staging/prod, 예 `https://replay.example.com`)**: `SnapshotFrame`/`ReplayPlayer`가 그 오리진에서 서빙되는 `replay-viewer.html`(별도 Vite 엔트리, `src/replay-viewer/main.ts`)을 cross-origin iframe으로 임베드한다. 데이터 흐름:
    1. 부모(대시보드)가 Bearer 토큰으로 replay/snapshot을 fetch.
    2. 뷰어가 로드되면 `{kind:"ready"}`를 부모에 postMessage.
    3. 부모가 데이터를 **명시 targetOrigin**으로 뷰어에 postMessage(절대 `"*"` 미사용). 뷰어는 `event.origin`을 `?parent=` 쿼리의 대시보드 오리진과 대조해 검증(`isAllowedOrigin`, 빈 값이면 fail-closed). 뷰어는 자기 오리진에 **API 토큰이 없고 네트워크도 안 쓴다** → 신뢰 못 할 녹화가 토큰·DOM·`/api`에 도달 불가.
    4. 뷰어가 렌더 높이를 `{kind:"resize"}`로 보고 → 부모가 iframe 높이 조정.
  - postMessage 프로토콜·origin 검증은 `src/replay/messaging.ts`의 순수 함수(`isAllowedOrigin`/`parseViewerInbound`/`parseViewerOutbound`)로 분리돼 단위 테스트(`messaging.test.ts`)로 검증된다.
  - 뷰어 `replay-viewer.html`에 CSP `<meta>`(`default-src 'none'; script-src 'self'; connect-src 'none'` 등)로 심층방어.
  - **남은 follow-up(배포 계층, 이번 범위 제외)**: `replay.<host>` 서브도메인 서빙(Caddy 서버블록 / Cloudflare Tunnel 2nd hostname)과 뷰어 응답에 `Content-Security-Policy: frame-ancestors <dashboard-origin>` 헤더(임베드 가능 오리진 고정·클릭재킹 차단) — `frame-ancestors`는 `<meta>`로 설정 불가하므로 서빙 계층에서 헤더로 줘야 한다.
- **스택트레이스 심볼리케이션 렌더링** (`IssueDetailPage`, `frames` 섹션):
  - 서버가 `EventDetail.stacktrace.frames[]`에 `originalFilename` 등 원본 위치 필드를 채워 보내면, 대시보드는 이를 우선 표시한다.
  - **함수명**: `frame.originalFunction`이 있으면 우선 사용, 없으면 `frame.function` fallback, 없으면 `<anonymous>`.
  - **파일:줄**: `originalFilename`이 있으면 원본 위치(`originalFilename:originalLineno`) 표시.
  - **contextLine**: `frame.contextLine`이 있으면 원본 코드 한 줄을 `<code>` 블록으로 표시.
  - **미니파이 보조 표시**: 심볼리케이션된 프레임에는 미니파이 위치를 `↳ minified.js:N` 형식으로 보조(`.frame-minified`) 표기.
  - **판별 기준**: `frame.originalFilename !== undefined`이면 심볼리케이션된 프레임으로 판단.
  - 원본 위치 필드가 없는 프레임(소스맵 미매칭·미업로드)은 기존 미니파이 위치 그대로 렌더링.

### AlertsPage
- 알림 규칙 목록 + 인라인 생성 폼
- `event_threshold` 조건 선택 시 `threshold`/`windowMinutes` 입력 필드 표시
- 삭제(DELETE) mutate

## API 클라이언트 (`api.ts`)

단일 `request<T>()` 함수로 모든 엔드포인트 호출. 주요 엔드포인트:

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/register` | 회원가입 |
| POST | `/api/auth/refresh` | 토큰 갱신 |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/auth/me` | 현재 사용자 |
| GET/POST | `/api/projects` | 프로젝트 목록/생성 |
| GET | `/api/projects/:id/keys` | 프로젝트 키 목록 |
| GET | `/api/projects/:id/issues` | 이슈 목록 (status/query/sort 쿼리) |
| GET | `/api/projects/:id/issues/:iid` | 이슈 상세 |
| GET | `/api/projects/:id/issues/:iid/events` | 이벤트 목록 |
| GET | `/api/projects/:id/issues/:iid/events/:eid/snapshot` | 이벤트 DOM 스냅샷 (feature B) |
| GET | `/api/projects/:id/issues/:iid/events/:eid/replay` | 세션 리플레이 (feature C) — 404→null |
| GET | `/api/projects/:id/issues/:iid/stats` | 이벤트 통계 버킷 |
| PATCH | `/api/projects/:id/issues/:iid` | 이슈 상태 변경 |
| GET/POST | `/api/projects/:id/alert-rules` | 알림 규칙 목록/생성 |
| DELETE | `/api/projects/:id/alert-rules/:ruleId` | 알림 규칙 삭제 |

## 관련 개념
- [인증 플로우](/architecture/auth-flow.md)
- [이슈 API](/api/issues-api.md)
- [세션 리플레이 API](/api/replay-api.md)
- [알림 API](/api/alerts-api.md)
- [시스템 아키텍처](/architecture/system.md)
