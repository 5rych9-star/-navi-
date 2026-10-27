import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { LayerGroup, Map as LeafletMap, TileLayer } from "leaflet";
import type { GeoController } from "../lib/geolocation";
import "leaflet/dist/leaflet.css";
import "./AreaMap.css";

type MapLocation = { lat: number; lng: number; label?: string };
type SelectedLocation = { lat: number; lng: number; label: string };
type LeafletModule = typeof import("leaflet");

export type AreaMapProps = {
  mode?: "home" | "journey";
  selected?: MapLocation;
  onSelect?: (location: SelectedLocation) => void;
  destination?: { lat: number; lng: number; name: string };
  compact?: boolean;
  gps?: GeoController;
  onUseCurrentLocation?: (location: SelectedLocation) => void;
};

const DEFAULT_HOME = { lat: 33.5856, lng: 131.1964, label: "ご自宅" };
const PHOTO_URL = "https://maps.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg";
const HOME_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="48" viewBox="0 0 42 48" aria-hidden="true"><path d="M21 47S3 30 3 20a18 18 0 0 1 36 0c0 10-18 27-18 27Z" fill="#236750" stroke="#fff" stroke-width="2"/><path d="m10 20 11-10 11 10M13 18v13h16V18M19 31v-8h5v8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DESTINATION_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="48" viewBox="0 0 42 48" aria-hidden="true"><path d="M21 47S3 30 3 20a18 18 0 0 1 36 0c0 10-18 27-18 27Z" fill="#8a5830" stroke="#fff" stroke-width="2"/><circle cx="21" cy="20" r="7" fill="none" stroke="#fff" stroke-width="3"/></svg>';

function tooltipText(text: string) {
  const element = document.createElement("span");
  element.textContent = text;
  return element;
}

