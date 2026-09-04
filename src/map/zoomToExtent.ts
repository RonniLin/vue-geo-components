import type { Extent } from "ol/extent.js";
import type Map from "ol/Map.js";
import type { Size } from "ol/size.js";
import type View from "ol/View.js";

import { extentCorners, sizeOf } from "./extent";
import { mapFlightFor } from "./flyTo";

/** Fraction of the viewport kept clear around a fitted extent. */
const VIEWPORT_PADDING = 0.1;

const VIEWPORT_PADDING_FACTOR = 1 - VIEWPORT_PADDING * 2;

export type MapViewTarget = { center: [number, number]; zoom: number };
export type ExtentZoomMovement = "fly" | "immediate";

/** Return the center and zoom needed to fit an extent within a viewport. */
export function mapViewForExtent(view: View, extent: Extent, size: Size | undefined): MapViewTarget | undefined {
  const viewport = sizeOf(size);
  const corners = extentCorners(extent);
  if (!viewport || !corners || viewport.width <= 0 || viewport.height <= 0) {
    return undefined;
  }

  const resolution = view.getResolutionForExtent(extent, [viewport.width * VIEWPORT_PADDING_FACTOR, viewport.height * VIEWPORT_PADDING_FACTOR]);
  const zoom = view.getZoomForResolution(resolution);
  if (zoom === undefined) {
    return undefined;
  }

  const constrainedZoom = view.getConstrainedZoom(zoom);
  if (constrainedZoom === undefined) {
    return undefined;
  }

  return { center: [(corners.minX + corners.maxX) / 2, (corners.minY + corners.maxY) / 2], zoom: constrainedZoom };
}

/**
 * Fit a given extent inside the map view, leaving a margin around it.
 *
 * The map flies to the extent by default. Use `"immediate"` to update the view
 * without an animation.
 */
export function zoomToExtent(map: Map, extent: Extent, movement: ExtentZoomMovement = "fly"): void {
  const target = mapViewForExtent(map.getView(), extent, map.getSize());
  if (!target) {
    map.once("postrender", () => zoomToExtentWhenSized(map, extent, movement));
    map.render();
    return;
  }

  applyMapViewTarget(map, target, movement);
}

function zoomToExtentWhenSized(map: Map, extent: Extent, movement: ExtentZoomMovement): void {
  const target = mapViewForExtent(map.getView(), extent, map.getSize());
  if (!target) {
    map.once("change:size", () => zoomToExtentWhenSized(map, extent, movement));
    return;
  }

  applyMapViewTarget(map, target, movement);
}

function applyMapViewTarget(map: Map, target: MapViewTarget, movement: ExtentZoomMovement): void {
  if (movement === "fly") {
    mapFlightFor(map).flyTo(target);
    return;
  }

  const view = map.getView();
  view.setCenter(target.center);
  view.setZoom(target.zoom);
}
