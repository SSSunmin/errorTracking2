---
type: API Reference
title: 소스맵 API
description: 소스맵 업로드(JWT 인증) 및 목록 조회 엔드포인트. 미니파이된 스택트레이스를 원본 위치로 복원하는 심볼리케이션 기반 인프라.
resource: packages/server/src/modules/sourcemaps/routes.ts
tags: [api, sourcemaps, symbolication, upload, release]
timestamp: 2026-06-22
---

# 소스맵 API

소스맵을 업로드하고 목록을 조회하는 엔드포인트. **모든 라우트에 JWT 인증(`requireAuth`) 필수**. 서비스 레이어에서 프로젝트 소유권을 확인한다(`ensureOwnedProject`).

소스맵에는 원본 소스 코드가 내장될 수 있어 **DSN 공개키 인증이 아닌 JWT 인증**으로 보호한다(공개키는 브라우저에 노출됨).

## 엔드포인트 (prefix: `/api/projects`)

### POST `/:id/releases/:release/sourcemaps`

소스맵 1개를 업로드한다. 같은 `(projectId, release, filename)` 조합이면 upsert로 덮어쓴다.

**인증:** JWT Bearer  
**Content-Type:** `application/octet-stream` (raw 소스맵 JSON 바이트)  
**bodyLimit:** 20 MiB

**쿼리 파라미터:**

| 파라미터 | 설명 |
|---|---|
| `filename` | 미니파이 artifact 이름 (예: `index-4f2a.js`). 쿼리·해시 제거 후 basename만 저장 키로 사용. |

**파라미터 검증:**
- `release`: `^[A-Za-z0-9._\-+:@]+$`, 1–256자
- `filename`: `^[A-Za-z0-9._\-/]+$`, `..` 금지, 1–512자

**서버 동작:**
1. 프로젝트 소유권 확인
2. `frameBasename(filename)`으로 basename 추출 → 저장 키로 사용
3. body를 **비동기 gzip** 압축 (`node:zlib` promisify — 이벤트 루프 블로킹 없음)
4. `(projectId, release, filename=basename)`으로 `SourceMap` upsert
5. 해당 `(projectId, release)`의 `Event.symbolicated`를 `updateMany`로 `null`로 무효화 (재업로드 시 캐시 갱신)

**응답 201:**
```json
{
  "filename": "index-4f2a.js",
  "release": "1.0.0",
  "sizeBytes": 12345,
  "createdAt": "2026-06-22T00:00:00.000Z",
  "updatedAt": "2026-06-22T00:00:00.000Z"
}
```

### GET `/:id/releases/:release/sourcemaps`

해당 릴리스에 업로드된 소스맵 목록 조회. `filename` 오름차순 정렬.

**인증:** JWT Bearer

**응답 200:**
```json
{
  "sourceMaps": [
    {
      "filename": "index-4f2a.js",
      "release": "1.0.0",
      "sizeBytes": 12345,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

> `data`(gzip 바이트) 컬럼은 목록 응답에 포함되지 않는다. 심볼리케이션은 이벤트 조회 시 서버 내부에서만 수행된다.

## 심볼리케이션 흐름 (업로드 후 이벤트 조회 시)

업로드 자체는 저장만 하고, 실제 심볼리케이션은 **이슈 이벤트 조회 시 lazy**하게 수행된다. 흐름은 [인제스트 파이프라인 — 심볼리케이션 절](/architecture/ingestion-pipeline.md) 참고.

## 업로드 CLI (`scripts/upload-sourcemaps.mjs`)

`dist/` 디렉터리를 재귀 스캔해 `*.map` 파일을 모두 업로드하는 Node.js 스크립트.

```sh
MINI_SENTRY_TOKEN=<accessToken> node scripts/upload-sourcemaps.mjs \
  --url http://localhost:3000 \
  --project <projectId> \
  --release <release> \
  --dir packages/dashboard/dist
```

- **토큰**: `MINI_SENTRY_TOKEN` 환경변수 우선, 없으면 `--token` 인자 fallback
- **artifact 이름**: `*.map` 파일의 basename에서 `.map`을 제거한 값(`index-4f2a.js.map` → `index-4f2a.js`)
- 업로드 실패 시 즉시 `process.exit(1)`

## 알려진 한계

1. **basename 매칭 충돌**: 심볼리케이션 매칭 키가 파일 basename이다. 서로 다른 디렉터리에 동명 artifact(`routes/index.js`, `utils/index.js`)가 있으면 구분하지 못한다. 저장 키도 `(projectId, release, filename=basename)`이라 동명이면 upsert로 덮어쓰인다. 콘텐츠 해시 번들명(`index-4f2a.js`)을 사용하는 일반 번들러 설정에서는 실무상 드묾. 향후 full relative path 매칭으로 격상 여지.

2. **소스맵 전량 메모리 로드**: 이벤트 조회 시 해당 릴리스의 소스맵을 전부 DB에서 읽어 메모리에 gunzip한다. 대용량·다수 릴리스에서 메모리 부담이 있다. 향후 오브젝트 스토리지 이전 여지.

3. **업로드 시 동기 캐시 무효화 `updateMany`**: 재업로드 시 해당 릴리스의 모든 이벤트에 `symbolicated = null` mass write가 발생한다. 업로드는 비빈번 관리 작업이라 수용 가능.

4. **읽기 시 쓰기 (cache-fill)**: 이벤트 목록 조회 시 `Event.symbolicated`를 채운다. 동시 요청 시 중복 write가 발생할 수 있으나 멱등하다. cache-fill 실패는 best-effort로 무음 처리된다(`.catch(() => undefined)`).

## 관련 개념
- [소스맵 데이터 모델](/database/data-model.md)
- [인제스트 파이프라인](/architecture/ingestion-pipeline.md)
- [이슈 API](/api/issues-api.md)
- [ERD](/database/erd.md)
