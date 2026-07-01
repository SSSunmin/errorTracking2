import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// 로컬 증명용: 백엔드/SDK 없이, 지도 캔버스를 이미지로 뽑을 수 있는지만 확인한다.
// 핵심은 preserveDrawingBuffer 유무에 따른 차이(실제 이미지 vs 검은 이미지).

interface CaptureStats {
  ok: boolean;
  bytes: number;
  nonBlank: boolean;
  avgLuma: number;
  lumaRange: number;
  note: string;
}

declare global {
  interface Window {
    __CAP_A__?: CaptureStats;
    __CAP_B__?: CaptureStats;
  }
}

const byId = (id: string): HTMLElement | null => document.getElementById(id);

const log = (message: string): void => {
  const out = byId("log");
  if (out) {
    out.textContent = `${new Date().toISOString()}  ${message}\n${out.textContent}`;
  }
};

const osmStyle = (): StyleSpecification => ({
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
});

const makeMap = (container: string, preserveDrawingBuffer: boolean): maplibregl.Map =>
  new maplibregl.Map({
    container,
    style: osmStyle(),
    center: [126.978, 37.5665],
    zoom: 11,
    // maplibre-gl v5는 preserveDrawingBuffer를 canvasContextAttributes로 받는다.
    canvasContextAttributes: { preserveDrawingBuffer }
  });

// 지도 캔버스를 targetW 기준으로 축소해 JPEG 데이터URL로 캡처하고, 검은/빈 이미지인지 판정한다.
const capture = (
  map: maplibregl.Map,
  previewId: string,
  metaId: string,
  statsKey: "__CAP_A__" | "__CAP_B__"
): void => {
  const src = map.getCanvas();
  const targetW = 480;
  const scale = src.width > 0 ? targetW / src.width : 1;
  const targetH = Math.max(1, Math.round(src.height * scale));

  const off = document.createElement("canvas");
  off.width = targetW;
  off.height = targetH;
  const ctx = off.getContext("2d");
  if (!ctx) {
    log(`${statsKey}: 2D 컨텍스트를 못 얻음`);
    return;
  }

  const meta = byId(metaId);
  const preview = byId(previewId);

  try {
    ctx.drawImage(src, 0, 0, targetW, targetH);
    const dataUrl = off.toDataURL("image/jpeg", 0.5);
    const header = "data:image/jpeg;base64,";
    const bytes = Math.round(((dataUrl.length - header.length) * 3) / 4);

    // 검은/빈 이미지 판정: 픽셀을 샘플링해 평균 밝기와 밝기 범위를 본다.
    // preserveDrawingBuffer 미설정 캔버스는 검게(avgLuma≈0) 나온다.
    const pixels = ctx.getImageData(0, 0, targetW, targetH).data;
    let min = 255;
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 400) {
      const luma = ((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
      if (luma < min) min = luma;
      if (luma > max) max = luma;
      sum += luma;
      count += 1;
    }
    const lumaRange = Math.round(max - min);
    const avgLuma = count > 0 ? Math.round(sum / count) : 0;
    const nonBlank = avgLuma > 8;

    if (preview instanceof HTMLImageElement) {
      preview.src = dataUrl;
    }
    const note = nonBlank
      ? "실제 지도 이미지가 담겼습니다."
      : "검은/빈 이미지입니다 (preserveDrawingBuffer 미설정 영향).";
    if (meta) {
      meta.textContent = `크기: ${(bytes / 1024).toFixed(1)} KB · ${String(targetW)}×${String(targetH)} · 평균밝기 ${String(avgLuma)} · 밝기범위 ${String(lumaRange)} · ${note}`;
    }
    window[statsKey] = { ok: true, bytes, nonBlank, avgLuma, lumaRange, note };
    log(`${statsKey} 캡처 완료 — ${(bytes / 1024).toFixed(1)} KB, nonBlank=${String(nonBlank)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (meta) {
      meta.textContent = `캡처 실패: ${message}`;
    }
    window[statsKey] = { ok: false, bytes: 0, nonBlank: false, avgLuma: 0, lumaRange: 0, note: message };
    log(`${statsKey} 캡처 실패: ${message}`);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const mapA = makeMap("map-a", true);
  const mapB = makeMap("map-b", false);

  const enable = (map: maplibregl.Map, buttonId: string): void => {
    void map.once("idle", () => {
      byId(buttonId)?.removeAttribute("disabled");
      log(`${buttonId}: 지도 렌더 완료 → 캡처 가능`);
    });
  };
  enable(mapA, "cap-a");
  enable(mapB, "cap-b");

  byId("cap-a")?.addEventListener("click", () => {
    capture(mapA, "preview-a", "meta-a", "__CAP_A__");
  });
  byId("cap-b")?.addEventListener("click", () => {
    capture(mapB, "preview-b", "meta-b", "__CAP_B__");
  });
});
