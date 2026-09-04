import { containsExtent } from "ol/extent.js";
import type Map from "ol/Map.js";
import View from "ol/View.js";
import { describe, expect, it } from "vitest";

import { registerRdProjection } from "@/projections/rd";
import { mapViewForExtent, zoomToExtent } from "@/map/zoomToExtent";

const MAP_SIZE: [number, number] = [800, 600];
const RESULT_EXTENT: [number, number, number, number] = [80898, 457695.5, 81908, 458705.5];
const WIDE_RESULT_EXTENT: [number, number, number, number] = [100139, 497637, 131438, 568989];

function view(): View {
  registerRdProjection();
  return new View({ projection: "EPSG:28992", center: [155000, 463000], zoom: 3, minZoom: 2, maxZoom: 15 });
}

describe("mapViewForExtent", () => {
  it("centers a single result extent and respects the map zoom limit", () => {
    const target = mapViewForExtent(view(), RESULT_EXTENT, MAP_SIZE);

    expect(target?.center, "The target center should be the center of the result extent").toEqual([81403, 458200.5]);
    expect(target?.zoom, "The target zoom should fit the result extent inside the padded viewport").toBeCloseTo(10.675212250973399);
  });

  it("keeps a wide result extent inside the map extent", () => {
    const mapView = view();
    const target = mapViewForExtent(mapView, WIDE_RESULT_EXTENT, MAP_SIZE);
    expect(target, "The result extent should produce a map view").toBeDefined();
    if (!target) {
      throw new Error("The result extent should produce a map view");
    }

    mapView.setCenter(target.center);
    mapView.setZoom(target.zoom);

    expect(containsExtent(mapView.calculateExtent(MAP_SIZE), WIDE_RESULT_EXTENT), "Every result hexagon should fit in the map").toBe(true);
  });

  it("waits for the map to be sized before fitting immediately", () => {
    const mapView = view();
    const listeners = new globalThis.Map<string, () => void>();
    const viewport = { size: undefined as [number, number] | undefined };
    const map = {
      getView: () => mapView,
      getSize: () => viewport.size,
      once: (eventName: string, listener: () => void) => listeners.set(eventName, listener),
      render: () => listeners.get("postrender")?.(),
    } as unknown as Map;

    zoomToExtent(map, RESULT_EXTENT, "immediate");
    viewport.size = MAP_SIZE;
    listeners.get("change:size")?.();

    const target = mapViewForExtent(mapView, RESULT_EXTENT, MAP_SIZE);
    expect(target, "The result extent should produce a map view").toBeDefined();
    expect(mapView.getCenter(), "The map should center on the result extent once sized").toEqual(target?.center);
    expect(mapView.getZoom(), "The map should fit the result extent once sized").toBe(target?.zoom);
  });
});
