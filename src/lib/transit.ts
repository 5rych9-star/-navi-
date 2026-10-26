/**
 * Demonstration data only. Stops, service hours, fares and schedules below are
 * synthetic, and must never be used as actual Nakatsu transport information.
 * An operator timetable/booking API must replace this module before deployment.
 */
export interface HomeLocation {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface Destination {
  id: string;
  name: string;
  category: "駅" | "病院" | "買い物" | "公共施設" | "観光";
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface JourneyStep {
  type: "walk" | "shuttle" | "bus";
  title: string;
  from: string;
  to: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  instruction: string;
}

export interface Journey {
  id: string;
  destination: Destination;
  departureTime: string;
  arrivalTime: string;
  fare: number;
  durationMinutes: number;
  transferCount: number;
  demandBus: boolean;
  steps: JourneyStep[];
}

export interface SearchJourneysInput {
  home: HomeLocation;
  destinationId: string;
  date: string;
  arrivalTime: string;
}

export const DEMO_NOTICE =
  "時刻・運賃・経路は体験用のサンプルです。実際の運行や予約には対応していません。";

/** Approximate area centers, not actual individual home addresses. */
export const HOME_AREAS: HomeLocation[] = [
  { id: "oki", label: "沖代町周辺", lat: 33.5856, lng: 131.1964 },
  { id: "osada", label: "大貞周辺", lat: 33.5665, lng: 131.2047 },
  { id: "tsurui", label: "鶴居周辺", lat: 33.5752, lng: 131.1737 },
];

export const DESTINATIONS: Destination[] = [
  {
    id: "nakatsu-station",
    name: "中津駅",
    category: "駅",
    label: "電車への乗り換えに",
    address: "中津市島田",
    lat: 33.5993,
    lng: 131.1908,
  },
  {
    id: "nakatsu-hospital",
    name: "中津市立中津市民病院",
    category: "病院",
    label: "通院・お見舞い",
    address: "中津市下池永",
    lat: 33.5825,
    lng: 131.2126,
  },
  {
    id: "aeon-sanko",
    name: "イオンモール三光",
    category: "買い物",
    label: "お買い物・お食事",
    address: "中津市三光佐知",
    lat: 33.5653,
    lng: 131.2017,
  },
  {
    id: "city-hall",
    name: "中津市役所",
    category: "公共施設",
    label: "お手続き・ご相談",
    address: "中津市豊田町",
    lat: 33.5982,
    lng: 131.1881,
  },
  {
    id: "nakatsu-castle",
    name: "中津城",
    category: "観光",
    label: "お散歩・お出かけ",
    address: "中津市二ノ丁",
    lat: 33.6074,
    lng: 131.1878,
  },
];

const ROUTE_MINUTES: Record<string, number> = {
  "nakatsu-station": 14,
  "nakatsu-hospital": 18,
  "aeon-sanko": 21,
  "city-hall": 16,
  "nakatsu-castle": 20,
};
const SAMPLE_STOP = "乗り継ぎバス停（サンプル）";
const FIRST_BUS = 7 * 60;
const LAST_BUS = 20 * 60;
const FIRST_HOME_DEPARTURE = 6 * 60 + 30;

function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("到着時刻を正しく入力してください。");
  }
  const [hours, minute] = time.split(":").map(Number);
  return hours * 60 + minute;
}

function clock(value: number): string {
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("お出かけの日を正しく入力してください。");
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("お出かけの日を正しく入力してください。");
  }
}

function makeStep(
  type: JourneyStep["type"],
  title: string,
  from: string,
  to: string,
  departure: number,
  durationMinutes: number,
  instruction: string,
): JourneyStep {
  return {
    type,
    title,
    from,
    to,
    durationMinutes,
    instruction,
    departureTime: clock(departure),
    arrivalTime: clock(departure + durationMinutes),
  };
}

/**
 * Finds up to three synthetic itineraries that arrive by the requested time.
 * The service is a daytime demonstration, with departures every 30 minutes.
 * No real timetable, demand-bus eligibility or booking availability is implied.
 */
