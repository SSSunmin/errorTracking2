---
type: Architecture
title: React 대시보드
description: packages/dashboard. React + Vite + TanStack Query + React Router SPA. 인메모리 액세스 토큰 + 리프레시 쿠키, 코얼레스드 refresh, 페이지별 구성. IssueDetailPage에서 DOM 스냅샷(feature B)을 sandboxed iframe으로, 세션 리플레이(feature C)를 rrweb Replayer로 렌더링.
resource: packages/dashboard/src/App.tsx
tags: [dashboard, react, vite, tanstack-query, spa, auth, snapshot, replay, rrweb]
timestamp: 2026-06-22
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
- **DOM 스냅샷 렌더링** (`SnapshotSection` / `SnapshotFrame`, feature B):
  - 선택한 이벤트의 `hasSnapshot === true`일 때 `SnapshotSection`이 렌더링된다.
  - `api.getEventSnapshot(projectId, issueId, eventId)` 호출 (`TanStack Query`, `staleTime: Infinity` — ~1MB 블롭 재요청 방지).
  - `SnapshotFrame`이 `rebuildIntoSandboxedIframe(data, { root, cache, mirror })`를 호출해 rrweb-snapshot이 생성한 sandboxed iframe(`sandbox="allow-same-origin"`, 스크립트 실행 없음)에 DOM을 재현한다.
  - 재현 실패 시 "스냅샷을 표시할 수 없습니다." 안내 메시지로 graceful degrade.
  - 의존성: `rrweb-snapshot` (dashboard `package.json`).
- **세션 리플레이 렌더링** (`ReplaySection` / `ReplayPlayer`, feature C):
  - 선택한 이벤트의 `hasReplay === true`일 때 `ReplaySection`이 렌더링된다.
  - `api.getEventReplay(projectId, issueId, eventId)` 호출 (`TanStack Query`, `staleTime: Infinity`). 404는 `null`로 처리해 에러로 throw하지 않는다.
  - `ReplayPlayer`가 rrweb `Replayer`를 사용해 DOM을 재생한다(`rrweb/dist/style.css` 임포트). rrweb-player(별도 패키지)가 아닌 rrweb 내장 `Replayer` 직접 사용.
  - **뷰포트 크기 결정 (fix/replay-viewport-meta)**: SDK trim 수정으로 업로드 스트림이 이제 `[Meta(4), FullSnapshot(2), ...]`으로 시작한다. `ReplayPlayer`는 스트림에서 첫 번째 Meta 이벤트를 찾아(`events.find(e => e.type === EventType.Meta)`) `data.width` / `data.height`를 실제 녹화 뷰포트로 사용한다. Meta가 없거나(`meta === undefined`) 값이 0 이하이면 `1280×720` placeholder로 fallback한다(이전 녹화 backward-compat). placeholder는 Meta 없이 FullSnapshot으로 시작하는 스트림에만 합성 삽입한다.
  - `Replayer` 옵션: `{ root: container, mouseTail: false, speed: 1 }`. 생성 직후 `.play()` 호출. `.replayer-wrapper`를 실제(또는 fallback) 뷰포트 기준으로 카드 너비에 맞게 scale down(`ResizeObserver`로 재조정).
  - "↻ 처음부터 재생" 버튼: `replayerRef.current?.play(0)`.
  - 초기화 실패 시 "리플레이를 재생할 수 없습니다." 안내로 graceful degrade.
  - sandbox: `allow-same-origin`만 허용 — 캡처된 `<script>`가 실행되지 않는다. `UNSAFE_replayCanvas` 미사용.
  - 의존성: `rrweb` (dashboard `package.json`, `rrweb/dist/style.css`포함).
  - **known limitation**: 실제 서비스에서 신뢰할 수 없는 녹화는 별도 오리진에서 서빙해야 stored XSS 위험을 차단할 수 있다(현재 미구현).

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
