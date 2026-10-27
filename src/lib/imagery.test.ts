import { describe, expect, it } from "vitest";
import {
  AERIAL_DISPLAY_MAX_ZOOM,
  AERIAL_SOURCE_MAX_ZOOM,
  AERIAL_TILE_URL,
  AERIAL_VIEW_AREAS,
  getAerialDetailZoom,
  getAerialTileOptions,
} from "./imagery";

describe.each([false, true])("GSI tile limits (retina=%s)", (retina) => {
  it("never requests above the official source limit, including enlarged views", () => {
    const options = getAerialTileOptions(retina);
    for (
      let displayZoom = options.minZoom;
      displayZoom <= options.maxZoom;
      displayZoom++
    ) {
      const gridZoom = Math.min(displayZoom, options.maxNativeZoom);
      const sourceZoom = gridZoom + options.zoomOffset;
      expect(sourceZoom).toBeGreaterThanOrEqual(2);
      expect(sourceZoom).toBeLessThanOrEqual(AERIAL_SOURCE_MAX_ZOOM);
      // Leaflet's smaller retina tile grid must match the requested URL grid.
      expect((256 * 2 ** gridZoom) / options.tileSize).toBe(2 ** sourceZoom);
    }
    expect(options.maxZoom).toBe(AERIAL_DISPLAY_MAX_ZOOM);
    expect(options.detectRetina).toBe(false);
  });

  it("shows the highest available photograph detail without overscaling", () => {
    const options = getAerialTileOptions(retina);
    const detailZoom = getAerialDetailZoom(retina);
    expect(detailZoom).toBe(options.maxNativeZoom);
    expect(detailZoom + options.zoomOffset).toBe(18);
    expect(options.tileSize * (retina ? 2 : 1)).toBe(256);
  });

  it("enlarges the same source image at the display limit", () => {
    const options = getAerialTileOptions(retina);
    const finalSourceZoom =
      Math.min(20, options.maxNativeZoom) + options.zoomOffset;
    expect(finalSourceZoom).toBe(18);
    expect(options.maxZoom).toBeGreaterThan(options.maxNativeZoom);
  });
});

describe("imagery source and regional views", () => {
  it("uses the documented HTTPS service and a native zoom limit of 18", () => {
    expect(AERIAL_TILE_URL).toBe(
      "https://maps.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    );
    expect(AERIAL_SOURCE_MAX_ZOOM).toBe(18);
  });

  it("keeps view-only area shortcuts distinct from user home data", () => {
    const yabakei = AERIAL_VIEW_AREAS.find((area) => area.id === "yabakei");
    expect(yabakei?.label).toBe("耶馬溪周辺");
    expect(yabakei?.lat).toBeGreaterThan(33.3);
    expect(yabakei?.lat).toBeLessThan(33.55);
    expect(yabakei?.lng).toBeGreaterThan(131);
    expect(yabakei?.lng).toBeLessThan(131.25);
    expect(yabakei?.zoom).toBeLessThanOrEqual(AERIAL_SOURCE_MAX_ZOOM);
  });
});
