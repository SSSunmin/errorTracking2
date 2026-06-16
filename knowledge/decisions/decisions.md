---
type: Decision
title: 설계 결정 기록 (ADR-lite)
description: 코드에서 드러나는 주요 설계 선택과 (추정되는) 이유. 명시되지 않은 근거는 (추론)으로 표시.
resource: packages/server/src/modules/auth/service.ts
tags: [decisions, adr, rationale]
timestamp: 2026-06-16
---

# 설계 결정 기록 (ADR-lite)

> 코드에서 확인되는 **선택**은 사실, **이유**는 명시 근거가 없으면 `(추론)`으로 표기.

## D1. 액세스=JWT, 리프레시=불투명 토큰
- 선택: 액세스는 JWT(HS256, 15분), 리프레시는 랜덤 32바이트(7일)이며 DB엔 `sha256` 해시만 저장.
- 이유(추론): 리프레시는 서버에서 폐기·회전 추적이 필요하므로 stateless JWT 대신 DB 추적형 불투명 토큰이 적합. 해시 저장으로 DB 유출 시 원문 노출 방지.

## D2. 리프레시 토큰 회전 + 재사용 탐지
- 선택: refresh 사용 시 새 토큰 발급 + 기존 토큰 `revokedAt`/`replacedByTokenHash` 기록. 이미 폐기된 토큰 재사용 시 해당 유저의 **모든 활성 리프레시 토큰 폐기**.
- 이유(추론): 토큰 탈취 대응. 탈취본이 한 번 쓰이면 정상 사용자와 충돌해 전체 무효화로 차단.

## D3. 비밀번호 argon2id
- 선택: argon2id(memoryCost 65536, timeCost 3). 평문/단순해시 미저장.
- 이유(추론): 현대적 메모리-하드 해시 권장안.

## D4. 이슈 그룹핑 = fingerprint
- 선택: `Issue`에 `@@unique([projectId, fingerprint])`. Event는 Issue에 묶임.
- 이유(추론): 동일 에러를 하나의 이슈로 집계(Sentry류 표준 모델).

## D5. Event에 projectId 비정규화
- 선택: Event는 `issueId`와 별개로 `projectId`를 직접 보유, `@@index([projectId, receivedAt])`.
- 이유(추론): 프로젝트 단위 대량 이벤트 조회 성능.

## D6. Zod + fastify-type-provider-zod
- 선택: 요청/응답 스키마를 Zod로 정의하고 검증·직렬화.
- 이유(추론): 런타임 검증 + 타입 일원화.

## D7. 큐 분리 인제스트 (BullMQ/Redis)
- 선택: Ingest API는 검증 후 큐에 적재만 하고 202 응답. 그룹핑/저장/알림은 워커가 비동기 처리.
- 이유: 트래픽 스파이크 흡수, 인제스트 응답 지연 최소화, 워커 수평 확장. [인제스트 파이프라인](/architecture/ingestion-pipeline.md).

## D8. 알림 디듀프 = advisory lock + pending claim
- 선택: 발송 전 `pg_advisory_xact_lock((rule,issue))` 아래 `Notification` `pending` 행을 선점하고, 발송 후 `sent`/`failed`로 갱신.
- 이유: 동시 워커가 같은 (규칙,이슈)에 중복 발송하는 경쟁을 직렬화로 차단. dedup 윈도는 조건별(new_issue=영구, regression=쿨다운, event_threshold=윈도).

## D9. Slack webhook SSRF 가드
- 선택: Slack `target`은 `https://hooks.slack.com/` 접두만 허용(쓰기+발송 시점 이중 검증), `fetch` `redirect:"error"` + 10s 타임아웃.
- 이유: 사용자 제어 URL로의 SSRF(내부망/메타데이터)와 슬롯 고갈 방지.

## D10. 리프레시 쿠키 SameSite=Strict
- 선택: 리프레시 토큰은 httpOnly·`SameSite=Strict`·`path=/api/auth` 쿠키. 액세스 토큰은 본문 반환(메모리 보관).
- 이유: SPA는 동일 오리진(대시보드는 dev에서 `/api` 프록시)이라 Strict로 CSRF 표면 최소화.

## D11. 액세스 토큰 jti
- 선택: 액세스 JWT에 매번 랜덤 `jti` 부여.
- 이유: 같은 초에 재발급해도 토큰이 고유. 감사·향후 폐기 추적 여지.

## D12. 대시보드 bundler 모듈 해석
- 선택: 서버/SDK는 NodeNext(.js 확장자), 대시보드는 `moduleResolution: Bundler`(확장자 생략).
- 이유: Vite React 앱 관용에 맞고 `.js` 확장자 강제 회피.

## D13. nodemailer v9 업그레이드
- 선택: 이메일 발송을 nodemailer 9로 고정.
- 이유: 7.x/8.x의 CRLF/SMTP 인젝션 등 권고를 해소(런타임 audit 0).

## 관련 개념
- [인증 플로우](/architecture/auth-flow.md) · [데이터 모델](/database/data-model.md) · [에러 응답 규약](/reference/error-model.md) · [인제스트 파이프라인](/architecture/ingestion-pipeline.md) · [알림 규칙 API](/api/alerts-api.md)
