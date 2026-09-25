import Feature from "ol/Feature.js";
import VectorLayer from "ol/layer/Vector.js";
import type Map from "ol/Map.js";
import { WKT } from "ol/format.js";
import type { Geometry } from "ol/geom.js";
import Point from "ol/geom/Point.js";
import Overlay from "ol/Overlay.js";
import Circle from "ol/style/Circle.js";
import Fill from "ol/style/Fill.js";
import Style from "ol/style/Style.js";
import Stroke from "ol/style/Stroke.js";
import { createLayer } from "../layers/createLayer";
import { LayerType, type LayerProps } from "../layers/types";
import { mapFlightFor } from "../map/flyTo";
import { zoomToExtent } from "../map/zoomToExtent";
import { createHexagonFeature, pointFromReceptorId, receptorIdFromPoint } from "../receptors/hexagonGrid";
import { createSelectedReceptorLayer, renderSelectedReceptor } from "../receptors/selectedReceptor";
import type { SearchSuggestion } from "./searchTypes";

const HEXAGON_VIEWPORT_FRACTION = 1 / 3;

const wkt = new WKT();

const SEARCH_RESULT_MARKER_COLOR = "#157cb1";
const SEARCH_RESULT_OUTLINE_WIDTH = 2;
const SEARCH_RESULT_AREA_FILL = "rgba(208, 229, 239, 0.4)";
const SEARCH_RESULT_MARKER_RADIUS = 5;

const searchResultStyle = [
  new Style({
    stroke: new Stroke({ color: SEARCH_RESULT_MARKER_COLOR, width: SEARCH_RESULT_OUTLINE_WIDTH }),
    fill: new Fill({ color: SEARCH_RESULT_AREA_FILL }),
  }),
  new Style({
    geometry: (feature) => {
      const geometry = feature.getGeometry();
      return geometry?.getType() === "Point" ? geometry : undefined;
    },
    image: new Circle({ radius: SEARCH_RESULT_MARKER_RADIUS, fill: new Fill({ color: SEARCH_RESULT_MARKER_COLOR }) }),
  }),
];

const resultLayers = new WeakMap<Map, LayerProps>();

/**
 * The AERIUS "sonar" that marks where a search result landed: a one-shot pulse
 * pinned over the result's centroid, echoing the calculator's `MapDaemon`
 * overlay. It is deliberately transient - it pulses a few times and is then
 * removed - so the eye is drawn to the exact spot right after the map moves.
 */
const SONAR_OFFSET_PIXELS = -100;
const SONAR_PULSES = 4;
const SONAR_REMOVE_TIME_MILLISECONDS = 11_000;
const SONAR_STYLE_ELEMENT_ID = "geo-search-sonar-style";

/**
 * Self-contained stylesheet for the sonar. Injected once, lazily, so consumers
 * get the marker without having to wire up a separate stylesheet; guarded so
 * non-DOM environments (tests, SSR) are untouched.
 */
const SONAR_STYLESHEET = `
.geo-search-sonar {
  position: relative;
  width: 198px;
  height: 198px;
  background-color: #157cb144;
  border: 1px solid #157cb1;
  border-radius: 99px;
}

.geo-search-sonar__pulse {
  position: absolute;
  top: 84px;
  left: 84px;
  width: 30px;
  height: 30px;
  border-radius: 30px;
  animation: geo-search-sonar-pulse 1s ease-out ${SONAR_PULSES};
}

.geo-search-sonar__ring {
  position: absolute;
  top: 80px;
  left: 80px;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  border-radius: 30px;
  border: 3px solid #1579a0;
}

.geo-search-sonar__ring::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  border-radius: 24px;
  border: 3px solid #ffffff;
}

@keyframes geo-search-sonar-pulse {
  from {
    top: 83px;
    left: 83px;
    width: 30px;
    height: 30px;
    box-shadow: #1579a0 0 0 0, inset #1579a0 0 0 0;
  }

  to {
    top: 29px;
    left: 29px;
    width: 140px;
    height: 140px;
    border-radius: 100px;
    box-shadow: rgba(21, 124, 177, 0) 0 0 50px, inset rgba(21, 124, 177, 0) 0 0 30px;
  }
}
`;

