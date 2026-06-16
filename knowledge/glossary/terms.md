---
type: Glossary
title: 용어집
description: Mini-Sentry 도메인 핵심 용어 — Issue/Event/fingerprint/DSN/ProjectKey 등.
resource: packages/server/prisma/schema.prisma
tags: [glossary, domain, terminology]
timestamp: 2026-06-16
---

# 용어집

- **Project(프로젝트)**: 모니터링 단위. `slug`(고유), `platform`(기본 `javascript-browser`)을 가짐. 한 User가 소유.
- **ProjectKey(프로젝트 키)**: 인제스트 인증용 공개키(`publicKey`, 고유). 활성/비활성 토글, 회전 가능. DSN의 기반.
- **DSN**: SDK가 이벤트를 보낼 때 쓰는 접속 문자열. 형식 `<scheme>://<publicKey>@<host>/<projectId>` (출처 `modules/keys/dsn.ts`).
- **Event(이벤트)**: 개별 에러 발생 1건. 스택트레이스·breadcrumbs·tags·컨텍스트(JSON), 환경/릴리스/SDK 정보 포함.
- **Issue(이슈)**: 같은 `fingerprint`로 묶인 에러 그룹. `timesSeen`·`firstSeen`·`lastSeen`으로 추이 추적.
- **fingerprint**: 이벤트를 이슈로 묶는 그룹핑 키. `@@unique([projectId, fingerprint])`로 프로젝트 내 유일.
- **IssueLevel**: debug·info·warning·error·fatal. **IssueStatus**: unresolved·resolved·ignored.
- **AlertRule(알림 규칙)**: 조건(`new_issue`/`regression`/`event_threshold`) 충족 시 채널(email/slack)로 알림. `threshold`·`windowMinutes`로 임계 설정.
- **액세스 토큰 / 리프레시 토큰**: 자세히는 [인증 플로우](/architecture/auth-flow.md). 리프레시 **회전(rotation)** = 사용 시 새 토큰 발급+기존 폐기, **재사용 탐지** = 폐기된 토큰 재사용 시 전체 폐기.

## 관련 개념
- [데이터 모델](/database/data-model.md) · [ERD](/database/erd.md) · [프로젝트 개요](/overview/mini-sentry.md)