export function searchJourneys(input: SearchJourneysInput): Journey[] {
  validateDate(input.date);
  const deadline = minutes(input.arrivalTime);
  const destination = DESTINATIONS.find(
    (item) => item.id === input.destinationId,
  );
  if (!destination) throw new Error("一覧から目的地を選んでください。");
  const { home } = input;
  if (
    !home ||
    !home.label?.trim() ||
    !home.id?.trim() ||
    !Number.isFinite(home.lat) ||
    !Number.isFinite(home.lng) ||
    Math.abs(home.lat) > 90 ||
    Math.abs(home.lng) > 180
  ) {
    throw new Error("先にご自宅の場所を設定してください。");
  }

  const busDuration = ROUTE_MINUTES[destination.id];
  // Custom map selections share an area ID, so the coordinates are part of a
  // route's identity. Renaming the same home does not create a different route.
  const homeIdentity = `${home.id}-${home.lat.toFixed(6)}-${home.lng.toFixed(6)}`;
  const finalWalk = 4;
  const latestBus = Math.min(
    LAST_BUS,
    Math.floor((deadline - busDuration - finalWalk) / 30) * 30,
  );
  const result: Journey[] = [];

  for (const variant of ["shuttle", "regular", "earlier-shuttle"] as const) {
    const demandBus = variant !== "regular";
    const busDeparture = latestBus - (variant === "earlier-shuttle" ? 30 : 0);
    const shuttleMinutes =
      home.id === "osada" ? 18 : home.id === "tsurui" ? 16 : 12;
    const transferWait = 5;
    const walkingToStop = 19;
    const departure =
      busDeparture -
      (demandBus
        ? 2 + shuttleMinutes + transferWait
        : walkingToStop + transferWait);
    if (busDeparture < FIRST_BUS || departure < FIRST_HOME_DEPARTURE) continue;

    const steps: JourneyStep[] = demandBus
      ? [
          makeStep(
            "walk",
            "お迎え場所へ",
            home.label,
            "ご自宅近くのお迎え場所",
            departure,
            2,
            "体験用の経路です。ご自宅の近くでお迎えを待つ流れを確認できます。",
          ),
          makeStep(
            "shuttle",
            "デマンドバス",
            "ご自宅近くのお迎え場所",
            SAMPLE_STOP,
            departure + 2,
            shuttleMinutes,
            "乗り継ぎバス停へ向かいます。この画面から実際の予約は送信されません。",
          ),
        ]
      : [
          makeStep(
            "walk",
            "バス停まで歩く",
            home.label,
            SAMPLE_STOP,
            departure,
            walkingToStop,
            "体験用の徒歩経路です。実際のバス停の位置と安全な道は別途ご確認ください。",
          ),
        ];

    const busArrival = busDeparture + busDuration;
    steps.push(
      makeStep(
        "bus",
        "路線バス",
        SAMPLE_STOP,
        `${destination.name}最寄り（サンプル）`,
        busDeparture,
        busDuration,
        "乗り継ぎバス停で5分待ち、サンプルの路線バスに乗ります。",
      ),
      makeStep(
        "walk",
        "目的地へ歩く",
        `${destination.name}最寄り（サンプル）`,
        destination.name,
        busArrival,
        finalWalk,
        "バスを降りたら、目的地まで歩く流れを確認できます。",
      ),
    );

    result.push({
      id: `${homeIdentity}-${destination.id}-${input.date}-${variant}-${clock(busDeparture)}`,
      destination,
      departureTime: clock(departure),
      arrivalTime: clock(busArrival + finalWalk),
      fare: demandBus ? 500 : 250,
      durationMinutes: busArrival + finalWalk - departure,
      transferCount: demandBus ? 1 : 0,
      demandBus,
      steps,
    });
  }

  return result.sort(
    (left, right) =>
      minutes(right.departureTime) - minutes(left.departureTime) ||
      left.fare - right.fare,
  );
}