export default function AreaMap({
  mode = "home",
  selected,
  onSelect,
  destination,
  compact = false,
  gps,
  onUseCurrentLocation,
}: AreaMapProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const tilesRef = useRef<TileLayer | null>(null);
  const placesRef = useRef<LayerGroup | null>(null);
  const gpsLayerRef = useRef<LayerGroup | null>(null);
  const gpsRef = useRef(gps);
  const selectedRef = useRef(selected ?? DEFAULT_HOME);
  const onSelectRef = useRef(onSelect);
  const interactiveRef = useRef(mode === "home" && Boolean(onSelect));
  const gpsStartedHere = useRef(false);
  const centeredGps = useRef(false);
  const pendingRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadingTiles, setLoadingTiles] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [initializationError, setInitializationError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const interactive = mode === "home" && Boolean(onSelect);

  gpsRef.current = gps;
  selectedRef.current = selected ?? DEFAULT_HOME;
  onSelectRef.current = onSelect;
  interactiveRef.current = interactive;

  function markPending(value: boolean) {
    pendingRef.current = value;
    setPending(value);
  }

  function commitCenter() {
    const map = mapRef.current;
    if (!interactiveRef.current || !map || !pendingRef.current) return;
    const center = map.wrapLatLng(map.getCenter());
    markPending(false);
    onSelectRef.current?.({
      lat: center.lat,
      lng: center.lng,
      label: "航空写真で選んだご自宅",
    });
  }

  useEffect(() => {
    if (!visible || !containerRef.current) return;
    let disposed = false;
    let localMap: LeafletMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    setReady(false);
    setInitializationError(false);
    setLoadingTiles(true);
    setTileError(false);
    markPending(false);

    async function initialize() {
      try {
        const imported = await import("leaflet");
        if (disposed || !containerRef.current) return;
        const L = imported.default ?? imported;
        leafletRef.current = L;
        const home = selectedRef.current;
        const map = L.map(containerRef.current, {
          center: [home.lat, home.lng],
          zoom: 16,
          minZoom: 2,
          maxZoom: 18,
          keyboard: false,
          zoomControl: true,
          attributionControl: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
        });
        localMap = map;
        mapRef.current = map;
        const zoomIn = containerRef.current.querySelector<HTMLAnchorElement>(
          ".leaflet-control-zoom-in",
        );
        const zoomOut = containerRef.current.querySelector<HTMLAnchorElement>(
          ".leaflet-control-zoom-out",
        );
        zoomIn?.setAttribute("aria-label", "航空写真を拡大");
        zoomIn?.setAttribute("title", "航空写真を拡大");
        zoomOut?.setAttribute("aria-label", "航空写真を縮小");
        zoomOut?.setAttribute("title", "航空写真を縮小");
        const tiles = L.tileLayer(PHOTO_URL, {
          minZoom: 2,
          maxZoom: 18,
          crossOrigin: "anonymous",
          referrerPolicy: "no-referrer",
          attribution: "出典：国土地理院",
        });
        tilesRef.current = tiles;
        tiles.on("loading", () => {
          if (!disposed) setLoadingTiles(true);
        });
        tiles.on("load", () => {
          if (!disposed) setLoadingTiles(false);
        });
        tiles.on("tileerror", () => {
          if (!disposed) {
            setTileError(true);
            setLoadingTiles(false);
          }
        });
        tiles.addTo(map);
        map.on("click", (event) => {
          if (!interactiveRef.current) return;
          markPending(false);
          const location = map.wrapLatLng(event.latlng);
          onSelectRef.current?.({
            lat: location.lat,
            lng: location.lng,
            label: "航空写真で選んだご自宅",
          });
        });
        map.on("dragend", () => {
          if (interactiveRef.current) markPending(true);
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            if (!disposed) map.invalidateSize({ pan: false });
          });
          resizeObserver.observe(containerRef.current);
        }
        map.whenReady(() => {
          if (!disposed) {
            map.invalidateSize({ pan: false });
            setReady(true);
          }
        });
      } catch {
        if (!disposed) {
          setInitializationError(true);
          setLoadingTiles(false);
        }
      }
    }
    void initialize();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (localMap) {
        localMap.off();
        localMap.remove();
      }
      if (mapRef.current === localMap) mapRef.current = null;
      tilesRef.current = null;
      placesRef.current = null;
      gpsLayerRef.current = null;
      centeredGps.current = false;
    };
  }, [visible, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!visible || !ready || !map || !L) return;
    const home = selected ?? DEFAULT_HOME;
    placesRef.current?.remove();
    const places = L.layerGroup().addTo(map);
    placesRef.current = places;
    const homeIcon = L.divIcon({
      className: "aerial-place-icon",
      html: HOME_ICON,
      iconSize: [42, 48],
      iconAnchor: [21, 47],
      tooltipAnchor: [0, -42],
    });
    L.marker([home.lat, home.lng], {
      icon: homeIcon,
      title: "ご自宅",
      keyboard: false,
    })
      .bindTooltip(tooltipText(home.label ?? "ご自宅"), {
        direction: "top",
        className: "aerial-place-label",
      })
      .addTo(places);
    if (mode === "journey" && destination) {
      const destinationIcon = L.divIcon({
        className: "aerial-place-icon",
        html: DESTINATION_ICON,
        iconSize: [42, 48],
        iconAnchor: [21, 47],
        tooltipAnchor: [0, -42],
      });
      L.marker([destination.lat, destination.lng], {
        icon: destinationIcon,
        title: destination.name,
        keyboard: false,
      })
        .bindTooltip(tooltipText(destination.name), {
          direction: "top",
          className: "aerial-place-label",
        })
        .addTo(places);
      map.fitBounds(
        [
          [home.lat, home.lng],
          [destination.lat, destination.lng],
        ],
        {
          padding: [38, 45],
          maxZoom: 15,
          animate: false,
        },
      );
    } else {
      map.setView([home.lat, home.lng], 16, { animate: false });
    }
    markPending(false);
  }, [
    visible,
    ready,
    selected?.lat,
    selected?.lng,
    selected?.label,
    destination?.lat,
    destination?.lng,
    destination?.name,
    mode,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!visible || !ready || !map || !L) return;
    gpsLayerRef.current?.remove();
    gpsLayerRef.current = null;
    if (!gps?.position || gps.status !== "active") {
      centeredGps.current = false;
      return;
    }
    const { lat, lng, accuracy } = gps.position;
    const layer = L.layerGroup().addTo(map);
    gpsLayerRef.current = layer;
    L.circle([lat, lng], {
      radius: Math.max(1, accuracy),
      color: "#1261a0",
      fillColor: "#3496df",
      fillOpacity: 0.15,
      weight: 2,
      interactive: false,
    }).addTo(layer);
    const icon = L.divIcon({
      className: "aerial-current-icon",
      html: '<span aria-hidden="true"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      tooltipAnchor: [0, -13],
    });
    L.marker([lat, lng], {
      icon,
      title: "現在地",
      keyboard: false,
      zIndexOffset: 1000,
    })
      .bindTooltip(tooltipText("現在地"), {
        direction: "top",
        className: "aerial-place-label",
      })
      .addTo(layer);
    if (!centeredGps.current) {
      centeredGps.current = true;
      map.setView([lat, lng], Math.max(16, map.getZoom()), { animate: false });
      markPending(false);
    }
  }, [
    visible,
    ready,
    gps?.status,
    gps?.position?.lat,
    gps?.position?.lng,
    gps?.position?.accuracy,
    gps?.position?.timestamp,
  ]);

  useEffect(
    () => () => {
      if (gpsStartedHere.current) gpsRef.current?.stop();
    },
    [],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !interactive ||
      !ready ||
      event.target !== event.currentTarget ||
      !mapRef.current
    )
      return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitCenter();
      return;
    }
    const movements: Record<string, [number, number]> = {
      ArrowLeft: [-70, 0],
      ArrowRight: [70, 0],
      ArrowUp: [0, -70],
      ArrowDown: [0, 70],
    };
    if (movements[event.key]) {
      event.preventDefault();
      mapRef.current.panBy(movements[event.key], { animate: false });
      markPending(true);
    }
  }

  function hideMap() {
    gpsStartedHere.current = false;
    gpsRef.current?.stop();
    setVisible(false);
    setReady(false);
    setLoadingTiles(false);
    markPending(false);
  }

  function startGps() {
    gpsStartedHere.current = true;
    centeredGps.current = false;
    gpsRef.current?.start();
  }

  function stopGps() {
    gpsStartedHere.current = false;
    gpsRef.current?.stop();
  }

  function recenterGps() {
    const position = gpsRef.current?.position;
    if (!position || !mapRef.current) return;
    mapRef.current.setView(
      [position.lat, position.lng],
      Math.max(16, mapRef.current.getZoom()),
      { animate: false },
    );
    markPending(false);
  }

  const tracking = gps?.status === "requesting" || gps?.status === "active";
  const hasPosition = gps?.status === "active" && Boolean(gps.position);
  const mapLabel = interactive
    ? "自宅を選ぶ航空写真地図"
    : "自宅と目的地を確認する航空写真地図";

  return (
    <section
      className={`area-map area-map--aerial${compact ? " area-map--compact" : ""}`}
      aria-label="航空写真と現在地"
    >
      {!visible ? (
        <div className="aerial-consent">
          <div className="aerial-consent-icon" aria-hidden="true">
            <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
              <path
                d="m4 10 10-4 10 4 10-4v25l-10 4-10-4-10 4Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M14 6v25M24 10v25"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle
                cx="24"
                cy="13"
                r="6"
                fill="#eff6f2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="m28 17 5 5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h3>航空写真で場所を確かめる</h3>
          <p>
            国土地理院の航空写真を表示します。開くと、表示範囲と接続元の IP
            アドレスが国土地理院へ送信されます。
          </p>
          <p>ご自宅・現在地を、ほかの利用者に共有することはありません。</p>
          <button
            type="button"
            className="aerial-button aerial-button--primary"
            onClick={() => setVisible(true)}
          >
            航空写真を表示
          </button>
          {tracking && (
            <button type="button" className="aerial-button" onClick={stopGps}>
              現在地の表示を停止
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="aerial-toolbar">
            <strong>国土地理院の航空写真</strong>
            <button
              type="button"
              className="aerial-button aerial-button--quiet"
              onClick={hideMap}
            >
              航空写真を非表示
            </button>
          </div>
          <div
            className="map-canvas aerial-map-frame"
            role="group"
            tabIndex={0}
            aria-label={mapLabel}
            aria-describedby={`${id}-instructions`}
            aria-busy={!ready && !initializationError}
            onKeyDown={handleKeyDown}
          >
            <div ref={containerRef} className="aerial-leaflet" />
            {interactive && ready && (
              <div className="aerial-center" aria-hidden="true">
                <span />
                <span />
              </div>
            )}
            {!ready && !initializationError && (
              <div className="aerial-loading" role="status">
                地図を準備しています…
              </div>
            )}
          </div>
          <div className="aerial-status" aria-live="polite">
            {initializationError || tileError ? (
              <div className="aerial-error">
                <p>
                  {initializationError
                    ? "地図を準備できませんでした。通信状況をご確認ください。"
                    : "航空写真を読み込めませんでした。一部の写真が表示されないことがあります。通信状況をご確認ください。"}
                </p>
                <button
                  type="button"
                  className="aerial-button"
                  onClick={() => {
                    setAttempt((value) => value + 1);
                  }}
                >
                  航空写真を再読み込み
                </button>
              </div>
            ) : loadingTiles ? (
              <p>航空写真を読み込んでいます…</p>
            ) : null}
            {interactive && pending && (
              <p>
                中心の十字を自宅に合わせ、Enter
                または下のボタンで決定してください。
              </p>
            )}
          </div>
          {interactive && (
            <button
              type="button"
              className="aerial-button aerial-center-button"
              disabled={!ready || !pending}
              onClick={commitCenter}
            >
              地図の中心を自宅に設定
            </button>
          )}
          {gps && (
            <div className="aerial-gps">
              <div className="aerial-gps-heading">
                <strong>現在地</strong>
                <span>
                  {gps.status === "requesting"
                    ? "確認しています…"
                    : hasPosition
                      ? "この端末に表示中"
                      : "自分で開始できます"}
                </span>
              </div>
              <p>
                現在地の取得は、ボタンを押して許可したときだけ始まります。現在地を自動で自宅として保存することはありません。
              </p>
              <div className="aerial-gps-actions">
                {!tracking && (
                  <button
                    type="button"
                    className="aerial-button"
                    disabled={!ready}
                    onClick={startGps}
                  >
                    現在地を表示
                  </button>
                )}
                {tracking && (
                  <button
                    type="button"
                    className="aerial-button"
                    onClick={stopGps}
                  >
                    現在地の表示を停止
                  </button>
                )}
                {hasPosition && (
                  <button
                    type="button"
                    className="aerial-button"
                    onClick={recenterGps}
                  >
                    現在地に戻る
                  </button>
                )}
                {hasPosition && onUseCurrentLocation && (
                  <button
                    type="button"
                    className="aerial-button aerial-button--primary"
                    onClick={() => {
                      const position = gpsRef.current?.position;
                      if (position)
                        onUseCurrentLocation({
                          lat: position.lat,
                          lng: position.lng,
                          label: "現在地のご自宅",
                        });
                    }}
                  >
                    現在地を自宅に設定
                  </button>
                )}
              </div>
              <div className="aerial-gps-message" aria-live="polite">
                {gps.error && <p className="aerial-gps-error">{gps.error}</p>}
                {hasPosition && (
                  <p>
                    青い点が現在地、青い円が位置の精度の目安です（約{" "}
                    {Math.ceil(gps.position!.accuracy).toLocaleString()} m）。
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <p className="aerial-instructions" id={`${id}-instructions`}>
        {interactive
          ? "表示した地図を押すと自宅を選べます。地図にフォーカスして矢印キーで移動、Enter で中心を選べます。"
          : "緑の目印がご自宅、茶色の目印が目的地です。"}
        {mode === "journey" &&
          "表示している経路案内はサンプルです。航空写真上に実際の運行経路は表示していません。"}
      </p>
      <div className="aerial-attribution">
        <a
          href="https://maps.gsi.go.jp/development/ichiran.html#seamlessphoto"
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          出典：国土地理院
        </a>
        <a
          href="https://cyberjapandata.gsi.go.jp/legend/seamlessphoto_precaution.pdf"
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          航空写真のご利用上の注意
        </a>
      </div>
    </section>
  );
}
