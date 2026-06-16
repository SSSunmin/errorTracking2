---
type: ERD
title: ERD (엔티티 관계도)
description: Mini-Sentry 데이터 모델의 엔티티·속성·관계를 Mermaid erDiagram으로 표현. 출처는 prisma schema.
resource: packages/server/prisma/schema.prisma
tags: [database, erd, diagram, prisma]
timestamp: 2026-06-16
---

# ERD

`packages/server/prisma/schema.prisma` 기준. 상세 필드 설명은 [데이터 모델](/database/data-model.md) 참고.

```mermaid
erDiagram
    User ||--o{ Project : owns
    User ||--o{ RefreshToken : has
    Project ||--o{ ProjectKey : has
    Project ||--o{ Issue : has
    Project ||--o{ Event : has
    Project ||--o{ AlertRule : has
    Issue ||--o{ Event : groups

    User {
        string id PK
        string email UK
        string passwordHash
        string name "nullable"
        datetime createdAt
        datetime updatedAt
    }
    Project {
        string id PK
        string name
        string slug UK
        string platform "default javascript-browser"
        string ownerId FK
        datetime createdAt
        datetime updatedAt
    }
    ProjectKey {
        string id PK
        string projectId FK
        string publicKey UK
        string label "nullable"
        boolean isActive "default true"
        datetime lastUsedAt "nullable"
        datetime createdAt
    }
    Issue {
        string id PK
        string projectId FK
        string fingerprint "unique per project"
        string title
        string culprit "nullable"
        IssueLevel level "default error"
        IssueStatus status "default unresolved"
        int timesSeen "default 0"
        datetime firstSeen
        datetime lastSeen
        datetime createdAt
        datetime updatedAt
    }
    Event {
        string id PK
        string issueId FK
        string projectId FK
        string message "nullable"
        string exceptionType "nullable"
        string exceptionValue "nullable"
        json stacktrace "nullable"
        json breadcrumbs "nullable"
        json tags "nullable"
        json userContext "nullable"
        json contexts "nullable"
        IssueLevel level
        string environment "nullable"
        string release "nullable"
        string sdkName "nullable"
        string sdkVersion "nullable"
        string requestUrl "nullable"
        string userAgent "nullable"
        datetime timestamp
        datetime receivedAt
    }
    AlertRule {
        string id PK
        string projectId FK
        string name
        AlertChannel channel
        string target
        AlertCondition condition
        int threshold "nullable"
        int windowMinutes "nullable"
        boolean isActive "default true"
        datetime createdAt
        datetime updatedAt
    }
    RefreshToken {
        string id PK
        string userId FK
        string tokenHash UK
        datetime expiresAt
        datetime revokedAt "nullable"
        string replacedByTokenHash "nullable"
        datetime createdAt
    }
```

## 표기
- `||--o{` : 1 : 다(0개 이상) 관계. PK=기본키, FK=외래키, UK=유니크.
- `Event`는 `issueId`와 함께 `projectId`도 직접 보유(비정규화) — 프로젝트 단위 조회 최적화용.

## 관련 개념
- [데이터 모델](/database/data-model.md) · [프로젝트 개요](/overview/mini-sentry.md)
