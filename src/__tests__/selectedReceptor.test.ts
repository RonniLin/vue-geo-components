import Map from "ol/Map.js";
import View from "ol/View.js";
import VectorLayer from "ol/layer/Vector.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLayer } from "@/layers/createLayer";
import { receptorIdFromPoint } from "@/receptors/hexagonGrid";
import { createSelectedReceptorLayer, renderSelectedReceptor } from "@/receptors/selectedReceptor";

const RECEPTOR_CENTER = [149988.14433676028, 459973.44414740487] as const;

describe("renderSelectedReceptor", () => {
  let map: Map;

  beforeEach(() => {
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
  });

  function addSelectedReceptorLayer() {
    const layer = createSelectedReceptorLayer();
    const olLayer = createLayer(layer, map.getView().getProjection()) as VectorLayer;
    map.addLayer(olLayer);
    return { layer, olLayer };
  }

  function featureTypes(olLayer: VectorLayer): string[] {
    return olLayer
      .getSource()!
      .getFeatures()
      .map((feature) => feature.getGeometry()!.getType());
  }

  it("draws the hexagon plus lines out to the view edges by default", () => {
    const { layer, olLayer } = addSelectedReceptorLayer();

    renderSelectedReceptor(layer, receptorIdFromPoint(RECEPTOR_CENTER[0], RECEPTOR_CENTER[1]), { zoomLevel: 1 });

    expect(featureTypes(olLayer)).toEqual(["LineString", "LineString", "LineString", "LineString", "Polygon"]);
  });

  it("draws only the hexagon when crosshair is disabled", () => {
    const { layer, olLayer } = addSelectedReceptorLayer();

    renderSelectedReceptor(layer, receptorIdFromPoint(RECEPTOR_CENTER[0], RECEPTOR_CENTER[1]), { zoomLevel: 1, crosshair: false });

    expect(featureTypes(olLayer)).toEqual(["Polygon"]);
  });
});
