---
type: API Reference
title: 알림 규칙 API
description: 프로젝트별 AlertRule CRUD. JWT 인증 + 소유권 스코프. 채널별 target 검증, 프로젝트당 50개 상한.
resource: packages/server/src/modules/alert-rules/routes.ts
tags: [api, alerts, alert-rules, notifications]
timestamp: 2026-06-16
---

# 알림 규칙 API

프로젝트에 연결된 알림 규칙(AlertRule)을 생성·조회·수정·삭제한다. **모든 라우트에 JWT 인증(`requireAuth`) 필수**. 서비스 레이어에서 프로젝트 소유권 확인.

## 엔드포인트 (prefix: `/api/projects`)

### GET `/:id/alert-rules`
프로젝트의 알림 규칙 전체 목록. `createdAt` 오름차순.

**응답 200:** `{ alertRules: AlertRule[] }`

### POST `/:id/alert-rules`
알림 규칙 생성.

**바디:** `CreateAlertRuleInput` (아래 참고)

**응답 201:** `{ alertRule: AlertRule }`

**제약:**
- 프로젝트당 최대 **50개** (초과 시 `400 Bad Request`)
- `channel=email` → `target`이 유효한 이메일 주소여야 함
- `channel=slack` → `target`이 `https://hooks.slack.com/`로 시작하는 URL이어야 함 (스키마 수준 SSRF 방지)
- `condition=event_threshold` → `threshold`와 `windowMinutes` 모두 필수 (`cooldownMinutes`는 선택)
- `condition=event_spike` → `windowMinutes`, `baselineMinutes`, `spikeMultiplier`, `minEvents` 모두 필수. `baselineMinutes > windowMinutes`여야 하며 `cooldownMinutes`는 선택

### GET `/:id/alert-rules/:ruleId`
개별 규칙 조회.

**응답 200:** `{ alertRule: AlertRule }`

### PATCH `/:id/alert-rules/:ruleId`
규칙 부분 수정. 변경할 필드만 전송. 트랜잭션 내에서 기존 값과 병합 후 재검증.

**바디:** `UpdateAlertRuleInput` (모든 필드 optional, 최소 1개 필요)

**응답 200:** `{ alertRule: AlertRule }`

### DELETE `/:id/alert-rules/:ruleId`
규칙 삭제. 연결된 `Notification` 레코드도 Cascade 삭제.

**응답 204:** (본문 없음)

## 입력 스키마

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `name` | string | trim, 1–120자 | 규칙 이름 |
| `channel` | email\|slack | - | 알림 채널 |
| `target` | string | 채널별 검증 | 수신지 (이메일 주소 또는 Slack webhook URL) |
| `condition` | new_issue\|regression\|event_threshold\|event_spike | - | 트리거 조건 |
| `threshold` | int | 1–1000 | event_threshold 시 필수 |
| `windowMinutes` | int | 1–1440 | event_threshold/event_spike 시 필수 |
| `baselineMinutes` | int | 1–1440 | event_spike 시 필수. 최근 구간을 제외한 베이스라인 상한이며 `windowMinutes`보다 커야 함 |
| `spikeMultiplier` | number | 1–100 | event_spike 시 필수. 소수 허용, DB는 `Decimal(5,2)` |
| `minEvents` | int | 1–1000 | event_spike 시 필수. 최근 구간 최소 이벤트 수 |
| `cooldownMinutes` | int | 1–1440, optional | `regression`·`event_threshold`·`event_spike` 조건에서 유효(재발화 억제 간격). `new_issue`에서 지정해도 서버가 null로 저장(1회성이라 무의미). |
| `isActive` | boolean | 기본 true | 활성화 여부 |

> **`cooldownMinutes` 동작 규칙**: 규칙이 발화될 때 같은 `(alertRule, issue)` 쌍으로 이미 dedup 윈도 이내에 발송된 Notification이 있으면 알림을 억제(dedup)한다. dedup 윈도는 조건별로 다르다:
> - `regression`: `cooldownMinutes`, 생략 시 `DEFAULT_REGRESSION_COOLDOWN_MINUTES = 60`.
> - `event_threshold`: `cooldownMinutes`가 있으면 그 값, **없으면 `windowMinutes`로 폴백**(측정창 = 재알림 간격, 기존 동작). 따라서 cooldown을 지정하면 측정창과 독립적으로 재알림 주기를 조절할 수 있다(예: 60분 내 N건을 측정하되 240분에 한 번만 재알림).
> - `event_spike`: `event_threshold`와 동일하게 이슈별로 dedup하며, `cooldownMinutes`가 있으면 그 값, 없으면 `windowMinutes`로 폴백한다.
> - `new_issue`: dedup 자체가 항상 적용(이슈당 1회). `cooldownMinutes`는 null로 강제·무시.

## event_spike 판정식

이슈별로 최근 구간과 베이스라인 구간의 분당 율을 비교한다. 베이스라인은 최근 구간을 제외한 `[now-baselineMinutes, now-windowMinutes)`이다.

```
recent = count(receivedAt >= now-windowMinutes)
baseline = count(receivedAt >= now-baselineMinutes AND receivedAt < now-windowMinutes)
recentRate = recent / windowMinutes
baselineRate = baseline / (baselineMinutes - windowMinutes)

fires = recent >= minEvents AND
  (baselineRate > 0
    ? recentRate >= baselineRate * spikeMultiplier
    : recent >= minEvents)
```

## AlertRule 응답 객체

```
id, projectId, name, channel, target, condition,
threshold(nullable), windowMinutes(nullable), cooldownMinutes(nullable),
baselineMinutes(nullable), spikeMultiplier(nullable), minEvents(nullable),
isActive, createdAt(ISO), updatedAt(ISO)
```

## 관련 개념
- [이슈 API](/api/issues-api.md)
- [시스템 아키텍처](/architecture/system.md)
- [데이터 모델](/database/data-model.md)
