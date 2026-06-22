# 로컬 실행 / 계정 정보 (Mini-Sentry)

> 로컬 개발용. 운영 비밀번호 아님. 마지막 확인: 2026-06-18

## 실행 중인 서비스

| 서비스 | URL | 비고 |
|---|---|---|
| API 서버 | http://localhost:4100 | `/health` → `{"status":"ok"}` (기존 인스턴스 가동 중) |
| 워커(이벤트 수집) | — | BullMQ, Redis 큐 소비 |
| 대시보드 (React) | http://localhost:5176 | 5173은 vAdvisorRenewal이 점유 → 5176 고정(strictPort) |
| 쇼핑몰 앱 (react-sample) | http://localhost:5174 | 새 SDK(captureReplay) 반영해 재기동. "무너진 진열 상품"으로 에러 유발 |
| 데모 앱 (HTML/SDK) | http://localhost:5179 | DSN 붙여넣고 이벤트 테스트 |
| Postgres | localhost:5433 | docker `claude-codex-test2-postgres-1` |
| Redis | localhost:6380 | docker `claude-codex-test2-redis-1` |

> 대시보드/데모 앱 포트는 vite가 빈 포트를 자동으로 잡는다. 위 포트가 안 맞으면 각 vite 기동 로그의 `Local:` 줄을 확인.

## 로그인 계정 (대시보드)

### 1) React 샘플 계정 — 대시보드가 자동 로그인되는 계정

대시보드는 로드 시 `/api/auth/refresh`로 브라우저의 refresh 토큰 쿠키를 복원하므로,
이 계정으로 **비번 없이 자동 로그인**된다(토큰 만료 2026-06-25). **React 샘플 프로젝트의 owner**.
비밀번호는 원래 미상(테스트 중 API 생성)이었으나 2026-06-18에 `demo1234`로 재설정함. **로그인 검증 완료**.

| 항목 | 값 |
|---|---|
| Email | `demo+1781615257@example.com` |
| Password | `demo1234` (2026-06-18 재설정) |
| userId | `cmqg4fo7l0022q9zo6ntb8y00` |
| 소유 프로젝트 | `react`(React 샘플), `project-2`(성플 데모) |

### 2) 시드 데모 계정

시드(`packages/server/prisma/seed.ts`)로 생성. **로그인 실제 성공 확인됨**(2026-06-18).

| 항목 | 값 |
|---|---|
| Email | `demo@mini-sentry.local` |
| Password | `demo1234` |
| 이름 | Demo User |

## 프로젝트 DSN

데모 앱(HTML) 입력란에 붙여넣어 SDK 이벤트를 전송한다. 형식: `http://<publicKey>@localhost:4100/<projectId>`

**React 샘플** (projectId `cmqhbmcvv000lq9r8ikbunvay`, owner = 위 1번 계정)
```
# react-sample 키
http://37156db10703e716d5fc369efc88a785@localhost:4100/cmqhbmcvv000lq9r8ikbunvay
# Default DSN 키
http://44f6916eef5b8a6fae84a110bea2ed64@localhost:4100/cmqhbmcvv000lq9r8ikbunvay
```

**Demo Project** (slug `demo`, projectId `cmqexg7d60002q9lg8g0gqtya`, owner = 위 2번 계정)
```
http://2768b1cdbdd39822cd1ddeb7865c3e23@localhost:4100/cmqexg7d60002q9lg8g0gqtya
```

## 참고: 기타 테스트 계정

DB에는 테스트 중 API로 만들어진 계정이 다수 더 있다(`curltest_*`, `e2e_*`, `sdk_*` 등).
이들의 비밀번호는 시드에 없어 **알 수 없음**(테스트 스크립트가 임의 생성). 로그인은 위 1·2번 계정을 사용할 것.

## 재기동 메모

- 인프라: `docker compose start` (또는 `npm run infra:up`)
- API: `npm run dev -w @mini-sentry/server` (포트 4100)
- 워커: `npm run worker:dev -w @mini-sentry/server`
- 대시보드: `npm run dev -w @mini-sentry/dashboard`
- 데모 앱: `examples/demo-app`에서 `npx vite --port <빈포트>`