function ensureSonarStyles(): void {
  if (typeof document === "undefined" || document.getElementById(SONAR_STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = SONAR_STYLE_ELEMENT_ID;
  style.textContent = SONAR_STYLESHEET;
  document.head.appendChild(style);
}

interface Sonar {
  overlay: Overlay;
  timeout: number | undefined;
}

const sonarOverlays = new WeakMap<Map, Sonar>();

function removeSonar(map: Map, sonar?: Sonar): void {
  const current = sonarOverlays.get(map);
  if (!current || (sonar && current !== sonar)) {
    return;
  }
  if (current.timeout !== undefined) {
    window.clearTimeout(current.timeout);
  }
  map.removeOverlay(current.overlay);
  sonarOverlays.delete(map);
}

function pingSonar(map: Map, centroid: Geometry | undefined): void {
  if (typeof document === "undefined" || centroid?.getType() !== "Point") {
    return;
  }
  ensureSonarStyles();
  removeSonar(map);

  const element = document.createElement("div");
  element.className = "geo-search-sonar";
  element.setAttribute("data-id", "map-search-sonar");

  const pulse = document.createElement("div");
  pulse.className = "geo-search-sonar__pulse";
  element.appendChild(pulse);

  const ring = document.createElement("div");
  ring.className = "geo-search-sonar__ring";
  element.appendChild(ring);

  const overlay = new Overlay({
    element,
    insertFirst: false,
    stopEvent: false,
    positioning: "top-left",
    offset: [SONAR_OFFSET_PIXELS, SONAR_OFFSET_PIXELS],
    position: (centroid as Point).getCoordinates(),
  });
  map.addOverlay(overlay);
  const sonar: Sonar = { overlay, timeout: undefined };
  sonarOverlays.set(map, sonar);

  map.once("postrender", () => {
    sonar.timeout = window.setTimeout(() => removeSonar(map, sonar), SONAR_REMOVE_TIME_MILLISECONDS);
  });
}

/**
 * How {@link applySearchSuggestion} highlights the chosen result. Products
 * differ on whether they want the selected receptor's lines out to the map
 * edges, so that is opt-out.
 */
export interface ApplySearchSuggestionOptions {
  /** Draw the receptor crosshair lines out to the view edges. Defaults to `true`. */
  crosshair?: boolean;
}

/**
 * Fly to and highlight a search suggestion. Hexagons get the selected-receptor
 * layer highlighted; other results get their geometry and centroid highlighted
 * and their extent zoomed to. Unreadable geometries are ignored.
 */
export function applySearchSuggestion(map: Map, suggestion: SearchSuggestion, options: ApplySearchSuggestionOptions = {}): void {
  const centroid = readGeometry(suggestion.centroid, suggestion.id, "centroid");
  const geometry = readGeometry(suggestion.geometry, suggestion.id, "geometry");
  const extentGeometry = readGeometry(suggestion.bbox, suggestion.id, "bounding box") ?? geometry;
  if (!centroid && !extentGeometry) {
    return;
  }

  removePreviousResultLayer(map);
  removeSonar(map);

  if (suggestion.type === "RECEPTOR") {
    applyReceptor(map, centroid, options);
    return;
  }
  pingSonar(map, centroid);
  applyExtentResult(map, { centroid, geometry, extentGeometry });
}

function readGeometry(wktText: string | undefined, suggestionId: string, geometryName: string): Geometry | undefined {
  if (!wktText) {
    return undefined;
  }
  try {
    return wkt.readGeometry(wktText);
  } catch (error) {
    console.warn(`Search suggestion ${suggestionId} has an unreadable ${geometryName}.`, error);
    return undefined;
  }
}

function removePreviousResultLayer(map: Map) {
  const previous = resultLayers.get(map);
  if (previous?.layerRef) {
    map.removeLayer(previous.layerRef);
  }
  resultLayers.delete(map);
}

function applyReceptor(map: Map, centroid: Geometry | undefined, options: ApplySearchSuggestionOptions) {
  const coordinates = centroid instanceof Point ? centroid.getCoordinates() : undefined;
  if (!coordinates) {
    return;
  }
  const [x, y] = coordinates;
  if (x === undefined || y === undefined) {
    return;
  }
  const receptorId = receptorIdFromPoint(x, y);
  const [centerX, centerY] = pointFromReceptorId(receptorId);

  const layer = createSelectedReceptorLayer();
  const olLayer = createLayer(layer, map.getView().getProjection());
  map.addLayer(olLayer);
  resultLayers.set(map, layer);
  renderSelectedReceptor(layer, receptorId, { zoomLevel: 1, crosshair: options.crosshair });

  const zoom = zoomForHexagon(map, receptorId);
  mapFlightFor(map).flyTo({ center: [centerX, centerY], zoom });
}

function zoomForHexagon(map: Map, receptorId: number): number {
  const view = map.getView();
  const size = map.getSize();
  if (!size || size[0] === undefined || size[0] === 0) {
    return view.getMaxZoom();
  }
  const geometry = createHexagonFeature(receptorId).getGeometry();
  if (!geometry) {
    return view.getMaxZoom();
  }
  const [minimumX, , maximumX] = geometry.getExtent();
  if (minimumX === undefined || maximumX === undefined) {
    return view.getMaxZoom();
  }
  const resolution = (maximumX - minimumX) / (size[0] * HEXAGON_VIEWPORT_FRACTION);
  const zoom = view.getZoomForResolution(resolution) ?? view.getMaxZoom();
  return Math.min(view.getMaxZoom(), Math.max(view.getMinZoom(), zoom));
}

interface SearchGeometries {
  centroid: Geometry | undefined;
  geometry: Geometry | undefined;
  extentGeometry: Geometry | undefined;
}

function applyExtentResult(map: Map, { centroid, geometry, extentGeometry }: SearchGeometries) {
  const projection = map.getView().getProjection();
  const layer: LayerProps = {
    name: "Search result",
    type: LayerType.EMPTY_VECTOR_LAYER,
    visibility: true,
    opacity: 1,
    zIndex: 3,
    styleFunction: () => searchResultStyle,
  };
  const olLayer = createLayer(layer, projection) as VectorLayer;
  const source = olLayer.getSource();
  const hasOutline = geometry !== undefined && geometry.getType() !== "Point";
  if (geometry) {
    source?.addFeature(new Feature(geometry));
  }
  if (centroid?.getType() === "Point" && !hasOutline) {
    source?.addFeature(new Feature(centroid));
  }
  map.addLayer(olLayer);
  resultLayers.set(map, layer);

  const extent = extentGeometry?.getExtent() ?? centroid?.getExtent();
  if (extent) {
    zoomToExtent(map, extent);
  }
}
