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

## 관련 개념
- [인증 플로우](/architecture/auth-flow.md) · [데이터 모델](/database/data-model.md) · [에러 응답 규약](/reference/error-model.md)
