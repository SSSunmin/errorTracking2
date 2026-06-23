---
type: API Reference
title: 소스맵 API
description: 소스맵 업로드·목록 조회·삭제(JWT 인증) 엔드포인트. 경로 접미사(path-suffix) 매칭으로 정밀 심볼리케이션, 2단계 메모리 바운딩, 릴리스/단일 artifact DELETE 지원.
resource: packages/server/src/modules/sourcemaps/routes.ts
tags: [api, sourcemaps, symbolication, upload, delete, release]
timestamp: 2026-06-23
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
| `filename` | 미니파이 artifact의 **`--dir` 기준 상대 경로** (예: `assets/routes/index-4f2a.js`). 서버가 `canonicalArtifactName`으로 정규화 후 저장 키로 사용. |

**파라미터 검증:**
- `release`: `^[A-Za-z0-9._\-+:@]+$`, 1–256자
- `filename`: `^[A-Za-z0-9._\-/]+$`, `..` 금지, 1–512자

**서버 동작:**
1. 프로젝트 소유권 확인
2. `canonicalArtifactName(filename)` — `pathSegments()`로 분해 후 `/`로 재결합. 예: `./assets//routes/index.js` → `assets/routes/index.js`. basename-only 업로드(`index.js`)는 그대로 유지.
3. body를 **비동기 gzip** 압축 (`node:zlib` promisify — 이벤트 루프 블로킹 없음)
4. `(projectId, release, filename=정규화된_상대경로)`으로 `SourceMap` upsert
5. 해당 `(projectId, release)`의 `Event.symbolicated`를 `updateMany`로 `null`로 무효화 (재업로드 시 캐시 갱신)

**응답 201:**
```json
{
  "filename": "assets/routes/index-4f2a.js",
  "release": "1.0.0",
  "sizeBytes": 12345,
  "createdAt": "2026-06-23T00:00:00.000Z",
  "updatedAt": "2026-06-23T00:00:00.000Z"
}
```

### DELETE `/:id/releases/:release/sourcemaps`

한 릴리스의 소스맵을 삭제한다. `filename` 쿼리가 있으면 해당 artifact만, 없으면 릴리스 전체를 삭제한다.

**인증:** JWT Bearer

**쿼리 파라미터:**

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `filename` | 선택 | 삭제할 artifact의 상대 경로. 생략 시 릴리스 전체 삭제. |

**서버 동작:**
1. 프로젝트 소유권 확인 (`ensureOwnedProject`)
2. `filename` 있으면 `canonicalArtifactName(filename)`으로 정규화 → 해당 row만 `deleteMany`. 없으면 `(projectId, release)` 전체 `deleteMany`.
3. 삭제된 row가 1개 이상이면 해당 `(projectId, release)`의 `Event.symbolicated`를 `updateMany`로 `null` 무효화 (다음 조회 시 재심볼리케이션).
4. 삭제된 row가 0이면 캐시 무효화 없음.

**응답 200:**
```json
{ "deleted": 3 }
```

> `deleted`가 0이면 해당 조건에 일치하는 row가 없었던 것. 404가 아닌 200으로 응답.

---

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

`--dir` 디렉터리를 재귀 스캔해 `*.map` 파일을 모두 업로드하는 Node.js 스크립트.

```sh
MINI_SENTRY_TOKEN=<accessToken> node scripts/upload-sourcemaps.mjs \
  --url http://localhost:3000 \
  --project <projectId> \
  --release <release> \
  --dir packages/dashboard/dist
```

- **토큰**: `MINI_SENTRY_TOKEN` 환경변수 우선, 없으면 `--token` 인자 fallback
- **artifact 이름**: `--dir` 기준 **상대 경로**에서 `.map`을 제거한 값. `node:path`의 `relative()` + POSIX 슬래시 변환. 예: `dist/assets/routes/index-4f2a.js.map` → `assets/routes/index-4f2a.js`. basename-only가 아닌 전체 상대 경로를 `?filename=`으로 전송해 경로 접미사 매칭이 정밀하게 동작함.
- 업로드 실패 시 즉시 `process.exit(1)`

## 알려진 한계

1. **[해결됨] basename 매칭 충돌 → 경로 접미사 매칭으로 대체**: 심볼리케이션은 이제 `resolveTracerName`(경로 접미사 매칭)으로 프레임 URL을 저장된 artifact 키와 대조한다. 저장 키의 경로 세그먼트가 프레임 URL 세그먼트의 **tail(접미사)**이면 매칭, 가장 긴(가장 구체적인) 매칭이 우선한다. `routes/index.js`와 `utils/index.js`는 서로 다른 키로 구분되어 충돌 없음. basename-only 저장 키(1세그먼트)는 그 이름으로 끝나는 모든 프레임 URL에 매칭되므로 이전 업로드 방식과 하위 호환된다.
   - **남은 주의점**: 매칭은 업로드된 경로가 프레임 URL의 접미사여야 동작한다. 빌드 출력 구조가 프레임 URL 경로와 다르면 매칭 실패 가능. CLI가 `--dir` 기준 상대 경로를 그대로 전송하므로 일반적인 번들러 설정에서는 자동으로 맞음.

2. **[완화됨] 소스맵 전량 메모리 로드 → 2단계 로드로 바운딩**: `loadSourceMapsByName`이 2단계로 동작한다. 1단계: 릴리스의 `filename` 컬럼만 SELECT(경량). 2단계: 실제 프레임이 참조하는 basename(`referencedBasenames`)과 일치하는 행의 gzip `data` blob만 SELECT·gunzip. 프레임이 참조하지 않는 소스맵은 메모리에 올라오지 않는다.
   - **남은 주의점**: 참조된 소스맵 전체는 여전히 메모리에 gunzip된다. 단일 소스맵이 매우 크거나, 한 릴리스에서 다수 소스맵을 동시에 참조하는 경우 메모리 부담 잔존. 향후 오브젝트 스토리지 이전 여지.

3. **업로드 시 동기 캐시 무효화 `updateMany`**: 재업로드 시 해당 릴리스의 모든 이벤트에 `symbolicated = null` mass write가 발생한다. 업로드는 비빈번 관리 작업이라 수용 가능.

4. **읽기 시 쓰기 (cache-fill)**: 이벤트 목록 조회 시 `Event.symbolicated`를 채운다. 동시 요청 시 중복 write가 발생할 수 있으나 멱등하다. cache-fill 실패는 best-effort로 무음 처리된다(`.catch(() => undefined)`).

## 관련 개념
- [소스맵 데이터 모델](/database/data-model.md)
- [인제스트 파이프라인](/architecture/ingestion-pipeline.md)
- [이슈 API](/api/issues-api.md)
- [ERD](/database/erd.md)
