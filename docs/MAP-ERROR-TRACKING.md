# 지도(맵) 타일 에러 수집 가이드

MapLibre GL · 네이버 지도 등 **지도 라이브러리의 타일 로드 실패**를 Mini-Sentry로 수집하는 통합 레시피입니다. SDK 자체를 고치지 않고, **맵을 쓰는 서비스 쪽에 몇 줄을 붙이는** 방식입니다.

> **이 문서의 사용법**
> - **사람**: 위에서 아래로 읽고, 쓰는 맵 라이브러리에 해당하는 절(2 또는 3)을 자기 코드에 붙이세요.
> - **AI 에이전트**: 맨 아래 [9. AI 적용 절차](#9-ai-적용-절차-결정적-체크리스트)의 결정적 단계를 따르세요. 전제조건 확인 → 맵 라이브러리 판별 → 해당 스니펫 삽입 → 검증 순서이며, 플레이스홀더 치환표가 포함돼 있습니다.

---

## 0. 왜 필요한가 (배경)

지도 타일 실패는 **기본 자동 수집에서 누락**됩니다. 이유:

- **MapLibre GL**은 타일 fetch 실패를 내부에서 잡아 자기 `map.on('error', …)` 이벤트로 흘립니다 — 처리되지 않은 `window.onerror`/`unhandledrejection`이 아니므로 SDK의 전역 핸들러에 **안 잡힙니다**.
- **네이버 지도**처럼 `<img>` 타일을 쓰는 방식은 타일 실패가 `<img>`의 `error` 이벤트로 뜨는데, 이 이벤트는 **버블링하지 않고 캡처 단계로만** 전파됩니다. SDK 전역 핸들러는 캡처 단계를 듣지 않으므로 역시 **누락**됩니다.

→ 그래서 **수동으로 연결**해야 수집됩니다. 이 문서가 그 연결을 제공합니다.

> **스크린샷 한계(미리 알아두기)**: 에러 시 SDK가 뜨는 DOM 스냅샷은 **픽셀이 아니라 DOM 직렬화**라, MapLibre처럼 WebGL 캔버스로 그리는 맵은 리플레이에서 **맵 영역이 빈 화면**으로 나옵니다. 그래서 이 가이드는 "맵 그림"이 아니라 **실패한 타일 URL·상태코드·직전 행적**을 수집하는 데 초점을 둡니다(대부분의 원인 추적엔 이게 더 유효). 맵 이미지를 진짜로 첨부하려면 `canvas.toDataURL()` + `preserveDrawingBuffer: true` + SDK 첨부필드 확장이 별도로 필요합니다(이 문서 범위 밖).

---

## 1. 전제조건

1. **Mini-Sentry SDK가 이미 초기화돼 있어야 합니다.** 안 돼 있으면 먼저 [사용 가이드 4. SDK 연동](./GUIDE.md#4-sdk-연동)을 끝내세요.
2. 아래 둘 중 하나로 SDK를 호출할 수 있어야 합니다:
   - 번들러/ESM: `import * as MiniSentry from "@mini-sentry/sdk";`
   - script 태그: 전역 `window.MiniSentry`
3. 이 가이드의 코드는 그 호출 방식에 맞춰 `MiniSentry` 또는 `window.MiniSentry`로 바꿔 쓰면 됩니다.

---

## 2. MapLibre GL

MapLibre는 `map.on('error', …)`로 모든 내부 에러(타일 포함)를 받을 수 있습니다. 타일 AJAX 실패는 `e.error`에 `url`·`status`가 담깁니다.

```ts
import * as MiniSentry from "@mini-sentry/sdk";
import type { Map as MapLibreMap } from "maplibre-gl";

// 같은 타일이 연속 실패하면 폭주하므로 url+status로 짧게 디듀프한다.
const recentlyReported = new Map<string, number>();
const DEDUPE_MS = 10_000;

const shouldReport = (key: string): boolean => {
  const now = Date.now();
  const last = recentlyReported.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return false;
  recentlyReported.set(key, now);
  return true;
};

/** 맵 생성 직후 한 번 호출한다. */
export const trackMapErrors = (map: MapLibreMap): void => {
  map.on("error", (e) => {
    // e.error 는 보통 AJAXError(.url, .status) 또는 일반 Error.
    const err = e.error as (Error & { url?: string; status?: number }) | undefined;
    const url = err?.url ?? "(unknown)";
    const status = err?.status;
    const key = `${url}|${status ?? ""}`;
    if (!shouldReport(key)) return;

    // 어떤 타일이/왜 실패했는지를 이벤트 컨텍스트로 실어 보낸다.
    MiniSentry.setContext("map", {
      library: "maplibre-gl",
      tileUrl: url,
      status: status ?? null,
      sourceId: (e as { sourceId?: string }).sourceId ?? null
    });
    MiniSentry.setTag("map.library", "maplibre-gl");

    if (err instanceof Error) {
      MiniSentry.captureException(err);
    } else {
      MiniSentry.captureMessage(`map tile failed: ${url}`, "error");
    }
  });
};
```

```ts
// 맵을 만드는 곳에서:
const map = new maplibregl.Map({ container: "map", style: "<STYLE_URL>" });
trackMapErrors(map);
```

> 참고: `e.error`가 없는 비치명 경고도 `error` 이벤트로 올 수 있습니다. 위 코드는 url/status 디듀프로 노이즈를 줄이지만, 특정 status(예: 404만)로 더 좁히고 싶으면 `if (status !== 404) return;` 같은 가드를 추가하세요.

---

## 3. 네이버 지도 (및 기타 DOM 타일 맵: Leaflet 등)

네이버 지도는 `<img>` 타일을 DOM에 깝니다. `<img>`의 `error`는 버블링하지 않으므로, **맵 컨테이너에 캡처 단계(`capture: true`) 리스너**를 달아 타일 이미지 로드 실패를 포착합니다. 이 방식은 DOM 타일을 쓰는 어떤 맵(Leaflet 등)에도 동일하게 적용됩니다.

```ts
import * as MiniSentry from "@mini-sentry/sdk";

const recentlyReported = new Map<string, number>();
const DEDUPE_MS = 10_000;

const shouldReport = (key: string): boolean => {
  const now = Date.now();
  const last = recentlyReported.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return false;
  recentlyReported.set(key, now);
  return true;
};

/**
 * 맵 컨테이너 엘리먼트를 넘긴다(예: document.getElementById("map")).
 * 정리 함수를 반환하므로 SPA에서 언마운트 시 호출해 리스너를 떼어낸다.
 */
export const trackMapTileErrors = (
  container: HTMLElement,
  library = "naver"
): (() => void) => {
  const onError = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof HTMLImageElement)) return; // 타일 img만
    const url = el.currentSrc || el.src || "(unknown)";
    if (!shouldReport(url)) return;

    MiniSentry.setContext("map", { library, tileUrl: url });
    MiniSentry.setTag("map.library", library);
    MiniSentry.captureMessage(`map tile failed: ${url}`, "error");
  };

  // img error는 버블링하지 않음 → capture 단계로 들어야 잡힌다.
  container.addEventListener("error", onError, { capture: true });
  return () => container.removeEventListener("error", onError, { capture: true });
};
```

```ts
// 맵을 만든 뒤:
const container = document.getElementById("map");
if (container) {
  const stop = trackMapTileErrors(container, "naver");
  // SPA 언마운트 시: stop();
}
```

> **재생 화면 주의**: 네이버 타일은 cross-origin이라, 설령 DOM 스냅샷이 떠도 리플레이 뷰어가 그 타일 URL을 다시 받을 때 서명/만료/referrer 정책으로 **배경이 비어 보일 수** 있습니다. 수집되는 **타일 URL·상태**가 진단의 핵심입니다.

---

## 4. 노이즈 제어 (둘 다 공통)

타일 에러는 한 번에 수십 건씩 쏟아질 수 있습니다. 위 스니펫은 기본 디듀프(같은 키 10초 1회)를 포함하지만, 운영에서 더 줄이려면:

- **레벨 낮추기**: 일시적 네트워크 끊김이면 `captureMessage(..., "warning")`로 보내 새 이슈 알림 폭주를 피함.
- **status 필터**: 4xx(설정/권한)만 보내고 일시적 5xx/네트워크는 제외, 또는 그 반대로 좁힘.
- **오프라인 제외**: `if (!navigator.onLine) return;`로 사용자 네트워크 단절은 수집 제외.

---

## 5. 검증 (붙인 뒤 실제로 확인)

증거 없이 "됐다" 하지 말고 실제로 타일 실패를 유발해 확인하세요.

1. 앱을 띄우고 지도를 연다.
2. 다음 중 하나로 타일 실패를 유발:
   - **DevTools → Network → Offline**로 바꾼 뒤 지도를 팬/줌해 새 타일 요청을 일으킴, 또는
   - 스타일/타일 URL을 일부러 잘못된 값으로 바꿔 로드.
3. **대시보드 → 해당 프로젝트 → 이슈 목록**에 `map tile failed: …`(또는 MapLibre 예외)가 뜨는지 확인.
4. 이슈 상세에서 `map` 컨텍스트(`tileUrl`/`status`)와 직전 breadcrumb(클릭·이동)가 함께 보이면 성공.

---

## 6. 관련 문서

- [Mini-Sentry 사용 가이드](./GUIDE.md) — 계정·DSN·SDK 초기화(전제조건)
- [브라우저 SDK 아키텍처](../knowledge/architecture/sdk.md)
- [이슈 API](../knowledge/api/issues-api.md)

---

## 9. AI 적용 절차 (결정적 체크리스트)

> AI 에이전트가 이 가이드를 읽고 대상 서비스에 자동 반영할 때 따르는 단계. 위 설명을 재해석하지 말고 이 순서대로 수행한다.

**전제 확인**
1. 대상 레포에서 Mini-Sentry SDK 초기화 여부를 확인한다: `MiniSentry.init(` 또는 `window.MiniSentry` 또는 script 태그의 `mini-sentry.min.js` 검색. 없으면 **중단하고** 사용자에게 [GUIDE.md 4. SDK 연동](./GUIDE.md#4-sdk-연동)을 먼저 끝내라고 안내한다.

**맵 라이브러리 판별** (레포에서 검색)
2. `maplibre-gl` import 또는 `new maplibregl.Map(` → **2절(MapLibre)** 적용.
3. `naver.maps`(스크립트 `oapi.map.naver.com`/`openapi.map.naver.com`) 또는 `new naver.maps.Map(` → **3절(네이버, DOM 타일)** 적용.
4. `leaflet`/`L.map(` → **3절**의 DOM 타일 방식 적용(`library` 인자를 `"leaflet"`로).
5. 여러 맵 라이브러리가 공존하면 각각에 해당 절을 모두 적용한다.

**삽입**
6. 해당 절의 헬퍼 함수를 새 모듈(예: `src/observability/mapErrors.ts`)에 추가한다.
7. **맵 인스턴스가 생성되는 위치**를 찾아(위 2·3의 `new …Map(` 호출 지점) 그 직후에 헬퍼를 호출한다(`trackMapErrors(map)` 또는 `trackMapTileErrors(container)`).
8. SDK 호출 형태를 대상 프로젝트에 맞춘다: ESM이면 `import * as MiniSentry from "@mini-sentry/sdk"`, script 태그 방식이면 `window.MiniSentry`로 치환.
9. SPA(React 등)면 언마운트 시 3절 헬퍼의 반환 정리 함수를 호출하도록 effect cleanup에 연결한다.

**플레이스홀더 치환표**

| 플레이스홀더 | 무엇으로 바꾸나 |
|---|---|
| `map` (2절) | 대상 코드의 MapLibre 맵 인스턴스 변수명 |
| `container` (3절) | 맵이 마운트된 DOM 엘리먼트(보통 `new naver.maps.Map(el, …)`의 `el`) |
| `"<STYLE_URL>"` | 기존 맵 스타일 URL(새로 만들지 말고 기존 값 사용) |
| `library` 인자 | `"naver"` / `"leaflet"` 등 실제 라이브러리명 |
| `MiniSentry` | ESM이면 그대로, script 태그면 `window.MiniSentry` |

**검증 (필수, 생략 금지)**
10. 타입체크/빌드를 실행해 통과를 확인한다(`tsc`/번들러).
11. 위 [5. 검증](#5-검증-붙인-뒤-실제로-확인)을 수행해 대시보드에 이슈가 실제로 들어오는지 확인하고, 결과(스크린샷/이슈 제목)를 사용자에게 보고한다. 확인 없이 완료 선언하지 않는다.
</content>
</invoke>
