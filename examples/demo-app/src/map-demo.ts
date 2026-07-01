import maplibregl, {
  type ErrorEvent as MapLibreErrorEvent,
  type StyleSpecification
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as MiniSentry from "@mini-sentry/sdk";

// React 샘플 프로젝트 DSN (대시보드 자동 로그인 계정 소유 — 로그인 없이 이슈 확인 가능).
// 로컬 개발용 public 키. 다른 프로젝트로 보내려면 입력란 또는 ?dsn= 로 교체.
const DEFAULT_DSN =
  "http://37156db10703e716d5fc369efc88a785@localhost:4100/cmqhbmcvv000lq9r8ikbunvay";

const byId = (id: string): HTMLElement | null => document.getElementById(id);

const log = (message: string): void => {
  const out = byId("log");
  if (out) {
    out.textContent = `${new Date().toISOString()}  ${message}\n${out.textContent}`;
  }
};

// 정상 배경지도(OSM 래스터 타일, API 키 불필요).
const baseStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }]
};

let map: maplibregl.Map | null = null;
let unsubscribe: (() => void) | null = null;

const triggerBrokenStyle = (): void => {
  if (!map) return;
  log("깨진 스타일 로드 시도 → map.on('error') 1건 발화 예정");
  map.setStyle("http://127.0.0.1:9/style.json");
};

const triggerBrokenTiles = (): void => {
  if (!map) return;
  log("깨진 타일 소스 추가 → 타일마다 map.on('error') 발화 (레이트 캡 적용)");
  const id = `broken-${String(Date.now())}`;
  map.addSource(id, {
    type: "raster",
    tiles: ["http://127.0.0.1:9/{z}/{x}/{y}.png"],
    tileSize: 256
  });
  map.addLayer({ id, type: "raster", source: id });
};

const start = (dsn: string, auto: boolean): void => {
  const client = MiniSentry.init({
    dsn,
    release: "map-demo-1.0.0",
    environment: "demo",
    // 지도 에러엔 DOM 스냅샷이 불필요하고, maplibre CSS까지 인라인되면 페이로드가
    // 커져 keepalive fetch(본문 64KB 상한)로 전송이 막힐 수 있어 끈다.
    captureReplay: false
  });
  if (!client) {
    log("SDK init 실패 — DSN 형식을 확인하세요.");
    return;
  }
  MiniSentry.setTag("surface", "map-demo");
  log(`SDK init 완료 → ${dsn}`);

  map = new maplibregl.Map({
    container: "map",
    style: baseStyle,
    center: [126.978, 37.5665],
    zoom: 10
  });

  // 핵심: 지도 에러를 captureException으로 전달한다. 이 에러들은
  // window.onerror/unhandledrejection에 올라오지 않아 전역 핸들러가 놓친다.
  unsubscribe = MiniSentry.captureMapErrors(map);

  // 데모용 로컬 로그: 어떤 에러가 대시보드로 나가는지 화면에 표시.
  map.on("error", (event: MapLibreErrorEvent) => {
    log(`map.on(error) → 대시보드로 전송: ${event.error.message}`);
  });

  byId("broken-style")?.removeAttribute("disabled");
  byId("broken-tiles")?.removeAttribute("disabled");

  if (auto) {
    void map.once("idle", () => {
      triggerBrokenStyle();
    });
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const dsnInput = byId("dsn");
  if (dsnInput instanceof HTMLInputElement) {
    dsnInput.value = params.get("dsn") ?? DEFAULT_DSN;
  }

  const currentDsn = (): string =>
    dsnInput instanceof HTMLInputElement && dsnInput.value.trim()
      ? dsnInput.value.trim()
      : DEFAULT_DSN;

  byId("start")?.addEventListener("click", () => {
    start(currentDsn(), false);
  });
  byId("broken-style")?.addEventListener("click", triggerBrokenStyle);
  byId("broken-tiles")?.addEventListener("click", triggerBrokenTiles);

  // ?auto=1 이면 로드 즉시 시작 + 지도 준비되면 스타일 에러 자동 유발 (헤드리스 검증용).
  if (params.get("auto") === "1") {
    start(currentDsn(), true);
  }
});

window.addEventListener("beforeunload", () => {
  unsubscribe?.();
});
