/** Official GSI seamless aerial imagery; source photographs stop at zoom 18. */
export const AERIAL_TILE_URL =
  "https://maps.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg";
export const AERIAL_SOURCE_MAX_ZOOM = 18;
export const AERIAL_DISPLAY_MAX_ZOOM = 20;

/**
 * Retina screens display a 256px source tile in 128 CSS pixels and request the
 * next zoom level. Clamp the internal native zoom before applying that offset,
 * otherwise Leaflet would request nonexistent zoom-19 tiles. Do not combine
 * these explicit values with Leaflet's automatic detectRetina adjustment.
 */
export function getAerialTileOptions(retina: boolean) {
  const zoomOffset = retina ? 1 : 0;
  return {
    minZoom: 2,
    maxZoom: AERIAL_DISPLAY_MAX_ZOOM,
    maxNativeZoom: AERIAL_SOURCE_MAX_ZOOM - zoomOffset,
    tileSize: retina ? 128 : 256,
    zoomOffset,
    detectRetina: false,
  };
}

/** Highest display zoom that presents source tiles without enlargement. */
export function getAerialDetailZoom(retina: boolean) {
  return AERIAL_SOURCE_MAX_ZOOM - (retina ? 1 : 0);
}

/** Approximate regional centres for changing the view, not home locations. */
export const AERIAL_VIEW_AREAS = [
  {
    id: "nakatsu",
    label: "中津市街",
    lat: 33.599,
    lng: 131.191,
    zoom: 15,
  },
  {
    id: "yabakei",
    label: "耶馬溪周辺",
    lat: 33.45,
    lng: 131.11,
    zoom: 15,
  },
] as const;
