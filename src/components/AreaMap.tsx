import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

type MapLocation = { lat: number; lng: number; label?: string };

export type AreaMapProps = {
  mode?: "home" | "journey";
  selected?: MapLocation;
  onSelect?: (location: { lat: number; lng: number; label: string }) => void;
  destination?: { lat: number; lng: number; name: string };
  compact?: boolean;
};

const WIDTH = 760;
const HEIGHT = 430;
const CENTER = { lat: 33.586, lng: 131.19 };
const LATITUDE_SPAN = 0.064;
const LONGITUDE_SPAN = 0.06;
const DEFAULT_HOME = { lat: 33.591, lng: 131.178, label: "自宅" };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function toPoint(location: MapLocation) {
  return {
    x: clamp(
      WIDTH / 2 + ((location.lng - CENTER.lng) / LONGITUDE_SPAN) * WIDTH,
      42,
      WIDTH - 42,
    ),
    y: clamp(
      HEIGHT / 2 - ((location.lat - CENTER.lat) / LATITUDE_SPAN) * HEIGHT,
      50,
      HEIGHT - 44,
    ),
  };
}

function toLocation(point: { x: number; y: number }) {
  return {
    lat: Number(
      (CENTER.lat - ((point.y - HEIGHT / 2) / HEIGHT) * LATITUDE_SPAN).toFixed(
        6,
      ),
    ),
    lng: Number(
      (CENTER.lng + ((point.x - WIDTH / 2) / WIDTH) * LONGITUDE_SPAN).toFixed(
        6,
      ),
    ),
    label: "地図で選んだ自宅",
  };
}

function Tree({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <rect x="-1.5" y="3" width="3" height="9" rx="1.5" fill="#8f9b79" />
      <circle cx="0" cy="0" r="9" fill="#b3c79d" />
      <circle cx="-3" cy="-2" r="5.5" fill="#c4d3ae" />
    </g>
  );
}

function BusStop({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="11" fill="#fff" stroke="#94ad9a" strokeWidth="1.5" />
      <rect x="-5" y="-6" width="10" height="10" rx="2" fill="#6d8f7a" />
      <rect x="-3.3" y="-4.3" width="6.6" height="3.5" rx=".6" fill="#fff" />
      <circle cx="-2.7" cy="2" r="1" fill="#fff" />
      <circle cx="2.7" cy="2" r="1" fill="#fff" />
      <path
        d="M-3 4v2M3 4v2"
        stroke="#6d8f7a"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {label && (
        <text
          x="0"
          y="29"
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="#6b786b"
        >
          {label}
        </text>
      )}
    </g>
  );
}

