import Map from "ol/Map.js";
import View from "ol/View.js";
import { WKT } from "ol/format.js";
import Point from "ol/geom/Point.js";
import VectorLayer from "ol/layer/Vector.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applySearchSuggestion } from "@/search/searchActions";
import type { SearchSuggestion } from "@/search/searchTypes";

// Make flyTo jump instead of animating: jsdom has no reliable rAF.
function reducedMotion() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
}

function suggestion(overrides: Partial<SearchSuggestion>): SearchSuggestion {
  return { id: "1", type: "RECEPTOR", description: "100000123", score: 1, ...overrides };
}

function wktPoint(x: number, y: number): string {
  return new WKT().writeGeometry(new Point([x, y]));
}

function searchResultStyles(layer: VectorLayer) {
  const styles = layer.getStyleFunction()!({} as never, 1);
  return Array.isArray(styles) ? styles : [styles];
}

function markerGeometryFunction(layer: VectorLayer) {
  return searchResultStyles(layer)[1]!.getGeometryFunction();
}

describe("applySearchSuggestion", () => {
  let map: Map;

  beforeEach(() => {
    reducedMotion();
    map = new Map({
      target: undefined,
      layers: [],
      view: new View({ center: [155000, 463000], zoom: 3, minZoom: 0, maxZoom: 14 }),
    });
    map.setSize([1000, 800]);
  });

  afterEach(() => {
    map.setTarget(undefined);
    map.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("flies to a receptor and highlights it with the selected-receptor layer", () => {
    const center = [149988.14433676028, 459973.44414740487] as const;
    const mapSpy = vi.spyOn(map, "addLayer");

    applySearchSuggestion(map, suggestion({ type: "RECEPTOR", centroid: wktPoint(center[0], center[1]) }));

    expect(mapSpy).toHaveBeenCalled();
    const view = map.getView();
    expect(view.getCenter()![0]).toBeCloseTo(center[0], 0);
    expect(view.getCenter()![1]).toBeCloseTo(center[1], 0);
    const layer = map.getLayers().item(map.getLayers().getLength() - 1) as VectorLayer;
    const types = layer
      .getSource()!
      .getFeatures()
      .map((feature) => feature.getGeometry()!.getType());
    expect(types.filter((type) => type === "Polygon")).toHaveLength(1);
    expect(types.filter((type) => type === "LineString")).toHaveLength(4);
  });

  it("highlights a receptor without the crosshair lines when crosshair is false", () => {
    const center = [149988.14433676028, 459973.44414740487] as const;

    applySearchSuggestion(map, suggestion({ type: "RECEPTOR", centroid: wktPoint(center[0], center[1]) }), { crosshair: false });

    const layer = map.getLayers().item(map.getLayers().getLength() - 1) as VectorLayer;
    const features = layer.getSource()!.getFeatures();
    expect(features).toHaveLength(1);
    expect(features[0]!.getGeometry()!.getType()).toBe("Polygon");
  });

  it("zooms to the extent for a nature area and marks its centroid", () => {
    const centroid = wktPoint(150000, 460000);
    const bbox = new WKT().readGeometry("POLYGON((146000 456000, 154000 456000, 154000 464000, 146000 464000, 146000 456000))");
    const mapSpy = vi.spyOn(map, "addLayer");

    applySearchSuggestion(
      map,
      suggestion({
        type: "ASSESSMENT_AREA",
        centroid,
        bbox: new WKT().writeGeometry(bbox),
      }),
    );

    expect(mapSpy).toHaveBeenCalled();
    const layer = map.getLayers().item(map.getLayers().getLength() - 1) as VectorLayer;
    expect(layer.getSource()!.getFeatures().length).toBe(1);
    // The view must have moved (zoomed out to fit the extent).
    expect(map.getView().getZoom()).toBeLessThan(14);
  });

  it.each([
    ["CITY", "POLYGON((146000 456000,154000 456000,150000 464000,146000 456000))"],
    ["ASSESSMENT_AREA", "MULTIPOLYGON(((146000 456000,154000 456000,150000 464000,146000 456000)))"],
    ["STREET", "LINESTRING(146000 456000,150000 460000,154000 464000)"],
  ])("testHighlightsGeometry: %s", (type, geometry) => {
    const bbox = "POLYGON((140000 450000,160000 450000,160000 470000,140000 470000,140000 450000))";
    applySearchSuggestion(map, suggestion({ type, geometry, bbox, centroid: wktPoint(150000, 460000) }));

    const layer = map.getLayers().item(0) as VectorLayer;
    const features = layer.getSource()!.getFeatures();
    const outline = features.find((feature) => feature.getGeometry()!.getType() !== "Point");
    expect(outline, "the actual location geometry must be highlighted, not its bounding box").toBeDefined();
    expect(new WKT().writeGeometry(outline!.getGeometry()!), "the outline must match the search geometry").toBe(
      new WKT().writeGeometry(new WKT().readGeometry(geometry)),
    );
    const styles = layer.getStyleFunction()!(outline!, 1);
    const style = Array.isArray(styles) ? styles[0]! : styles;
    expect(style?.getStroke()?.getWidth(), "area and road highlights must have a visible stroke").toBeGreaterThan(0);
  });

  it("testGeometryWithoutCentroid", () => {
    applySearchSuggestion(map, suggestion({ type: "ADDRESS", geometry: wktPoint(150000, 460000) }));

    const layer = map.getLayers().item(0) as VectorLayer;
    const features = layer.getSource()!.getFeatures();
    expect(features, "geometry-only results must remain visible").toHaveLength(1);
    expect(searchResultStyles(layer)[1]!.getImage(), "a point-only result needs a marker, not just stroke and fill").toBeDefined();
  });

  it("testMarkerScopedToPoints", () => {
    applySearchSuggestion(
      map,
      suggestion({ type: "CITY", geometry: "POLYGON((146000 456000,154000 456000,150000 464000,146000 456000))" }),
    );

    const layer = map.getLayers().item(0) as VectorLayer;
    const geometryFn = markerGeometryFunction(layer);
    expect(geometryFn, "the marker needs a geometry filter").toBeDefined();
    expect(geometryFn!({ getGeometry: () => new Point([150000, 460000]) } as never), "the marker renders for points").toBeDefined();
    expect(
      geometryFn!({ getGeometry: () => new WKT().readGeometry("POLYGON((146000 456000,154000 456000,150000 464000,146000 456000))") } as never),
      "the marker stays hidden for areas",
    ).toBeUndefined();
  });

  it("testMalformedGeometryUsesCentroid", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    applySearchSuggestion(map, suggestion({ type: "CITY", geometry: "invalid", centroid: wktPoint(150000, 460000) }));

    const layer = map.getLayers().item(0) as VectorLayer;
    const features = layer.getSource()!.getFeatures();
    expect(features, "an invalid outline must retain the centroid fallback").toHaveLength(1);
    expect(features[0]!.getGeometry()!.getType(), "the fallback must be a point marker").toBe("Point");
  });

  it("ignores a suggestion whose geometries cannot be read", () => {
    const mapSpy = vi.spyOn(map, "addLayer");
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    applySearchSuggestion(map, suggestion({ centroid: "not wkt" }));

    expect(mapSpy).not.toHaveBeenCalled();
    expect(warningSpy, "the malformed suggestion should be identifiable in logs").toHaveBeenCalledWith(
      expect.stringContaining("Search suggestion 1"),
      expect.anything(),
    );
  });

  it("replaces the previous search-result layer on repeated selections", () => {
    applySearchSuggestion(map, suggestion({ type: "RECEPTOR", centroid: wktPoint(150000, 460000) }));
    const layerCountAfterFirst = map.getLayers().getLength();

    applySearchSuggestion(map, suggestion({ type: "ADDRESS", centroid: wktPoint(152000, 462000) }));

    expect(map.getLayers().getLength()).toBe(layerCountAfterFirst);
  });

  it("cancels an active flight before starting another", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValueOnce(101).mockReturnValueOnce(102));
    const cancelFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    applySearchSuggestion(map, suggestion({ centroid: wktPoint(150000, 460000) }));
    applySearchSuggestion(map, suggestion({ centroid: wktPoint(160000, 470000) }));

    expect(cancelFrame, "a new selection should stop the previous map flight").toHaveBeenCalledWith(101);
  });

  it("returns to an extent after a receptor flight", () => {
    const extent = "POLYGON((146000 456000, 154000 456000, 154000 464000, 146000 464000, 146000 456000))";
    const area = suggestion({ type: "ASSESSMENT_AREA", bbox: extent });

    applySearchSuggestion(map, area);
    applySearchSuggestion(map, suggestion({ centroid: wktPoint(160000, 470000) }));
    applySearchSuggestion(map, area);

    expect(map.getView().getCenter(), "the repeated extent should not be suppressed after another flight").toEqual([150000, 460000]);
  });

  it("keeps only the newest sonar when a result is selected within the removal time", () => {
    vi.useFakeTimers();
    try {
      applySearchSuggestion(map, suggestion({ type: "CITY", centroid: wktPoint(150000, 460000) }));
      vi.advanceTimersByTime(10_000);
      applySearchSuggestion(map, suggestion({ type: "CITY", centroid: wktPoint(160000, 470000) }));

      expect(map.getOverlays().getLength(), "the obsolete sonar must be gone").toBe(1);

      vi.advanceTimersByTime(1_500);
      expect(map.getOverlays().getLength(), "the newest sonar must not be removed by the previous timeout").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearPreviousSonarOnReceptor", () => {
    vi.useFakeTimers();
    try {
      applySearchSuggestion(map, suggestion({ type: "CITY", centroid: wktPoint(150000, 460000) }));
      applySearchSuggestion(map, suggestion({ type: "RECEPTOR", centroid: wktPoint(149988.14433676028, 459973.44414740487) }));

      expect(map.getOverlays().getLength(), "selecting a receptor must clear the previous sonar").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
