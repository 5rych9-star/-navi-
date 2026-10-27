import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bus,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Footprints,
  Heart,
  Home,
  Info,
  Leaf,
  MapPin,
  Navigation,
  Plus,
  Route,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrainFront,
  Trash2,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import AreaMap from "./components/AreaMap";
import useGeolocation from "./hooks/useGeolocation";
import {
  DESTINATIONS,
  HOME_AREAS,
  searchJourneys,
  type Destination,
  type HomeLocation,
  type Journey,
  type JourneyStep,
} from "./lib/transit";
import {
  clearUserData,
  loadProfile,
  loadTrips,
  saveProfile,
  saveTrips,
  type Profile,
  type SavedTrip,
} from "./lib/storage";

type View = "search" | "results" | "journey" | "trips" | "help";
type ModalName = "profile" | "booking" | "delete" | null;

function todayInJapan() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function displayDate(date: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+09:00`));
}
function iconForStep(type: JourneyStep["type"], size = 23) {
  return type === "walk" ? <Footprints size={size} /> : <Bus size={size} />;
}
function destinationIcon(destination: Destination, size = 25) {
  if (destination.category === "駅") return <TrainFront size={size} />;
  if (destination.category === "病院")
    return <Plus size={size} strokeWidth={2.5} />;
  if (destination.category === "買い物") return <ShoppingBag size={size} />;
  return <MapPin size={size} />;
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function BusIllustration() {
  return (
    <svg className="hero-illustration" viewBox="0 0 430 225" aria-hidden="true">
      <path
        d="M96 173C52 101 98 28 177 22c68-8 124 14 157 69 28 47 6 94-45 101Z"
        fill="#e5eddd"
      />
      <circle cx="319" cy="47" r="20" fill="#f1d897" opacity=".9" />
      <path
        d="M29 194c73-18 259-20 373-1"
        stroke="#b6c7ae"
        strokeWidth="2"
        fill="none"
        strokeDasharray="5 7"
      />
      <path
        d="M338 182v-66m0 21-17-13m17 30 18-18"
        fill="none"
        stroke="#8da988"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse cx="339" cy="105" rx="28" ry="37" fill="#a9c6a1" />
      <ellipse cx="324" cy="113" rx="18" ry="23" fill="#bed1b0" />
      <path
        d="M70 172v-40m0 12-12-8"
        stroke="#9cb294"
        strokeWidth="3"
        fill="none"
      />
      <ellipse cx="71" cy="122" rx="18" ry="25" fill="#bbcfab" />
      <ellipse cx="209" cy="189" rx="105" ry="9" fill="#cdd8c6" />
      <rect x="108" y="85" width="200" height="94" rx="19" fill="#247b63" />
      <path
        d="M130 68h151c16 0 27 10 27 27v32H108V91c0-14 8-23 22-23"
        fill="#fdfbf0"
        stroke="#247b63"
        strokeWidth="3"
      />
      <rect x="123" y="83" width="37" height="38" rx="5" fill="#cce3d8" />
      <rect x="169" y="83" width="37" height="38" rx="5" fill="#cce3d8" />
      <rect x="215" y="83" width="37" height="38" rx="5" fill="#cce3d8" />
      <path d="M263 83h25c4 0 7 3 7 7v65h-32Z" fill="#cce3d8" />
      <path d="M279 85v68" stroke="#f5f5df" strokeWidth="3" />
      <path
        d="M132 86l12 1-17 28h-3Zm47 0h10l-17 28h-2Zm46 0h10l-17 28h-2Z"
        fill="#eaf3e9"
      />
      <rect x="118" y="137" width="132" height="4" rx="2" fill="#c2d4b8" />
      <rect x="108" y="163" width="201" height="8" rx="4" fill="#e8e8cc" />
      <circle cx="148" cy="177" r="17" fill="#394d45" />
      <circle cx="148" cy="177" r="8" fill="#f4f2e8" />
      <circle cx="269" cy="177" r="17" fill="#394d45" />
      <circle cx="269" cy="177" r="8" fill="#f4f2e8" />
      <rect x="184" y="71" width="50" height="6" rx="3" fill="#8ea88a" />
      <path
        d="M104 129v14m205-16v13"
        stroke="#f4d599"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="m370 73 3-10m-9 4 10 2M49 66l3-10m-9 4 10 2"
        stroke="#9eb59b"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App() {
  const gps = useGeolocation();
  const [view, setView] = useState<View>("search");
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [trips, setTrips] = useState<SavedTrip[]>(loadTrips);
  const [destinationId, setDestinationId] = useState("");
  const [date, setDate] = useState(todayInJapan);
  const [arrivalTime, setArrivalTime] = useState("10:00");
  const [results, setResults] = useState<Journey[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);
  const [journeyDate, setJourneyDate] = useState(date);
  const [journeyProfile, setJourneyProfile] = useState<Profile | null>(profile);
  const [modal, setModal] = useState<ModalName>(null);
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [homeDraft, setHomeDraft] = useState<HomeLocation>(
    profile?.home ?? HOME_AREAS[0],
  );
  const [homeLabel, setHomeLabel] = useState(profile?.home.label ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [notice, setNotice] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const destinationSelectRef = useRef<HTMLSelectElement>(null);

  // A new screen or a closed registration dialog must not keep tracking.
  useEffect(() => () => gps.stop(), [view, modal, gps.stop]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    setError("");
    setGuideStep(null);
    window.speechSynthesis?.cancel();
  }, [view]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 7000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (guideStep === 0)
      document
        .getElementById("guidance")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [guideStep]);

  function navigate(next: View) {
    setView(next);
  }
  function openProfile() {
    setNickname(profile?.nickname ?? "");
    setHomeDraft(profile?.home ?? HOME_AREAS[0]);
    setHomeLabel(profile?.home.label ?? "");
    setModalError("");
    setModal("profile");
  }
  function registerHome(event: FormEvent) {
    event.preventDefault();
    const newProfile: Profile = {
      nickname: nickname.trim(),
      home: { ...homeDraft, label: homeLabel.trim() || homeDraft.label },
    };
    if (!newProfile.nickname) {
      setModalError("お名前（ニックネーム）を入力してください。");
      return;
    }
    const saved = saveProfile(newProfile);
    setProfile(newProfile);
    setModal(null);
    setNotice(
      saved
        ? "ご自宅を登録しました。さっそく行き先を選びましょう。"
        : "このブラウザでは保存できません。画面を閉じるまでは利用できます。",
    );
  }
  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!profile) {
      openProfile();
      return;
    }
    if (!destinationId) {
      setError("行きたい場所を選んでください。");
      destinationSelectRef.current?.focus();
      return;
    }
    try {
      setResults(
        searchJourneys({
          home: profile.home,
          destinationId,
          date,
          arrivalTime,
        }),
      );
      setView("results");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "入力内容をご確認ください。",
      );
    }
  }
  function openJourney(
    journey: Journey,
    selectedDate = date,
    selectedProfile = profile,
  ) {
    setSelectedJourney(journey);
    setJourneyDate(selectedDate);
    setJourneyProfile(selectedProfile);
    setGuideStep(null);
    setView("journey");
  }
  function savePlan(event: FormEvent) {
    event.preventDefault();
    if (!selectedJourney || !journeyProfile || !confirmed) return;
    if (trips.some((trip) => trip.journey.id === selectedJourney.id)) {
      setModalError("この経路はすでに「おでかけ予定」に保存されています。");
      return;
    }
    const trip: SavedTrip = {
      id: crypto.randomUUID(),
      profile: journeyProfile,
      journey: selectedJourney,
      date: journeyDate,
      createdAt: new Date().toISOString(),
      status: "saved",
    };
    const next = [trip, ...trips];
    if (!saveTrips(next)) {
      setModalError(
        "予定を保存できませんでした。ブラウザの保存設定や空き容量をご確認ください。実際の予約は送信されていません。",
      );
      return;
    }
    setTrips(next);
    setModal(null);
    setView("trips");
    setNotice(
      "体験用のおでかけ予定を保存しました。実際の予約は送信されていません。",
    );
  }
  function removeTrip(id: string) {
    const next = trips.filter((trip) => trip.id !== id);
    if (!saveTrips(next)) {
      setNotice("削除できませんでした。ブラウザの保存設定をご確認ください。");
      return;
    }
    setTrips(next);
    setNotice("保存した予定を削除しました。");
  }
  function choosePopular(id: string) {
    setDestinationId(id);
    setView("search");
    window.setTimeout(() => destinationSelectRef.current?.focus(), 0);
  }
  function speakStep(step: JourneyStep) {
    if (!("speechSynthesis" in window)) {
      setNotice(
        "このブラウザは音声読み上げに対応していません。画面の案内をご確認ください。",
      );
      return;
    }
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(
      `体験用の案内です。${step.departureTime}、${step.title}。${step.from}から${step.to}へ。${step.instruction}`,
    );
    speech.lang = "ja-JP";
    speech.rate = 0.85;
    window.speechSynthesis.speak(speech);
  }

  const selectedIsSaved =
    selectedJourney &&
    trips.some((trip) => trip.journey.id === selectedJourney.id);
  const activeGuideStep =
    selectedJourney && guideStep !== null
      ? selectedJourney.steps[guideStep]
      : null;

  return (
    <div className={`app ${largeText ? "large-text" : ""}`}>
      <a href="#main-content" className="skip-link">
        本文へ移動
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a
            href="#"
            className="brand"
            onClick={(event) => {
              event.preventDefault();
              navigate("search");
            }}
            aria-label="おでかけナビ なかつ ホーム"
          >
            <span className="brand-icon">
              <Bus size={29} strokeWidth={1.8} />
            </span>
            <span className="brand-copy">
              <strong>
                おでかけナビ<span> なかつ</span>
              </strong>
              <small>いつもの街へ、安心のおでかけ。</small>
            </span>
          </a>
          <nav className="desktop-nav" aria-label="メインメニュー">
            <button
              className={
                ["search", "results", "journey"].includes(view)
                  ? "nav-active"
                  : ""
              }
              onClick={() => navigate("search")}
            >
              <Search size={19} />
              経路をさがす
            </button>
            <button
              className={view === "trips" ? "nav-active" : ""}
              onClick={() => navigate("trips")}
            >
              <CalendarDays size={19} />
              おでかけ予定
              {trips.length > 0 && (
                <span className="count-badge">{trips.length}</span>
              )}
            </button>
            <button
              className={view === "help" ? "nav-active" : ""}
              onClick={() => navigate("help")}
            >
              <CircleHelp size={19} />
              使い方
            </button>
          </nav>
          <button
            className="text-size-button"
            aria-pressed={largeText}
            onClick={() => setLargeText(!largeText)}
          >
            <span>
              あ<span>あ</span>
            </span>
            <small>文字サイズ</small>
          </button>
        </div>
      </header>
      <div className="demo-bar">
        <Info size={16} />
        <span>
          <strong>体験版</strong>{" "}
          サンプルの時刻・経路でお試しいただけます。実際の予約は送信されません。
        </span>
      </div>

      <main id="main-content" className="main-container">
        {view === "search" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span />
                  中津の毎日を、バスでつなぐ
                </div>
                <h1 ref={headingRef} tabIndex={-1}>
                  おでかけを、
                  <br />
                  <span>もっと気軽に。</span>
                </h1>
                <p>
                  ご自宅から行きたい場所まで。
                  <br />
                  バスの乗り換えを、やさしくご案内します。
                </p>
              </div>
              <BusIllustration />
              <span className="hero-note">
                <Leaf size={16} />
                あなたの「行きたい」に、よりそって。
              </span>
            </section>

            <div className="search-layout">
              <section
                className="card search-card"
                aria-labelledby="search-title"
              >
                <div className="section-heading">
                  <span className="heading-icon">
                    <Route size={22} />
                  </span>
                  <h2 id="search-title">どこへおでかけしますか？</h2>
                </div>
                <form onSubmit={handleSearch} noValidate>
                  <div className="location-fields">
                    <div className="location-row from-row">
                      <span className="field-dot start-dot" />
                      <div className="field-content">
                        <span className="field-label">出発する場所</span>
                        <div className="from-value">
                          <Home size={21} />
                          <strong>
                            {profile ? "ご自宅" : "ご自宅を登録しましょう"}
                          </strong>
                          {profile && (
                            <span className="home-area">
                              {profile.home.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={openProfile}
                      >
                        {profile ? "変更" : "登録する"}
                        <ChevronRight size={17} />
                      </button>
                    </div>
                    <div className="location-row destination-row">
                      <span className="field-dot end-dot" />
                      <div className="field-content">
                        <label className="field-label" htmlFor="destination">
                          行きたい場所
                        </label>
                        <div className="select-wrapper">
                          <MapPin size={22} />
                          <select
                            id="destination"
                            ref={destinationSelectRef}
                            value={destinationId}
                            aria-describedby={
                              error ? "search-error" : undefined
                            }
                            onChange={(event) =>
                              setDestinationId(event.target.value)
                            }
                          >
                            <option value="">目的地を選んでください</option>
                            {DESTINATIONS.map((destination) => (
                              <option
                                value={destination.id}
                                key={destination.id}
                              >
                                {destination.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown size={20} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="date-time-row">
                    <div className="input-group">
                      <label htmlFor="date">
                        <CalendarDays size={18} />
                        おでかけの日
                      </label>
                      <input
                        id="date"
                        type="date"
                        required
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor="arrival-time">
                        <Clock3 size={18} />
                        着きたい時刻
                      </label>
                      <div className="time-input">
                        <input
                          id="arrival-time"
                          type="time"
                          required
                          value={arrivalTime}
                          onChange={(event) =>
                            setArrivalTime(event.target.value)
                          }
                        />
                        <span>までに到着</span>
                      </div>
                    </div>
                  </div>
                  {error && (
                    <p className="error-message" id="search-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="primary-button search-submit"
                  >
                    <Search size={23} />
                    この条件で経路をさがす
                    <ArrowRight size={21} />
                  </button>
                  <p className="under-button">
                    <ShieldCheck size={15} />
                    乗り換えが少なく、わかりやすい経路をご案内
                  </p>
                </form>
              </section>

              <aside className="home-card card">
                <div className="home-card-top">
                  <span className="home-icon">
                    <Home size={22} />
                  </span>
                  <div>
                    <h2>
                      {profile
                        ? `${profile.nickname}さんのご自宅`
                        : "まずは、ご自宅の登録から"}
                    </h2>
                    <p>
                      {profile
                        ? profile.home.label
                        : "毎回の出発地入力が、いらなくなります。"}
                    </p>
                  </div>
                  {profile && <CheckCircle2 className="home-saved" size={21} />}
                </div>
                <AreaMap
                  selected={profile?.home ?? HOME_AREAS[0]}
                  gps={gps}
                  compact
                />
                <div className="home-card-bottom">
                  <p>
                    <MapPin size={16} />
                    地図からかんたんに設定できます
                  </p>
                  <button className="secondary-button" onClick={openProfile}>
                    {profile ? "ご自宅の登録を確認・変更" : "ご自宅を登録する"}
                    <ArrowRight size={18} />
                  </button>
                </div>
              </aside>
            </div>

            <section
              className="popular-section"
              aria-labelledby="popular-title"
            >
              <div className="popular-title-row">
                <h2 id="popular-title">
                  <MapPin size={21} />
                  よく使われる行き先
                </h2>
                <span>行き先を押すと、目的地に設定されます</span>
              </div>
              <div className="destination-grid">
                {DESTINATIONS.slice(0, 4).map((destination) => (
                  <button
                    className={`destination-card destination-${destination.category}`}
                    key={destination.id}
                    onClick={() => choosePopular(destination.id)}
                  >
                    <span className="destination-icon">
                      {destinationIcon(destination)}
                    </span>
                    <span>
                      <strong>
                        {destination.id === "nakatsu-hospital"
                          ? "中津市民病院"
                          : destination.name}
                      </strong>
                      <small>{destination.label}</small>
                    </span>
                    <ChevronRight size={19} />
                  </button>
                ))}
              </div>
            </section>

            <section className="support-banner">
              <span className="support-icon">
                <Heart size={27} />
              </span>
              <div>
                <h2>はじめてでも、大丈夫。</h2>
                <p>ご自宅の登録から乗り換えまで、ひとつずつお手伝いします。</p>
              </div>
              <button onClick={() => navigate("help")}>
                使い方を見る
                <ChevronRight size={19} />
              </button>
            </section>
            <div className="reassurance-row">
              <span>
                <CheckCircle2 size={17} />
                見やすい文字と、大きなボタン
              </span>
              <span>
                <CheckCircle2 size={17} />
                ご自宅から目的地までご案内
              </span>
              <span>
                <CheckCircle2 size={17} />
                デマンドバスの申込を体験
              </span>
            </div>
          </>
        )}

        {view === "results" && (
          <>
            <button className="back-button" onClick={() => navigate("search")}>
              <ArrowLeft size={19} />
              検索条件を変える
            </button>
            <div className="page-heading">
              <div>
                <div className="eyebrow">ご自宅からのおでかけ</div>
                <h1 ref={headingRef} tabIndex={-1}>
                  {
                    DESTINATIONS.find(
                      (destination) => destination.id === destinationId,
                    )?.name
                  }
                  への経路
                </h1>
                <p>
                  {displayDate(date)}・{arrivalTime}までに到着
                </p>
              </div>
              <span className="soft-badge">サンプルの検索結果</span>
            </div>
            <div className="inline-notice">
              <Info size={20} />
              <p>
                時刻・運賃・経路はすべてサンプルです。実際のおでかけには使用できません。
              </p>
            </div>
            {results.length > 0 ? (
              <div className="results-grid">
                {results.map((journey, index) => (
                  <article
                    className={`card result-card ${index === 0 ? "recommended" : ""}`}
                    key={journey.id}
                  >
                    {index === 0 && (
                      <div className="recommendation">
                        <Sparkles size={16} />
                        ゆとりをもって出発
                      </div>
                    )}
                    <div className="result-topline">
                      <span
                        className={`route-type ${journey.demandBus ? "" : "walking"}`}
                      >
                        {journey.demandBus ? (
                          <Bus size={17} />
                        ) : (
                          <Footprints size={17} />
                        )}
                        {journey.demandBus
                          ? "お迎えのある経路"
                          : "バス停まで歩く経路"}
                      </span>
                      <span>経路 {index + 1}</span>
                    </div>
                    <div className="journey-times">
                      <div>
                        <strong>{journey.departureTime}</strong>
                        <span>ご自宅を出発</span>
                      </div>
                      <div className="duration-line">
                        <span>{journey.durationMinutes}分</span>
                        <ArrowRight size={26} />
                      </div>
                      <div>
                        <strong>{journey.arrivalTime}</strong>
                        <span>目的地に到着</span>
                      </div>
                    </div>
                    <div className="route-sequence">
                      {journey.steps.map((step, stepIndex) => (
                        <span key={stepIndex}>
                          {stepIndex > 0 && <ChevronRight size={15} />}
                          {iconForStep(step.type, 19)}
                          {step.type === "shuttle"
                            ? "デマンドバス"
                            : step.type === "bus"
                              ? "路線バス"
                              : "徒歩"}
                        </span>
                      ))}
                    </div>
                    <div className="result-details">
                      <span>
                        乗り換え <strong>{journey.transferCount}回</strong>
                      </span>
                      <span>
                        運賃（例）
                        <strong>{journey.fare.toLocaleString()}円</strong>
                      </span>
                    </div>
                    <button
                      className={
                        index === 0 ? "primary-button" : "secondary-button"
                      }
                      onClick={() => openJourney(journey)}
                    >
                      この経路を見る
                      <ArrowRight size={19} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="card empty-state">
                <Clock3 size={45} />
                <h2>この時刻に到着する経路がありません</h2>
                <p>
                  サンプルの路線バスは7:00〜20:00の出発です。
                  <br />
                  到着時刻を10:00などに変えてお試しください。
                </p>
                <button
                  className="primary-button"
                  onClick={() => navigate("search")}
                >
                  時刻を変えてさがす
                </button>
              </div>
            )}
          </>
        )}

        {view === "journey" && selectedJourney && (
          <>
            <button
              className="back-button"
              onClick={() => navigate(selectedIsSaved ? "trips" : "results")}
            >
              <ArrowLeft size={19} />
              {selectedIsSaved ? "おでかけ予定へ" : "経路の一覧へ"}
            </button>
            <div className="page-heading">
              <div>
                <div className="eyebrow">自宅から、ひとつずつご案内</div>
                <h1 ref={headingRef} tabIndex={-1}>
                  {selectedJourney.destination.name}へおでかけ
                </h1>
                <p>
                  {displayDate(journeyDate)}・{selectedJourney.departureTime}
                  出発 → {selectedJourney.arrivalTime}到着
                </p>
              </div>
              <span className="soft-badge">体験用の経路</span>
            </div>
            <div className="journey-layout">
              <section className="card timeline-card">
                <div className="section-heading">
                  <Route size={23} />
                  <h2>おでかけの道順</h2>
                  <span>{selectedJourney.durationMinutes}分</span>
                </div>
                <div className="timeline">
                  <div className="timeline-endpoint">
                    <span className="endpoint-icon">
                      <Home size={19} />
                    </span>
                    <div>
                      <strong>{selectedJourney.departureTime}　ご自宅</strong>
                      <small>{journeyProfile?.home.label}</small>
                    </div>
                  </div>
                  {selectedJourney.steps.map((step, index) => (
                    <div
                      key={index}
                      className={`timeline-step ${guideStep === index ? "current-step" : ""}`}
                    >
                      <span className={`step-icon ${step.type}`}>
                        {iconForStep(step.type)}
                      </span>
                      <div className="step-content">
                        <div className="step-title">
                          <strong>{step.title}</strong>
                          <span>{step.durationMinutes}分</span>
                        </div>
                        <p>
                          {step.departureTime} 〜 {step.arrivalTime}
                        </p>
                        <p className="step-to">{step.to}</p>
                        {step.type === "bus" && (
                          <small className="transfer-note">
                            バス停で5分待って乗り換え
                          </small>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="timeline-endpoint">
                    <span className="endpoint-icon destination-end">
                      <MapPin size={19} />
                    </span>
                    <div>
                      <strong>
                        {selectedJourney.arrivalTime}　
                        {selectedJourney.destination.name}
                      </strong>
                      <small>目的地に到着です</small>
                    </div>
                  </div>
                </div>
                <div className="fare-summary">
                  <span>運賃の目安（サンプル）</span>
                  <strong>
                    {selectedJourney.fare.toLocaleString()}
                    <small>円</small>
                  </strong>
                </div>
              </section>
              <aside className="journey-side">
                <div className="card route-map-card">
                  <AreaMap
                    mode="journey"
                    selected={journeyProfile?.home}
                    destination={selectedJourney.destination}
                    gps={gps}
                  />
                  <p>
                    <Info size={16} />
                    航空写真は実地図です。バスの経路・時刻はサンプルで、道路に沿った道案内は行いません。
                  </p>
                </div>
                {selectedIsSaved ? (
                  <div className="card action-card">
                    <span className="action-icon">
                      <Navigation size={27} />
                    </span>
                    <h2>準備ができたら、出発しましょう</h2>
                    <p>
                      乗り換えの流れを、一つずつ
                      <br />
                      画面で確認できます。
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setGuideStep(0);
                        document.getElementById("guidance")?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }}
                    >
                      乗り換え案内をはじめる
                      <ArrowRight size={19} />
                    </button>
                    <small>
                      現在地は地図のGPSボタンから確認できます。案内の手順はサンプルです。
                    </small>
                  </div>
                ) : (
                  <div className="card action-card">
                    <span className="action-icon">
                      <Bus size={27} />
                    </span>
                    <h2>
                      {selectedJourney.demandBus
                        ? "お迎えの申込を体験する"
                        : "このおでかけを保存する"}
                    </h2>
                    <p>
                      {selectedJourney.demandBus
                        ? "ご自宅近くからバス停までの\nお迎え内容を確認しましょう。"
                        : "予定を保存して、乗り換えの\n案内を体験できます。"}
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setConfirmed(false);
                        setModalError("");
                        setModal("booking");
                      }}
                    >
                      {selectedJourney.demandBus
                        ? "申込内容の確認へ"
                        : "予定の確認へ"}
                      <ArrowRight size={19} />
                    </button>
                    <small>体験用です。実際の予約は送信されません。</small>
                  </div>
                )}
              </aside>
            </div>
            {guideStep !== null && (
              <section
                className="card guidance-card"
                id="guidance"
                aria-live="polite"
              >
                {activeGuideStep ? (
                  <>
                    <div className="guidance-heading">
                      <span className="soft-badge">
                        手順 {guideStep + 1} / {selectedJourney.steps.length}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => speakStep(activeGuideStep)}
                      >
                        <Volume2 size={21} />
                        音声で読み上げ
                      </button>
                    </div>
                    <div className="guidance-main">
                      <span className="action-icon">
                        {iconForStep(activeGuideStep.type, 35)}
                      </span>
                      <div>
                        <p>{activeGuideStep.departureTime}からのご案内</p>
                        <h2>{activeGuideStep.title}</h2>
                        <p className="guidance-destination">
                          {activeGuideStep.to}へ
                        </p>
                        <p>{activeGuideStep.instruction}</p>
                      </div>
                    </div>
                    <div className="guidance-controls">
                      <button
                        className="secondary-button"
                        disabled={guideStep === 0}
                        onClick={() => {
                          window.speechSynthesis?.cancel();
                          setGuideStep(guideStep - 1);
                        }}
                      >
                        <ArrowLeft size={18} />
                        ひとつ前へ
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => {
                          window.speechSynthesis?.cancel();
                          setGuideStep(guideStep + 1);
                        }}
                      >
                        {guideStep === selectedJourney.steps.length - 1
                          ? "到着を確認する"
                          : "次の手順へ"}
                        <ArrowRight size={19} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="arrival-message">
                    <CheckCircle2 size={53} />
                    <h2>目的地に到着です。</h2>
                    <p>
                      おつかれさまでした。乗り換え案内の体験が完了しました。
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => navigate("trips")}
                    >
                      おでかけ予定へ戻る
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {view === "trips" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">おでかけの準備を、ひとつずつ</div>
                <h1 ref={headingRef} tabIndex={-1}>
                  おでかけ予定
                </h1>
                <p>保存した予定と、乗り換えの案内を確認できます。</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => navigate("search")}
              >
                <Plus size={20} />
                新しく経路をさがす
              </button>
            </div>
            <div className="inline-notice">
              <Info size={20} />
              <p>
                ここに表示される予定は、このブラウザに保存した体験用のものです。バス事業者への予約・連絡は行われません。
              </p>
            </div>
            {trips.length ? (
              <div className="saved-trips">
                {trips.map((trip) => (
                  <article className="card saved-trip" key={trip.id}>
                    <div className="trip-date">
                      <CalendarDays size={23} />
                      <strong>{displayDate(trip.date)}</strong>
                      <span>{trip.journey.departureTime} 出発</span>
                    </div>
                    <div className="trip-description">
                      <span className="soft-badge">体験用・予約未送信</span>
                      <h2>{trip.journey.destination.name}</h2>
                      <p>
                        <Home size={16} />
                        ご自宅から {trip.journey.durationMinutes}分・
                        {trip.journey.arrivalTime} 到着
                      </p>
                      <p>
                        {trip.journey.demandBus
                          ? "デマンドバス ＋ 路線バス"
                          : "徒歩 ＋ 路線バス"}
                      </p>
                    </div>
                    <div className="trip-actions">
                      <button
                        className="primary-button"
                        onClick={() =>
                          openJourney(trip.journey, trip.date, trip.profile)
                        }
                      >
                        乗り換え案内を見る
                        <ChevronRight size={19} />
                      </button>
                      <button
                        className="text-button muted"
                        onClick={() => removeTrip(trip.id)}
                        aria-label={`${trip.journey.destination.name}の予定を削除`}
                      >
                        <Trash2 size={17} />
                        予定を削除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="card empty-state">
                <CalendarDays size={48} />
                <h2>次のおでかけを、さがしてみませんか？</h2>
                <p>
                  経路をさがして予定を保存すると、
                  <br />
                  ここからいつでも案内を確認できます。
                </p>
                <button
                  className="primary-button"
                  onClick={() => navigate("search")}
                >
                  <Search size={20} />
                  経路をさがす
                </button>
              </div>
            )}
          </>
        )}

        {view === "help" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">はじめての方へ</div>
                <h1 ref={headingRef} tabIndex={-1}>
                  おでかけナビの使い方
                </h1>
                <p>むずかしい操作はありません。ひとつずつ進めましょう。</p>
              </div>
              <span className="help-flower">
                <Leaf size={47} />
              </span>
            </div>
            <div className="howto-grid">
              {[
                {
                  icon: <Home size={30} />,
                  title: "ご自宅を登録する",
                  text: "お名前とご自宅の場所を登録します。地図を押すか、地域を選んで設定できます。",
                },
                {
                  icon: <Search size={30} />,
                  title: "行き先と時刻を選ぶ",
                  text: "行きたい場所と、着きたい時刻を選びます。ご自宅からの経路が表示されます。",
                },
                {
                  icon: <Bus size={30} />,
                  title: "申込の流れを体験する",
                  text: "お迎え時刻と経路を確認して、体験用の予定を保存します。実際の予約は送信されません。",
                },
                {
                  icon: <Navigation size={30} />,
                  title: "案内を見ながら進む",
                  text: "「おでかけ予定」から道順を開きます。乗り換えをひとつずつ確認できます。",
                },
              ].map((item, index) => (
                <section className="card howto-card" key={item.title}>
                  <span className="howto-number">0{index + 1}</span>
                  <div className="action-icon">{item.icon}</div>
                  <h2>{item.title}</h2>
                  <p>{item.text}</p>
                </section>
              ))}
            </div>
            <section className="card faq-card">
              <h2>
                <CircleHelp size={24} />
                よくあるご質問
              </h2>
              <details>
                <summary>
                  本当にバスの予約ができますか？
                  <ChevronDown size={19} />
                </summary>
                <p>
                  バスの時刻・運賃・経路はサンプルで、実際の時刻表や予約システムとは連携していません。航空写真は国土地理院の実地図ですが、撮影時点のものであり、現在の道路状況や運行を保証するものではありません。実際のご利用は中津市や交通事業者の公式案内をご確認ください。
                </p>
              </details>
              <details>
                <summary>
                  登録した自宅の情報はどこに保存されますか？
                  <ChevronDown size={19} />
                </summary>
                <p>
                  お名前、ご自宅の場所、おでかけ予定は、このブラウザ内だけに保存し、アプリのサーバーや他の利用者には共有しません。GPSの現在地は履歴として保存せず、停止や画面を離れたときに消します。「現在地を自宅に設定」して登録を確定した場合だけ、その場所をご自宅として保存します。航空写真の表示時には、表示範囲の画像リクエストとIPアドレスが国土地理院へ送信されます。共用端末では利用後に登録情報を削除してください。
                </p>
              </details>
              <details>
                <summary>
                  GPSで現在地が表示されないときは？
                  <ChevronDown size={19} />
                </summary>
                <p>
                  「現在地を表示」を押し、ブラウザで位置情報の利用を許可してください。HTTPSで開いたページと位置情報に対応した端末が必要です。拒否した場合はブラウザのサイト設定から許可を変更できます。屋内や端末の設定によって位置がずれる場合があります。GPSの停止ボタンで取得を止められます。
                </p>
              </details>
              <details>
                <summary>
                  文字を大きくできますか？
                  <ChevronDown size={19} />
                </summary>
                <p>
                  画面右上の「文字サイズ」ボタンで、大きな表示に切り替えられます。お使いのブラウザの拡大機能もご利用いただけます。
                </p>
              </details>
              <details>
                <summary>
                  インターネットがなくても使えますか？
                  <ChevronDown size={19} />
                </summary>
                <p>
                  画面を開いた後のサンプル経路検索と予定の保存は、外部サービスへの接続なしで動作します。航空写真の読み込みにはインターネット接続が必要です。オフラインでの再読み込みや本当の運行情報には対応していません。
                </p>
              </details>
            </section>
            <section className="card privacy-card">
              <div>
                <ShieldCheck size={25} />
                <div>
                  <h2>登録情報の管理</h2>
                  <p>
                    このブラウザに保存した、ご自宅とすべての予定を削除できます。
                  </p>
                </div>
              </div>
              <button
                className="danger-outline"
                onClick={() => {
                  setModalError("");
                  setModal("delete");
                }}
              >
                <Trash2 size={18} />
                登録情報を削除する
              </button>
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <div>
          <span className="footer-brand">
            <Bus size={20} />
            おでかけナビ なかつ
          </span>
          <p>中津でのおでかけを、もっと身近に。</p>
        </div>
        <div>
          <span className="sample-label">DEMO VERSION</span>
          <small>
            このサービスは企画をもとにした体験版です。
            <br />
            実際の運行情報・予約には対応していません。
          </small>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="スマートフォンメニュー">
        <button
          className={
            ["search", "results", "journey"].includes(view) ? "active" : ""
          }
          onClick={() => navigate("search")}
        >
          <Search size={24} />
          経路をさがす
        </button>
        <button
          className={view === "trips" ? "active" : ""}
          onClick={() => navigate("trips")}
        >
          <CalendarDays size={24} />
          おでかけ予定{trips.length > 0 && <span>{trips.length}</span>}
        </button>
        <button
          className={view === "help" ? "active" : ""}
          onClick={() => navigate("help")}
        >
          <CircleHelp size={24} />
          使い方
        </button>
      </nav>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={22} />
          <span>{notice}</span>
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            <X size={18} />
          </button>
        </div>
      )}

      {modal === "profile" && (
        <Modal
          title={profile ? "ご自宅の登録を変更" : "ご自宅を登録しましょう"}
          onClose={() => setModal(null)}
          wide
        >
          <p className="modal-description">
            最初に一度登録すると、いつでもご自宅からさがせます。
            <br />
            体験版では、実際の住所の代わりに近くの地域でもお試しいただけます。
          </p>
          <form onSubmit={registerHome}>
            <div className="input-group">
              <label htmlFor="nickname">
                <UserRound size={18} />
                お名前（ニックネーム）
              </label>
              <input
                autoComplete="nickname"
                id="nickname"
                maxLength={30}
                placeholder="例：なかつさん"
                required
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>
            <fieldset className="home-fieldset">
              <legend>ご自宅のある地域</legend>
              <div className="area-options">
                {HOME_AREAS.map((area) => (
                  <button
                    type="button"
                    aria-pressed={homeDraft.id === area.id}
                    className={homeDraft.id === area.id ? "selected" : ""}
                    key={area.id}
                    onClick={() => {
                      setHomeDraft(area);
                      setHomeLabel(area.label);
                    }}
                  >
                    <MapPin size={17} />
                    {area.label}
                    {homeDraft.id === area.id && <Check size={17} />}
                  </button>
                ))}
              </div>
              <AreaMap
                mode="home"
                selected={homeDraft}
                gps={gps}
                onUseCurrentLocation={(location) => {
                  setHomeDraft({ ...location, id: "gps" });
                  setHomeLabel("現在地から設定したご自宅");
                }}
                onSelect={(location) => {
                  setHomeDraft({ ...location, id: "custom" });
                  if (
                    !homeLabel ||
                    HOME_AREAS.some((area) => area.label === homeLabel)
                  )
                    setHomeLabel("地図で選んだご自宅");
                }}
              />
              <p className="form-hint">
                航空写真を表示してから、ご自宅の位置を押して選べます。キーボードでは矢印キーで地図を動かし、Enter
                キーで中心を設定できます。GPSの現在地も、確認してからご自宅に設定できます。
              </p>
            </fieldset>
            <div className="input-group">
              <label htmlFor="home-label">場所の呼び名（任意）</label>
              <input
                id="home-label"
                maxLength={60}
                placeholder="例：沖代町の自宅"
                value={homeLabel}
                onChange={(event) => setHomeLabel(event.target.value)}
              />
            </div>
            <p className="privacy-note">
              <ShieldCheck size={18} />
              登録情報はこのブラウザだけに保存されます。
            </p>
            {modalError && (
              <p className="error-message" role="alert">
                {modalError}
              </p>
            )}
            <button className="primary-button" type="submit">
              <Check size={21} />
              この内容で登録する
            </button>
          </form>
        </Modal>
      )}
      {modal === "booking" && selectedJourney && journeyProfile && (
        <Modal
          title={
            selectedJourney.demandBus
              ? "お迎えの申込内容を確認"
              : "おでかけ予定を確認"
          }
          onClose={() => setModal(null)}
        >
          <div className="booking-demo">
            <Info size={21} />
            <div>
              <strong>申込の流れを体験しています</strong>
              <p>保存しても、実際の予約は送信されません。</p>
            </div>
          </div>
          <form onSubmit={savePlan}>
            <dl className="booking-summary">
              <div>
                <dt>お名前</dt>
                <dd>{journeyProfile.nickname}さん</dd>
              </div>
              <div>
                <dt>おでかけの日</dt>
                <dd>{displayDate(journeyDate)}</dd>
              </div>
              <div>
                <dt>
                  {selectedJourney.demandBus ? "お迎え時刻" : "ご自宅の出発"}
                </dt>
                <dd>
                  {selectedJourney.steps.find((step) => step.type === "shuttle")
                    ?.departureTime ?? selectedJourney.departureTime}
                  <small>
                    {selectedJourney.demandBus
                      ? "ご自宅近くのお迎え場所（サンプル）"
                      : journeyProfile.home.label}
                  </small>
                </dd>
              </div>
              <div>
                <dt>行き先</dt>
                <dd>
                  {selectedJourney.destination.name}
                  <small>{selectedJourney.arrivalTime} 到着予定</small>
                </dd>
              </div>
              <div>
                <dt>運賃（サンプル）</dt>
                <dd>
                  {selectedJourney.fare.toLocaleString()}円
                  <small>デマンドバスと路線バスの合計例</small>
                </dd>
              </div>
            </dl>
            <label className="confirmation-checkbox">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                体験用の予定として保存し、実際の予約は送信されないことを確認しました。
              </span>
            </label>
            {modalError && (
              <p className="error-message" role="alert">
                {modalError}
              </p>
            )}
            <button
              className="primary-button"
              disabled={!confirmed}
              type="submit"
            >
              <CalendarDays size={21} />
              体験用の予定を保存する
            </button>
            <button
              type="button"
              className="modal-cancel"
              onClick={() => setModal(null)}
            >
              戻って確認する
            </button>
          </form>
        </Modal>
      )}
      {modal === "delete" && (
        <Modal title="登録情報を削除しますか？" onClose={() => setModal(null)}>
          <p className="modal-description">
            このブラウザに保存したお名前、ご自宅の場所、すべてのおでかけ予定を削除します。削除した情報は元に戻せません。
          </p>
          {modalError && (
            <p className="error-message" role="alert">
              {modalError}
            </p>
          )}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              残しておく
            </button>
            <button
              className="danger-button"
              onClick={() => {
                gps.stop();
                if (!clearUserData()) {
                  setModalError(
                    "削除できませんでした。ブラウザの保存設定をご確認ください。",
                  );
                  return;
                }
                setProfile(null);
                setTrips([]);
                setJourneyProfile(null);
                setSelectedJourney(null);
                setNickname("");
                setHomeLabel("");
                setHomeDraft(HOME_AREAS[0]);
                setModal(null);
                setNotice("このブラウザの登録情報を削除しました。");
              }}
            >
              すべて削除する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
