import maplibregl, { type ErrorEvent as MapLibreErrorEvent, type Map, type StyleSpecification } from "maplibre-gl";

type Channel = "window.error" | "window.unhandledrejection" | "map.on(error)";

type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5";

interface ScenarioResult {
  scenario: ScenarioId;
  channels: Channel[];
  detail: string[];
}

interface ObservedEvent {
  scenario: ScenarioId;
  channel: Channel;
  detail: string;
}

declare global {
  interface Window {
    __DONE__?: boolean;
    __RESULTS__?: ScenarioResult[];
  }
}

const scenarioIds: ScenarioId[] = ["S1", "S2", "S3", "S4", "S5"];
let currentScenario: ScenarioId | null = null;
const observed: ObservedEvent[] = [];

const resultsEl = document.getElementById("results");
const mapContainer = document.getElementById("map");

if (!mapContainer) {
  throw new Error("Missing #map container");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const emptyStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#eef2f7",
      },
    },
  ],
});

const summarizeError = (value: unknown): string => {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const render = (): void => {
  const json = JSON.stringify(buildResults(), null, 2);
  window.__RESULTS__ = buildResults();
  if (resultsEl) {
    resultsEl.textContent = json;
  }
};

const record = (channel: Channel, detail: string): void => {
  if (!currentScenario) {
    return;
  }
  observed.push({ scenario: currentScenario, channel, detail });
  render();
};

const buildResults = (): ScenarioResult[] =>
  scenarioIds.map((scenario) => {
    const events = observed.filter((event) => event.scenario === scenario);
    return {
      scenario,
      channels: Array.from(new Set(events.map((event) => event.channel))),
      detail: events.map((event) => `${event.channel}: ${event.detail}`),
    };
  });

window.__DONE__ = false;
window.__RESULTS__ = buildResults();

window.addEventListener("error", (event) => {
  const detail = event.error ? summarizeError(event.error) : event.message;
  record("window.error", detail);
});

window.addEventListener("unhandledrejection", (event) => {
  record("window.unhandledrejection", summarizeError(event.reason));
});

const createMap = (style: StyleSpecification | string): Map => {
  mapContainer.replaceChildren();
  const map = new maplibregl.Map({
    attributionControl: false,
    center: [0, 0],
    container: mapContainer,
    fadeDuration: 0,
    interactive: false,
    style,
    zoom: 2,
  });
  map.on("error", (event: MapLibreErrorEvent) => {
    record("map.on(error)", summarizeError(event.error));
  });
  return map;
};

const waitForLoad = (map: Map, timeoutMs = 2500): Promise<void> =>
  new Promise((resolve) => {
    if (map.loaded()) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(resolve, timeoutMs);
    void map.once("load", () => {
      window.clearTimeout(timeout);
      resolve();
    });
  });

const safelyRemove = (map: Map | null): void => {
  if (!map) {
    return;
  }
  try {
    map.remove();
  } catch (error) {
    record("map.on(error)", `remove failed: ${summarizeError(error)}`);
  }
};

const runScenario = async (scenario: ScenarioId, action: () => Promise<void>): Promise<void> => {
  currentScenario = scenario;
  render();
  await action();
  await sleep(600);
  render();
  currentScenario = null;
  await sleep(100);
};

const run = async (): Promise<void> => {
  await runScenario("S1", async () => {
    const map = createMap(emptyStyle());
    map.on("load", () => {
      throw new Error("S1 throw inside map.on(load) callback");
    });
    await sleep(1500);
    safelyRemove(map);
  });

  await runScenario("S2", async () => {
    const map = createMap({
      version: 8,
      sources: {
        brokenTiles: {
          type: "raster",
          tiles: ["http://127.0.0.1:9/{z}/{x}/{y}.png"],
          tileSize: 256,
        },
      },
      layers: [
        {
          id: "broken-raster",
          type: "raster",
          source: "brokenTiles",
        },
      ],
    });
    await waitForLoad(map);
    map.resize();
    map.setZoom(3);
    map.panBy([128, 96], { duration: 0 });
    await sleep(3500);
    safelyRemove(map);
  });

  await runScenario("S3", async () => {
    const map = createMap("http://127.0.0.1:9/style.json");
    await sleep(3500);
    safelyRemove(map);
  });

  await runScenario("S4", async () => {
    const map = createMap(emptyStyle());
    await waitForLoad(map);
    map.addSource("badGeojson", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                ["not-a-number", 1],
              ],
            },
          },
        ],
      } as GeoJSON.FeatureCollection,
    });
    map.addLayer({
      id: "badGeojsonLayer",
      type: "line",
      source: "badGeojson",
      paint: {
        "line-color": "#d11",
        "line-width": 2,
      },
    });
    await sleep(3500);
    safelyRemove(map);
  });

  await runScenario("S5", async () => {
    const map = createMap(emptyStyle());
    await waitForLoad(map);
    window.setTimeout(() => {
      map.remove();
      map.setZoom(5);
    }, 100);
    await sleep(1500);
  });

  render();
  window.__DONE__ = true;
};

run().catch((error: unknown) => {
  record("window.unhandledrejection", `runner failed: ${summarizeError(error)}`);
  render();
  window.__DONE__ = true;
});
