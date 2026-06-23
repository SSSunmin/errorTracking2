---
type: Playbook
title: 운영 배포 (Docker Compose + Caddy)
description: 운영 스택 구성(postgres/redis/server/worker/Caddy), 리플레이 오리진 격리·frame-ancestors 보안 근거, 기동·마이그레이션·TLS 절차.
resource: docker-compose.prod.yml
tags: [ops, deploy, docker, caddy, security, replay, csp]
timestamp: 2026-06-23
---

# 운영 배포

P1 "리플레이 보안 하드닝 — 배포 계층" 산출물. 신뢰 못 할 리플레이 녹화를 운영에 노출하기 전 필수인 (1) `frame-ancestors` CSP 헤더, (2) `replay.<host>` 별도 오리진 서빙, (3) 운영 docker-compose를 코드화한다.

근거: [백로그 P1](/roadmap/backlog.md), [대시보드](/architecture/dashboard.md)(오리진 격리), [환경설정](/config/environment.md).

## 스택 구성

| 서비스 | 이미지/빌드 | 호스트 포트 | 역할 |
|---|---|---|---|
| `postgres` | postgres:16-alpine | (없음, 내부만) | 데이터 저장. named volume `postgres_data`, healthcheck |
| `redis` | redis:7-alpine | (없음, 내부만) | BullMQ 큐. named volume `redis_data`, healthcheck |
| `migrate` | `packages/server/Dockerfile` (mini-sentry-server) | — | **1회성**. `prisma migrate deploy` 후 종료 |
| `server` | 동일 이미지 | (없음, 내부만) | Fastify API (`node dist/index.js`). Caddy가 `/api`로 프록시 |
| `worker` | 동일 이미지(command 오버라이드) | (없음, 내부만) | BullMQ 워커 (`node dist/worker.js`) |
| `caddy` | `deploy/Dockerfile.dashboard` | **80 / 443** | 대시보드 정적 SPA + `/api` 리버스 프록시 + 리플레이 뷰어 격리 서빙 + 자동 TLS |

- 외부 노출은 **Caddy(80/443)만**. DB·Redis·server·worker는 compose 내부 네트워크에만 있다(호스트 포트 미노출 = 공격면 최소화).
- 이미지 1개(`mini-sentry-server`)를 server/worker/migrate가 **공유**한다(빌드 1회, command만 다름).

## 두 오리진

같은 dist 번들(`packages/dashboard/dist` → Caddy `/srv`)을 두 도메인에 서빙한다:

- `{$DASHBOARD_DOMAIN}` — 대시보드 SPA. `/api/*`는 `server:{$API_PORT}`로 리버스 프록시(같은 오리진 → CORS 없음, refresh 쿠키 동작), 그 외는 `try_files … /index.html`(SPA fallback). 토큰·쿠키를 쥔 본체이므로 자신은 어디에도 임베드 불가(`frame-ancestors 'none'` + 레거시용 `X-Frame-Options: DENY`), `X-Content-Type-Options: nosniff`/`Referrer-Policy`도 부여.
- `{$REPLAY_DOMAIN}` — 리플레이 뷰어. **명시적 allowlist**(`@viewer path /replay-viewer.html /assets/*`)만 `file_server`로 서빙하고 그 외 전부 `404`(`index.html`·SPA fallback·`/api` 프록시 없음 = 격리). 응답에 `Content-Security-Policy: frame-ancestors https://{$DASHBOARD_DOMAIN}`.

## 보안 근거

- **별도 오리진(`replay.<host>`)**: 신뢰 못 할 녹화는 대시보드와 다른 오리진의 cross-origin iframe(`VITE_REPLAY_ORIGIN`)에서 재생된다. 뷰어는 토큰·네트워크가 없고 `/api`에 도달 불가 → 녹화가 대시보드 토큰·DOM·API에 닿지 못한다(앱 계층 격리는 PR #8에서 완료).
- **`frame-ancestors` 헤더**: 앱 계층 격리만으론 **임의 사이트가 뷰어를 iframe으로 임베드**(클릭재킹 빌미)하는 것을 못 막는다. `frame-ancestors`로 대시보드 오리진만 부모로 허용한다. `<meta>`로는 설정 불가 → **서빙 계층(Caddy) 응답 헤더로만** 가능. 이 헤더 없이 운영 노출 금지.

## 기동 절차

```sh
cp .env.prod.example .env.prod    # 도메인·시크릿 채우기 (.env.prod는 커밋 금지)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

> `--env-file .env.prod`는 **필수**다. compose의 `${VAR}` 보간(caddy 빌드 ARG·caddy/server/worker env)을 이 파일로 채운다. 서비스의 `env_file:`은 컨테이너 런타임 주입만 하고 `${...}` 치환은 못 한다.

- 부팅 순서: postgres/redis healthy → `migrate`(1회성) 완료 → server/worker 시작. server/worker는 `depends_on: { migrate: { condition: service_completed_successfully } }`로 마이그레이션 완료를 기다린다.
- **마이그레이션 전략**: 매 서버 기동마다 돌리지 않고 1회성 `migrate` 서비스에서만 `prisma migrate deploy`. 여러 인스턴스가 동시에 마이그레이션하는 레이스를 피한다(prisma CLI는 runtime 이미지에 포함됨).

## TLS

- **운영(VPS)**: 80/443 공개 + 공개 DNS면 Caddy가 자동으로 인증서를 발급/갱신한다(`caddy_data`/`caddy_config` named volume이 인증서 상태 보존).
- **테스트(Cloudflare Tunnel, 무료)**: 공개 80/443 없이 Cloudflare가 TLS를 종단한다. Caddyfile의 두 사이트 주소에 `http://` 접두사를 붙여 평문 HTTP로 서빙하고, 터널의 2개 public hostname을 caddy 컨테이너 `:80`으로 보낸다(주석 참고).

## env

`.env.prod`(예시: `.env.prod.example`)가 server/worker/migrate에 주입된다. server 필수(prod): `NODE_ENV=production`, `DATABASE_URL`(→`postgres` 서비스), `REDIS_URL`(→`redis`), `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`(≥32자), `CORS_ORIGIN`(=`https://{DASHBOARD_DOMAIN}`, 없으면 부팅 실패), `API_PORT`, `DSN_HOST`, `DSN_SCHEME=https`. `VITE_REPLAY_ORIGIN`은 **빌드타임 ARG**(caddy 빌드 시 Vite가 번들에 인라인 — 런타임 변경 무효). 자세한 변수는 [환경설정](/config/environment.md).

## 알려진 한계 / 주의

- **SDK 정적 서빙 제외**: server의 `/sdk/` 라우트는 `existsSync` 가드라 이미지에 SDK dist를 안 넣으면 no-op. 스크립트 태그 드롭인이 필요하면 server Dockerfile에 SDK 빌드를 추가한다.
- 이미지 크기: runtime 스테이지가 build의 `node_modules`를 통째로 복사(생성된 Prisma client + prisma CLI 트랜지티브 deps 보존 목적). 슬림화는 후속(server Dockerfile `ponytail:` 주석 참고).
- dev compose(`docker-compose.yml`, PG+Redis만·호스트 포트 노출)와 별개 파일이라 포트 충돌 없음.

## 관련 개념
- [운영 런북](/ops/runbook.md) · [환경설정](/config/environment.md) · [대시보드](/architecture/dashboard.md) · [백로그](/roadmap/backlog.md)