export default function AreaMap({
  mode = "home",
  selected,
  onSelect,
  destination,
  compact = false,
}: AreaMapProps) {
  const mapId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [point, setPoint] = useState(() => toPoint(selected ?? DEFAULT_HOME));
  const [pending, setPending] = useState(false);
  const interactive = mode === "home" && Boolean(onSelect);
  const destinationPoint = destination
    ? toPoint(destination)
    : { x: 530, y: 128 };

  useEffect(() => {
    setPoint(toPoint(selected ?? DEFAULT_HOME));
    setPending(false);
  }, [selected?.lat, selected?.lng]);

  function selectPoint(nextPoint: { x: number; y: number }) {
    setPoint(nextPoint);
    setPending(false);
    onSelect?.(toLocation(nextPoint));
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!interactive || !svgRef.current) return;
    const svg = svgRef.current;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const position = cursor.matrixTransform(matrix.inverse());
    selectPoint({
      x: clamp(position.x, 42, WIDTH - 42),
      y: clamp(position.y, 50, HEIGHT - 44),
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (pending) selectPoint(point);
      return;
    }
    const delta: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -14, y: 0 },
      ArrowRight: { x: 14, y: 0 },
      ArrowUp: { x: 0, y: -14 },
      ArrowDown: { x: 0, y: 14 },
    };
    const movement = delta[event.key];
    if (movement) {
      event.preventDefault();
      setPoint((current) => ({
        x: clamp(current.x + movement.x, 42, WIDTH - 42),
        y: clamp(current.y + movement.y, 50, HEIGHT - 44),
      }));
      setPending(true);
    }
  }

  const mapLabel = interactive
    ? "自宅を選ぶサンプル地図。地図を押すか、矢印キーで位置を動かし、エンターキーで選んでください。"
    : "自宅と目的地の位置関係を示したサンプル地図。実際の道路や運行経路とは異なります。";
  const destinationLabel = destination?.name ?? "目的地";

  return (
    <div
      className={`area-map${compact ? " area-map--compact" : ""}`}
      style={{ width: "100%" }}
    >
      <div
        className="map-canvas"
        role={interactive ? "group" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? mapLabel : undefined}
        aria-describedby={interactive ? `${mapId}-hint` : undefined}
        onClick={interactive ? handleClick : undefined}
        onKeyDown={interactive ? handleKeyDown : undefined}
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 20,
          background: "#e9eee1",
          cursor: interactive ? "crosshair" : "default",
          lineHeight: 0,
          isolation: "isolate",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${mapId}-title ${mapId}-description`}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            minHeight: compact ? 190 : 220,
            maxHeight: compact ? 320 : undefined,
          }}
        >
          <title id={`${mapId}-title`}>中津のおでかけ サンプル地図</title>
          <desc id={`${mapId}-description`}>
            {mapLabel} 地理情報・道路・施設の配置は説明用の模式図です。
          </desc>
          <defs>
            <pattern
              id={`${mapId}-grid`}
              width="42"
              height="42"
              patternUnits="userSpaceOnUse"
            >
              <rect width="42" height="42" fill="#ecede4" />
              <rect x="6" y="7" width="25" height="21" rx="4" fill="#e3e5da" />
            </pattern>
            <filter
              id={`${mapId}-shadow`}
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feDropShadow
                dx="0"
                dy="4"
                stdDeviation="5"
                floodColor="#234837"
                floodOpacity=".18"
              />
            </filter>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill={`url(#${mapId}-grid)`} />
          <path d="M0 0H170L161 64L93 100L0 84Z" fill="#d7e2ca" />
          <path d="M0 298L90 274L148 310L139 430H0Z" fill="#dce5cc" />
          <path d="M448 0H543L574 74L519 111L447 78Z" fill="#d6e1c9" />
          <path
            d="M605 -30C569 40 616 85 602 142S558 224 609 279S666 352 622 460"
            fill="none"
            stroke="#b9d9de"
            strokeWidth="64"
          />
          <path
            d="M605 -30C569 40 616 85 602 142S558 224 609 279S666 352 622 460"
            fill="none"
            stroke="#c7e3e7"
            strokeWidth="43"
          />
          <g
            fill="none"
            stroke="#fdfcf7"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M-25 172L174 165L339 191L516 174L785 178" />
            <path d="M109 -20L134 112L126 242L159 450" />
            <path d="M307 -10L297 117L315 241L293 450" />
            <path d="M493 -20L480 112L493 260L530 450" />
            <path d="M-20 333L209 319L390 333L578 319L790 352" />
            <path d="M-15 70L222 86L419 67L565 74L789 64" />
            <path d="M209 -20L221 103L205 234L226 450" strokeWidth="7" />
            <path d="M399 -20L417 108L402 258L409 450" strokeWidth="7" />
            <path d="M-10 251L221 239L405 259L566 249" strokeWidth="7" />
          </g>
          <path
            d="M-10 398L211 383L400 399L778 388"
            fill="none"
            stroke="#c3c7bb"
            strokeWidth="8"
          />
          <path
            d="M-10 398L211 383L400 399L778 388"
            fill="none"
            stroke="#f7f6ef"
            strokeWidth="3"
            strokeDasharray="6 7"
          />
          <path
            d="M560 174H650M580 319L668 331"
            fill="none"
            stroke="#d6dbd0"
            strokeWidth="19"
          />
          <path
            d="M560 174H650M580 319L668 331"
            fill="none"
            stroke="#fdfcf7"
            strokeWidth="12"
          />
          <g fill="#d6dfc6">
            <rect x="334" y="98" width="58" height="58" rx="15" />
            <rect x="29" y="190" width="68" height="45" rx="10" />
            <rect x="340" y="280" width="39" height="27" rx="6" />
          </g>
          <g fill="#dddccf" stroke="#d1d2c6" strokeWidth="1">
            <rect x="158" y="113" width="35" height="29" rx="4" />
            <rect x="239" y="110" width="34" height="31" rx="4" />
            <rect x="337" y="213" width="38" height="22" rx="4" />
            <rect x="153" y="263" width="35" height="34" rx="4" />
            <rect x="241" y="263" width="32" height="30" rx="4" />
            <rect x="431" y="194" width="35" height="36" rx="4" />
            <rect x="431" y="284" width="34" height="30" rx="4" />
          </g>
          <Tree x={41} y={39} size={1.1} />
          <Tree x={70} y={48} />
          <Tree x={99} y={32} size={1.2} />
          <Tree x={355} y={120} />
          <Tree x={374} y={138} size={0.8} />
          <Tree x={472} y={32} />
          <Tree x={509} y={49} size={1.2} />
          <Tree x={42} y={320} />
          <Tree x={66} y={350} size={1.1} />
          <Tree x={35} y={379} size={0.8} />
          <Tree x={699} y={252} />
          <Tree x={722} y={271} size={0.85} />
          <g fontFamily="inherit" fill="#7d8577" fontSize="12" fontWeight="500">
            <text x="51" y="115">
              中津のまち
            </text>
            <text x="340" y="88">
              公園
            </text>
            <text x="660" y="111" fill="#7b9fa5">
              川
            </text>
            <text x="169" y="220">
              住宅地
            </text>
          </g>
          <g transform="translate(364 365)">
            <rect
              x="-25"
              y="-10"
              width="94"
              height="31"
              rx="7"
              fill="#fdfcf7"
              stroke="#d4d7ca"
            />
            <rect x="-13" y="-3" width="15" height="15" rx="3" fill="#648875" />
            <path d="M-9 1h7M-9 5h7" stroke="#fff" strokeWidth="1.7" />
            <text
              x="13"
              y="11"
              fontFamily="inherit"
              fontSize="13"
              fontWeight="600"
              fill="#5c7163"
            >
              中津駅
            </text>
          </g>
          <BusStop
            x={299}
            y={178}
            label={mode === "journey" ? "乗りかえ" : undefined}
          />
          <BusStop x={489} y={251} />
          <BusStop x={130} y={326} />
          {mode === "journey" && (
            <g>
              <path
                d={`M${point.x} ${point.y}L${point.x} 249L299 249L299 178L${destinationPoint.x} 178L${destinationPoint.x} ${destinationPoint.y}`}
                fill="none"
                stroke="#fff"
                strokeWidth="12"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={`M${point.x} ${point.y}L${point.x} 249L299 249L299 178`}
                fill="none"
                stroke="#d99c55"
                strokeWidth="6"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray="8 9"
              />
              <path
                d={`M299 178L${destinationPoint.x} 178L${destinationPoint.x} ${destinationPoint.y}`}
                fill="none"
                stroke="#36765b"
                strokeWidth="6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle
                cx="299"
                cy="178"
                r="8"
                fill="#fff"
                stroke="#36765b"
                strokeWidth="4"
              />
              <g
                transform={`translate(${destinationPoint.x} ${destinationPoint.y})`}
                filter={`url(#${mapId}-shadow)`}
              >
                <circle r="19" fill="#fff" />
                <path
                  d="M0 12S-9 2-9-4a9 9 0 0 1 18 0C9 2 0 12 0 12Z"
                  fill="#36765b"
                />
                <circle cy="-4" r="3" fill="#fff" />
              </g>
              <g
                transform={`translate(${clamp(destinationPoint.x, 100, 660)} ${destinationPoint.y + 35})`}
              >
                <rect
                  x="-93"
                  y="-12"
                  width="186"
                  height="27"
                  rx="13.5"
                  fill="#fff"
                  fillOpacity=".96"
                />
                <text
                  textAnchor="middle"
                  y="6"
                  fontFamily="inherit"
                  fontSize="13"
                  fontWeight="700"
                  fill="#365e49"
                >
                  {destinationLabel.length > 13
                    ? `${destinationLabel.slice(0, 12)}…`
                    : destinationLabel}
                </text>
              </g>
            </g>
          )}
          <g
            transform={`translate(${point.x} ${point.y})`}
            filter={`url(#${mapId}-shadow)`}
          >
            <circle r="29" fill="#fff" fillOpacity=".55" />
            <circle
              r="21"
              fill={pending ? "#d7994c" : "#35694e"}
              stroke="#fff"
              strokeWidth="4"
            />
            <path
              d="M-10 0L0-9L10 0M-7-2V9H7V-2M-2 9V3H2V9"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <g
            transform={`translate(${clamp(point.x, 72, 688)} ${clamp(point.y + 42, 27, HEIGHT - 16)})`}
          >
            <rect
              x="-58"
              y="-13"
              width="116"
              height="27"
              rx="13.5"
              fill="#fff"
            />
            <text
              y="5"
              textAnchor="middle"
              fontFamily="inherit"
              fontSize="13"
              fontWeight="700"
              fill="#365e49"
            >
              {pending ? "Enterで決定" : "ご自宅"}
            </text>
          </g>
          <g transform="translate(654 23)">
            <rect
              width="88"
              height="26"
              rx="13"
              fill="#fff"
              fillOpacity=".94"
            />
            <text
              x="44"
              y="17"
              textAnchor="middle"
              fontFamily="inherit"
              fontSize="11"
              fontWeight="600"
              fill="#6e786a"
            >
              サンプル地図
            </text>
          </g>
          <g transform="translate(29 27)" fill="#6f7e6a">
            <path d="M0 23L7 2L14 23L7 19Z" fill="#8e9e83" />
            <text
              x="7"
              y="-3"
              textAnchor="middle"
              fontFamily="inherit"
              fontSize="10"
            >
              N
            </text>
          </g>
        </svg>
      </div>
      <p
        id={`${mapId}-hint`}
        style={{
          margin: "10px 2px 0",
          color: "#586650",
          fontSize: 12,
          lineHeight: 1.7,
        }}
      >
        {interactive
          ? "地図を押して自宅を選べます。矢印キーで移動、Enterで決定。"
          : "道路・施設の位置や経路は説明用の参考表示です。"}
        {interactive && "実際の位置とは異なる参考地図です。"}
      </p>
      <span
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {pending ? "位置を移動しました。エンターキーで決定してください。" : ""}
      </span>
    </div>
  );
}
