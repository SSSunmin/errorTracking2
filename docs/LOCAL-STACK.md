# 로컬 스택 / 백그라운드 프로세스

> Mini-Sentry를 로컬에서 테스트할 때 띄우는 백그라운드 프로세스 전부를 한 곳에 정리.
> 계정·DSN은 중복을 피하려고 [ACCOUNT.md](../ACCOUNT.md)를 참조한다.
> 마지막 확인: 2026-06-22

## TL;DR

- **전부 띄우기**: `scripts/dev-up.ps1` 실행 (또는 Claude에게 "백그라운드 프로세스 띄워줘")
- **전부 정리**: `scripts/dev-down.ps1` 실행 (또는 Claude에게 "백그라운드 프로세스 정리해줘")

## 구성하는 프로세스

| # | 프로세스 | 포트 | 기동 명령 | 비고 |
|---|---|---|---|---|
| 0 | Docker Desktop | — | (자동) | 데몬이 꺼져 있으면 dev-up이 먼저 띄우고 대기 |
| 1 | Postgres | 5433 | `docker compose start postgres` | 데이터는 named volume에 보존 |
| 2 | Redis | 6380 | `docker compose start redis` | BullMQ 큐 |
| 3 | API 서버 | 4100 | `npm run dev -w @mini-sentry/server` | `/health` → `{"status":"ok"}` |
| 4 | 워커 | — | `npm run worker:dev -w @mini-sentry/server` | 이벤트 그룹핑·알림 소비 |
| 5 | 대시보드 (React SPA) | 5176 | `npm run dev -w @mini-sentry/dashboard -- --port 5176 --strictPort` | `/api`를 4100으로 vite proxy (CORS·쿠키 우회) |
| 6 | HTML 데모 (SDK) | 5179 | `npm run dev -w @mini-sentry/demo-app -- --port 5179 --strictPort` | DSN 붙여넣고 이벤트 테스트 |
| 7 | React 샘플 (쇼핑몰) | 5174 | `npm --prefix .tools/react-sample run dev -- --port 5174 --strictPort` | `sessionReplay:true`. "무너진 진열 상품"으로 에러 유발 |

> 포트 5173은 무관한 프로젝트(vAdvisorRenewal)가 점유하므로 위처럼 다른 포트를 고정(`--strictPort`)한다.
> `.tools/`는 gitignore된 스크래치 — react-sample은 워크스페이스가 아니라 자체 node_modules로 돈다.

## 기동 순서 (의존성)

1. **Docker 데몬** 확인 → 꺼져 있으면 Docker Desktop 실행 후 `docker info` 성공할 때까지 대기.
2. **인프라**: `docker compose start postgres redis` → `pg_isready` + `redis-cli ping`(PONG) 확인.
   - 컨테이너가 삭제됐으면 `start` 대신 `npm run infra:up`.
3. **DB 마이그레이션**: `prisma migrate deploy`로 dev DB에 미적용 마이그레이션을 적용. 장수 dev DB는 새 마이그레이션이 머지돼도 자동 반영 안 되므로(테스트는 자체 DB라 못 잡음 → 런타임에 "컬럼 없음" 500), 서버 기동 전에 맞춘다. 실패 시 즉시 중단.
4. **API 서버** 기동 → `curl http://localhost:4100/health`가 `{"status":"ok"}` 줄 때까지 대기(앞 단계가 안 떠 있으면 Prisma 연결 실패).
5. **워커 / 대시보드 / HTML 데모 / React 샘플**은 서로 독립이라 병렬 기동 가능.

## 정리(teardown)

- 각 dev 서버는 `npm`/`tsx watch`/`vite`가 **자식 node 프로세스를 남기므로** 래퍼만 죽이면 포트가 안 풀린다.
  `dev-down.ps1`은 커맨드라인에 `claude-codex-test2`가 포함된 node 프로세스를 종료하되 **`vAdvisorRenewal` 등 무관한 프로세스는 제외**한다.
- 인프라는 `docker compose stop postgres redis`로 **중지(데이터 보존)**. 완전 제거가 필요하면 `npm run infra:down`.

## 접속·계정

- 대시보드: http://localhost:5176 — 로그인 계정/자동로그인은 [ACCOUNT.md](../ACCOUNT.md) 참조.
- React 샘플 이슈 상세 예시 경로: `http://localhost:5176/projects/<projectId>/issues/<issueId>`
- HTML 데모(5179) DSN 입력란 값: [ACCOUNT.md](../ACCOUNT.md)의 "프로젝트 DSN".

## 관련 문서

- [운영 런북](../knowledge/ops/runbook.md) · [ACCOUNT.md](../ACCOUNT.md)
