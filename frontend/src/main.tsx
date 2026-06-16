import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Tab = "home" | "learn" | "game" | "stats" | "profile";
type Level = "A1" | "A2" | "B1" | "B2" | "C1";
type Feedback = "success" | "error" | null;
type TrainingMode = "choice" | "match" | null;
type ResultModal = "correct" | "wrong" | null;
type ProfileScreen = "main" | "settings" | "categories" | "premium" | "stats";
type LearnRating = "unknown" | "known";

type Word = {
  id: number;
  english: string;
  russian: string;
  transcription: string;
  example: string;
  category: string;
  level: Level;
};

type TelegramUser = {
  telegram_id: number;
  username?: string | null;
  first_name: string;
  last_name?: string | null;
  language_code?: string | null;
};

type Settings = {
  current_category: string;
  current_level: Level;
  selected_category_ids: string[] | null;
};

type Category = {
  id: string;
  name: string;
  word_count?: number;
  is_premium: boolean;
  is_locked_for_user: boolean;
};

type Subscription = {
  is_premium: boolean;
  plan?: string | null;
  status: string;
  started_at?: string | null;
  expires_at?: string | null;
  source?: string | null;
  limits: {
    learned_words?: {
      used_today: number;
      daily_limit: number | null;
      remaining_today: number | null;
    };
    wordy_games?: {
      used_today: number;
      daily_limit: number | null;
      remaining_today: number | null;
    };
  };
};

type PremiumPlans = {
  monthly: { plan: "monthly"; price_stars: number; currency: "XTR" };
  yearly: { plan: "yearly"; price_stars: number; currency: "XTR" };
  fake_payments_enabled: boolean;
};

type Me = {
  user: TelegramUser;
  settings: Settings;
  subscription: Subscription;
};

type Stats = {
  learned_words_count: number;
  unknown_words_count: number;
  reviewed_words_count: number;
  games_played: number;
  best_score: number;
  correct_answers: number;
  wrong_answers: number;
  average_accuracy: number;
};

type NextWord = {
  word: Word | null;
  learned_count: number;
  available_count: number;
  total_count: number;
  all_learned: boolean;
  message?: string | null;
};

type GameAnswer = {
  word: Word;
  shownTranslation: string;
  isCorrectPair: boolean;
  userWasCorrect: boolean;
};

type GamePrompt = {
  word: Word;
  shownTranslation: string;
  isCorrectPair: boolean;
};

type ChoiceFeedback = {
  option: string;
  correct: boolean;
};

type TelegramHapticFeedback = {
  impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred?: (type: "success" | "warning" | "error") => void;
};

type TelegramWebApp = {
  HapticFeedback?: TelegramHapticFeedback;
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (callback: () => void) => void;
    offClick?: (callback: () => void) => void;
  };
  initData?: string;
  initDataUnsafe?: {
    user?: {
      photo_url?: string;
    };
  };
  openInvoice?: (url: string, callback?: (status: string) => void) => void;
  openTelegramLink?: (url: string) => void;
  ready?: () => void;
  expand?: () => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const API_URL = import.meta.env.VITE_API_URL || "/api";
const TELEGRAM_OPEN_URL = import.meta.env.VITE_TELEGRAM_OPEN_URL || "https://t.me/";
const TELEGRAM_INIT_TIMEOUT_MS = 2500;
const TELEGRAM_INIT_POLL_MS = 100;
const FEEDBACK_SOUND_VOLUME = 0.3;
const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1"];
const LEVEL_LABELS: Record<Level, string> = {
  A1: "Начинающий",
  A2: "Базовый",
  B1: "Средний",
  B2: "Выше среднего",
  C1: "Продвинутый",
};
const ALL_CATEGORIES_LABEL = "Все категории";
const CACHE_KEY = "wordy_profile_cache_v3";
const CHOICE_TRAINING_ROUNDS = 10;
const TRAINING_ENCOURAGEMENTS = ["Отлично!", "Хорошая серия!", "Продолжаем!", "Почти!"];

type MiniIconName =
  | "home"
  | "learn"
  | "profile"
  | "bolt"
  | "fire"
  | "star"
  | "volume"
  | "clock"
  | "check"
  | "x"
  | "chevron"
  | "back"
  | "lock"
  | "gem"
  | "cards"
  | "link"
  | "grid"
  | "chart"
  | "target"
  | "bell"
  | "globe"
  | "brain"
  | "refresh"
  | "trophy";

function MiniIcon({ name }: { name: MiniIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    viewBox: "0 0 24 24",
  } as const;
  const paths: Record<MiniIconName, React.ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9.5 20v-6h5v6" /></>,
    learn: <><path d="M4 5.5A2 2 0 0 1 6 4h5v15H6a2 2 0 0 0-2 1.2z" /><path d="M20 5.5A2 2 0 0 0 18 4h-5v15h5a2 2 0 0 1 2 1.2z" /></>,
    profile: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.6-3.5 3.4-5.5 7-5.5s6.4 2 7 5.5" /></>,
    bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6z" />,
    fire: <path d="M12 3c2 3 1 5-.5 6.5C10 11 9 12.5 9 14a3 3 0 0 0 6 0c0-1-.3-1.8-.7-2.5C16 12.8 17 15 17 16.5A5 5 0 1 1 7 16c0-3 2-4.5 2.5-7C10 6.5 11 5 12 3z" />,
    star: <path d="M12 4l2.4 5 5.6.7-4 3.9 1 5.5L12 16l-5 2.9 1-5.5-4-3.9 5.6-.7z" />,
    volume: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a3 3 0 0 1 0 6" /><path d="M18.5 7a6 6 0 0 1 0 10" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
    check: <path d="M5 12.5 10 17l9-10" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    chevron: <path d="M9 5l7 7-7 7" />,
    back: <path d="M15 5l-7 7 7 7" />,
    lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
    gem: <><path d="M6 4h12l3 5-9 11L3 9z" /><path d="M3 9h18M9 4 7.5 9 12 20 16.5 9 15 4" /></>,
    cards: <><rect x="3.5" y="7" width="13" height="13" rx="2.4" /><path d="M7.5 7V5.5A1.5 1.5 0 0 1 9 4h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 16h-1.5" /></>,
    link: <><path d="M9.5 14.5 14.5 9.5" /><path d="M11 7l1.5-1.5a3.5 3.5 0 0 1 5 5L16 12" /><path d="M13 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L8 12" /></>,
    grid: <><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>,
    chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-3M12 16v-7M16 16v-5" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
    bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2.5H4.5z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></>,
    brain: <><path d="M9.5 4.5A2.5 2.5 0 0 0 7 7a2.5 2.5 0 0 0-1 4.8V14a3 3 0 0 0 3.5 3v2.5" /><path d="M14.5 4.5A2.5 2.5 0 0 1 17 7a2.5 2.5 0 0 1 1 4.8V14a3 3 0 0 1-3.5 3v2.5" /><path d="M9.5 4.5A2 2 0 0 1 12 3a2 2 0 0 1 2.5 1.5" /></>,
    refresh: <><path d="M4 12a8 8 0 0 1 14-5.3L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-14 5.3L4 16" /><path d="M4 20v-4h4" /></>,
    trophy: <><path d="M7 4h10v4a5 5 0 0 1-10 0z" /><path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 3M17 6h2.5a2.5 2.5 0 0 1-2.5 3" /><path d="M12 13v3M9 20h6M10 16h4l.5 4h-5z" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

const NAV_ITEMS: Array<{ id: Tab; label: string; icon: MiniIconName }> = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "learn", label: "Учить", icon: "learn" },
  { id: "game", label: "Wordy", icon: "bolt" },
  { id: "profile", label: "Профиль", icon: "profile" },
];

function getTelegramInitData() {
  return window.Telegram?.WebApp?.initData || "";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForTelegramInitData() {
  const startedAt = Date.now();
  let initialized = false;
  while (Date.now() - startedAt < TELEGRAM_INIT_TIMEOUT_MS) {
    const webApp = window.Telegram?.WebApp;
    if (webApp && !initialized) {
      try {
        document.documentElement.classList.add("telegram-webapp");
        webApp.ready?.();
        webApp.expand?.();
      } catch {
        // Telegram helpers vary by client.
      }
      initialized = true;
    }
    if (webApp?.initData) return webApp.initData;
    await wait(TELEGRAM_INIT_POLL_MS);
  }
  return "";
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const initData = getTelegramInitData();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(initData ? { Authorization: `tma ${initData}` } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function getTelegramHaptics() {
  return window.Telegram?.WebApp?.HapticFeedback;
}

function vibrate(pattern: number | number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function hapticTap() {
  try {
    const haptics = getTelegramHaptics();
    if (haptics?.impactOccurred) {
      haptics.impactOccurred("light");
      return;
    }
  } catch {
    // Optional in Mini App WebViews.
  }
  vibrate(10);
}

function hapticAnswer(correct: boolean) {
  try {
    const haptics = getTelegramHaptics();
    if (haptics?.notificationOccurred) {
      haptics.notificationOccurred(correct ? "success" : "error");
      return;
    }
  } catch {
    // Optional in Mini App WebViews.
  }
  vibrate(correct ? 30 : [40, 30, 40]);
}

function playAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = FEEDBACK_SOUND_VOLUME;
    void audio.play().catch(() => {});
  } catch {
    // Audio feedback is optional.
  }
}

function useAnswerFeedback() {
  const correctAudio = useRef<HTMLAudioElement | null>(null);
  const wrongAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    correctAudio.current = new Audio("/sounds/correct.mp3");
    wrongAudio.current = new Audio("/sounds/wrong.mp3");
    [correctAudio.current, wrongAudio.current].forEach((audio) => {
      audio.preload = "auto";
      audio.volume = FEEDBACK_SOUND_VOLUME;
      audio.load();
    });
  }, []);
  return (correct: boolean) => {
    playAudio(correct ? correctAudio.current : wrongAudio.current);
    hapticAnswer(correct);
  };
}

function pronounce(text: string, onStart?: () => void, onEnd?: () => void) {
  if (!("speechSynthesis" in window)) {
    globalThis.alert("Озвучка недоступна в этом браузере.");
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en-gb")) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en-us")) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
    null;
  utterance.lang = utterance.voice?.lang || "en-US";
  utterance.rate = 0.9;
  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

function selectedCategoryIds(settings: Settings): string[] | null {
  if (settings.selected_category_ids !== undefined && settings.selected_category_ids !== null) {
    return settings.selected_category_ids;
  }
  if (!settings.current_category) return null;
  if (settings.current_category === ALL_CATEGORIES_LABEL) return [];
  if (settings.current_category === "Несколько категорий") return [];
  return [settings.current_category];
}

function categorySummary(settings: Settings) {
  const categories = selectedCategoryIds(settings);
  return categorySummaryFromIds(categories);
}

function categorySummaryFromIds(categories: string[] | null) {
  if (categories === null) return "Не выбраны";
  if (categories.length === 0) return ALL_CATEGORIES_LABEL;
  if (categories.length === 1) return categories[0];
  return `${categories.length} категории`;
}

function categoryIcon(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes("it") || normalized.includes("технолог")) return "💻";
  if (normalized.includes("travel") || normalized.includes("путеше")) return "✈️";
  if (normalized.includes("communication") || normalized.includes("общен")) return "💬";
  if (normalized.includes("business") || normalized.includes("бизнес")) return "💼";
  if (normalized.includes("food") || normalized.includes("еда")) return "🍽️";
  if (normalized.includes("спорт") || normalized.includes("здоров")) return "💪";
  if (normalized.includes("чувств") || normalized.includes("психолог")) return "🧠";
  return "✨";
}

function profileCategories(settings: Settings) {
  const selected = selectedCategoryIds(settings);
  if (selected === null) return [];
  if (selected.length === 0) return [ALL_CATEGORIES_LABEL];
  return selected;
}

function profileInitials(user?: TelegramUser) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  if (!name) return "W";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function telegramAvatarUrl() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user?.photo_url || "";
}

function freeSubscription(): Subscription {
  return {
    is_premium: false,
    plan: null,
    status: "free",
    started_at: null,
    expires_at: null,
    source: null,
    limits: {},
  };
}

function planLabel(plan?: string | null) {
  if (plan === "monthly") return "Premium на месяц";
  if (plan === "yearly") return "Premium на год";
  if (plan === "custom" || plan === "admin_custom") return "Premium выдан администратором";
  return "Premium";
}

function planTariffLabel(plan?: string | null) {
  if (plan === "monthly") return "Месячный";
  if (plan === "yearly") return "Годовой";
  if (plan === "custom" || plan === "admin_custom") return "Premium выдан администратором";
  return "Premium";
}

function isAdminPremiumPlan(plan?: string | null) {
  return plan === "custom" || plan === "admin_custom";
}

function toggleCategorySelection(selected: string[], category: string) {
  return selected.includes(category)
    ? selected.filter((item) => item !== category)
    : [...selected, category];
}

function useTelegramBackButton(active: boolean, onBack: () => void) {
  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!active || !backButton) return;
    backButton.show?.();
    backButton.onClick?.(onBack);
    return () => {
      backButton.offClick?.(onBack);
      backButton.hide?.();
    };
  }, [active, onBack]);
}

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [learnMode, setLearnMode] = useState<"menu" | "cards">("menu");
  const [categories, setCategories] = useState<Category[]>([]);
  const [me, setMe] = useState<Me | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as Me | null;
    } catch {
      return null;
    }
  });
  const [statsRefresh, setStatsRefresh] = useState(0);
  const [error, setError] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const [gameResetNonce, setGameResetNonce] = useState(0);
  const [premiumCleanupNotice, setPremiumCleanupNotice] = useState("");
  const [trainingFullscreen, setTrainingFullscreen] = useState(false);
  const [profileFullscreen, setProfileFullscreen] = useState(false);

  const settings = me?.settings || { current_category: "", current_level: "A1" as Level, selected_category_ids: null };
  const subscription = me?.subscription || freeSubscription();
  const needsSetup = profileLoaded && (!settings.current_level || selectedCategoryIds(settings) === null);
  const isLearnSession = tab === "learn" && learnMode === "cards";
  const isGameSession = tab === "game";
  const isTrainingSession = tab === "learn" && learnMode === "menu" && trainingFullscreen;
  const isProfileNestedScreen = tab === "profile" && profileFullscreen;
  const isFullscreenSession = isLearnSession || isTrainingSession || isGameSession || isProfileNestedScreen;
  const shellClassName = [
    "app-shell",
    isLearnSession ? "learn-shell" : "",
    isFullscreenSession ? "fullscreen-shell" : "root-tab-shell",
  ].filter(Boolean).join(" ");

  function refreshMe() {
    return api<Me>("/me").then((profile) => {
      localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
      setMe((current) => {
        if (current?.subscription.is_premium && !profile.subscription.is_premium) {
          setPremiumCleanupNotice("Платные категории отключены. Выберите доступные категории или оформите Premium.");
        }
        return profile;
      });
      setProfileLoaded(true);
      return profile;
    });
  }

  async function updateSettings(next: Partial<Settings>) {
    const saved = await api<Settings>("/me/settings", {
      method: "PATCH",
      body: JSON.stringify(next),
    });
    setMe((current) => {
      if (!current) return current;
      const updated = { ...current, settings: saved };
      localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  async function refreshSubscription() {
    const profile = await refreshMe();
    api<Category[]>("/categories").then(setCategories).catch(() => {});
    return profile.subscription;
  }

  function requestTab(nextTab: Tab) {
    if (nextTab === tab) return;
    if (gameActive) {
      setPendingTab(nextTab);
      return;
    }
    setTrainingFullscreen(false);
    setProfileFullscreen(false);
    setTab(nextTab);
  }

  function exitActiveGame() {
    setGameResetNonce((value) => value + 1);
    setGameActive(false);
    setTab(pendingTab || "learn");
    setPendingTab(null);
  }

  function handleSessionBack() {
    if (isLearnSession) {
      setLearnMode("menu");
      return;
    }
    if (isTrainingSession) return;
    if (isProfileNestedScreen) return;
    if (isGameSession) {
      if (gameActive) {
        setPendingTab("learn");
        return;
      }
      setTab("learn");
    }
  }

  useEffect(() => {
    refreshMe().catch(() => {
      setProfileLoaded(true);
      setError("Не удалось загрузить профиль Telegram.");
    });
    api<Category[]>("/categories")
      .then(setCategories)
      .catch(() => setError("Не удалось загрузить категории. Обновите страницу чуть позже."));
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!gameActive) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [gameActive]);

  useEffect(() => {
    const onPopState = () => {
      if (!gameActive) return;
      setPendingTab("learn");
      window.history.pushState({ appTab: tab }, "");
    };
    window.history.replaceState({ appTab: tab }, "");
    window.history.pushState({ appTab: tab }, "");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [gameActive, tab]);

  useTelegramBackButton(isLearnSession || isGameSession, handleSessionBack);

  if (needsSetup) {
    return (
      <div className="app-shell setup-shell">
        {error && <div className="notice">{error}</div>}
        <SetupFlowScreen
          categories={categories}
          subscription={subscription}
          onSubscriptionChanged={refreshSubscription}
          onSave={updateSettings}
        />
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Словарь на каждый день</p>
          <h1>Wordy</h1>
        </div>
        <div className="daily-chip">{settings.current_level}</div>
      </header>

      {error && <div className="notice">{error}</div>}
      {premiumCleanupNotice && <div className="notice">{premiumCleanupNotice}</div>}

      <div className="screen" key={tab}>
        {tab === "home" && (
          <HomeView
            user={me?.user}
            settings={settings}
            subscription={subscription}
            statsRefresh={statsRefresh}
            onGoLearn={() => {
              setLearnMode("cards");
              setTab("learn");
            }}
            onGoPremium={() => setTab("profile")}
          />
        )}
        {tab === "learn" && learnMode === "cards" && (
          <LearnView
            settings={settings}
            subscription={subscription}
            onNeedProfile={() => setTab("profile")}
            onUpgrade={() => setTab("profile")}
            onStatsChanged={() => setStatsRefresh((value) => value + 1)}
            onSubscriptionChanged={refreshSubscription}
          />
        )}
        {tab === "learn" && learnMode === "menu" && (
          <TrainingView
            settings={settings}
            onNeedProfile={() => setTab("profile")}
            onGoLearn={() => setLearnMode("cards")}
            onFullscreenChange={setTrainingFullscreen}
          />
        )}
        {tab === "game" && (
          <GameView
            settings={settings}
            subscription={subscription}
            resetSignal={gameResetNonce}
            paused={pendingTab !== null}
            onActiveChange={setGameActive}
            onNeedProfile={() => setTab("profile")}
            onUpgrade={() => setTab("profile")}
            onStatsChanged={() => setStatsRefresh((value) => value + 1)}
            onSubscriptionChanged={refreshSubscription}
          />
        )}
        {tab === "stats" && <StatsView refreshKey={statsRefresh} subscription={subscription} />}
        {tab === "profile" && (
          <ProfileView
            user={me?.user}
            settings={settings}
            categories={categories}
            subscription={subscription}
            onSubscriptionChanged={refreshSubscription}
            onSave={updateSettings}
            onFullscreenChange={setProfileFullscreen}
          />
        )}
      </div>

      {!isFullscreenSession && (
        <nav className="bottom-nav" aria-label="Основная навигация">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => {
                hapticTap();
                if (item.id === "learn") setLearnMode("menu");
                requestTab(item.id);
              }}
            >
              <span><MiniIcon name={item.icon} /></span>
              {item.label}
            </button>
          ))}
        </nav>
      )}
      <ConfirmExitGameModal open={pendingTab !== null} onExit={exitActiveGame} onStay={() => setPendingTab(null)} />
    </div>
  );
}

function useWords(settings: Settings, includeLearned = true) {
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (selectedCategoryIds(settings) === null) {
      setWords([]);
      setMessage("Выберите категории в профиле.");
      return;
    }
    const params = new URLSearchParams({
      level: settings.current_level,
      limit: "1000",
      include_learned: String(includeLearned),
    });
    setLoading(true);
    setMessage("");
    api<Word[]>(`/words?${params.toString()}`)
      .then((items) => {
        setWords(shuffle(items));
        setMessage(items.length ? "" : "В этой категории и уровне пока нет слов.");
      })
      .catch(() => setMessage("Не удалось загрузить слова. Проверьте соединение."))
      .finally(() => setLoading(false));
  }, [settings.selected_category_ids, settings.current_category, settings.current_level, includeLearned]);

  return { words, loading, message };
}

function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress-wrap">
      {label && (
        <div className="progress-row">
          <span>{label}</span>
          <strong>{value}%</strong>
        </div>
      )}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function HomeView({
  user,
  settings,
  subscription,
  statsRefresh,
  onGoLearn,
  onGoPremium,
}: {
  user?: TelegramUser;
  settings: Settings;
  subscription: Subscription;
  statsRefresh: number;
  onGoLearn: () => void;
  onGoPremium: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    api<Stats>("/stats/me").then(setStats).catch(() => setStats(null));
  }, [statsRefresh]);
  const name = user?.first_name || "Wordy";
  const usedToday = subscription.limits.learned_words?.used_today || 0;
  const dailyLimit = subscription.limits.learned_words?.daily_limit ?? (subscription.is_premium ? null : 20);
  const goalTotal = dailyLimit || 10;
  const goalDone = dailyLimit ? Math.min(usedToday, dailyLimit) : Math.min(stats?.learned_words_count || 0, 10);
  const goalPct = Math.min(100, Math.round((goalDone / goalTotal) * 100));
  const learned = stats?.learned_words_count || 0;
  const bestScore = stats?.best_score || 0;

  return (
    <main className="home-screen">
      <section className="apphead">
        <div>
          <div className="eyebrow">Bilan davom etamiz</div>
          <h1>Главная</h1>
        </div>
        {subscription.is_premium ? (
          <span className="badge gold"><MiniIcon name="gem" />PRO</span>
        ) : (
          <div className="lvl">{settings.current_level}</div>
        )}
      </section>

      <section className="card hero mb12">
        <div className="row home-metrics-row">
          <div className="statbar">
            <span className="metric-icon gold"><MiniIcon name="fire" /></span>
            <div>
              <div className="kbd-w home-number">{bestScore || 0}</div>
              <div className="muted3 home-caption">рекорд Wordy</div>
            </div>
          </div>
          <div className="home-sep" />
          <div className="statbar">
            <span className="metric-icon lime"><MiniIcon name="star" /></span>
            <div>
              <div className="kbd-w home-number">{learned}</div>
              <div className="muted3 home-caption">слов изучено</div>
            </div>
          </div>
          <span className={`badge ${subscription.is_premium ? "lime" : "neutral"}`}>
            {subscription.is_premium ? "∞ лимит" : `${learned} слов`}
          </span>
        </div>
      </section>

      <section className="card goal-card">
        <div className="row">
          <span className="ey">Цель на сегодня</span>
          <span className="badge blue">{goalDone}/{goalTotal} слов</span>
        </div>
        <div className="row goal-body">
          <Ring pct={goalPct} />
          <div>
            <div className="kbd-w goal-title">{goalDone === 0 ? `Salom, ${name}!` : "Так держать!"}</div>
            <div className="muted goal-copy">{goalDone === 0 ? "Выучи 10 слов за несколько минут" : `Осталось ${Math.max(0, goalTotal - goalDone)} — это пара минут`}</div>
          </div>
        </div>
      </section>

      <section className="card flat continue-card">
        <div className="row">
          <div>
            <div className="ey">Продолжить</div>
            <div className="h-card">{categorySummary(settings)}</div>
          </div>
          <span className="badge neutral">{settings.current_level}</span>
        </div>
        <div className="row progress-mini">
          <span className="muted">Пройдено {learned} слов</span>
          <span className="lime-text">{goalPct}%</span>
        </div>
        <ProgressBar value={goalPct} />
        <button className="btn btn-primary full sm" onClick={onGoLearn}>Продолжить урок</button>
      </section>

      <section className="card hero word-day-card">
        <div className="row">
          <span className="badge lime">So'z kuni · Слово дня</span>
          <button className="speak sm" aria-label="Произнести слово" onClick={() => pronounce("resilient")}><MiniIcon name="volume" /></button>
        </div>
        <div className="kbd-w word-day">resilient</div>
        <div className="muted word-day-ipa">/rɪˈzɪlɪənt/ · adjective</div>
        <div className="word-day-translation">устойчивый · bardoshli</div>
      </section>

      {!subscription.is_premium && (
        <section className="card card-prem-upsell">
          <div className="row">
            <span className="badge gold"><MiniIcon name="gem" />Premium</span>
            <span className="muted3 upsell-price">Telegram Stars</span>
          </div>
          <div className="h-card upsell-title">Безлимит и все категории</div>
          <p className="muted upsell-copy">Снимаем дневной лимит, открываем все темы и игры.</p>
          <button className="btn btn-gold full sm" onClick={onGoPremium}>Попробовать Premium</button>
        </section>
      )}
    </main>
  );
}

function Ring({ pct }: { pct: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="goal-ring">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--line-2)" strokeWidth="7" />
      <circle cx="32" cy="32" r={radius} fill="none" stroke="#C8F94D" strokeWidth="7" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 32 32)" />
      <text x="32" y="37" textAnchor="middle" fontFamily="Unbounded" fontWeight="800" fontSize="15" fill="var(--txt)">{pct}%</text>
    </svg>
  );
}

function LearningFlashcard({
  word,
  feedback,
  loading,
  message,
  revealed,
  onReveal,
}: {
  word?: Word | null;
  feedback?: Feedback;
  loading?: boolean;
  message?: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  if (loading) {
    return (
      <div className="learning-card-shell empty">
        <div className="loader" />
        <span>Загружаем слова...</span>
      </div>
    );
  }
  if (!word) return <div className="learning-card-shell empty">{message || "Для выбранных настроек пока нет слов."}</div>;
  return (
    <section className={`learning-card-shell ${feedback ? `is-${feedback}` : ""}`}>
      <button
        className={`learning-flip-card ${revealed ? "revealed" : ""}`}
        onClick={() => {
          if (!revealed) {
            hapticTap();
            onReveal();
          }
        }}
        aria-label={revealed ? "Карточка раскрыта" : "Показать перевод"}
      >
        <span className="learning-card-face front">
          <span className="learning-card-kicker">{word.category} · {word.level}</span>
          <strong>{word.english}</strong>
          <span className="learning-card-hint">Нажмите, чтобы проверить себя</span>
        </span>
        <span className="learning-card-face back">
          <span className="learning-card-kicker">{word.transcription || "Перевод"}</span>
          <strong>{word.russian}</strong>
          {word.example && <span className="learning-example">{word.example}</span>}
        </span>
      </button>
      <button
        className={`learning-speaker ${speaking ? "speaking" : ""}`}
        onClick={() => pronounce(word.english, () => setSpeaking(true), () => setSpeaking(false))}
        aria-label="Произнести слово"
      >
        <MiniIcon name="volume" />
      </button>
    </section>
  );
}

function LearnView({
  settings,
  subscription,
  onNeedProfile,
  onUpgrade,
  onStatsChanged,
  onSubscriptionChanged,
}: {
  settings: Settings;
  subscription: Subscription;
  onNeedProfile: () => void;
  onUpgrade: () => void;
  onStatsChanged: () => void;
  onSubscriptionChanged: () => Promise<Subscription>;
}) {
  const [next, setNext] = useState<NextWord | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reviewLearned, setReviewLearned] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [cardExiting, setCardExiting] = useState(false);

  function loadNext(review = reviewLearned) {
    if (selectedCategoryIds(settings) === null) return;
    setLoading(true);
    api<NextWord>(`/words/next${review ? "?review_learned=true" : ""}`)
      .then(setNext)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setReviewLearned(false);
    setNext(null);
    setLimitReached(false);
    setRevealed(false);
    setCardExiting(false);
    loadNext(false);
  }, [settings.selected_category_ids, settings.current_category, settings.current_level]);

  useEffect(() => {
    setRevealed(false);
    setCardExiting(false);
  }, [next?.word?.id]);

  async function rateWord(rating: LearnRating) {
    const word = next?.word;
    if (!word) return;
    const known = rating === "known";
    setFeedback(known ? "success" : "error");
    setCardExiting(true);
    hapticTap();
    try {
      await api(`/words/${word.id}/${known ? "learned" : "unknown"}`, { method: "POST" });
      onStatsChanged();
      void onSubscriptionChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("daily_learned_words_limit_reached")) {
        setFeedback(null);
        setCardExiting(false);
        setLimitReached(true);
        void onSubscriptionChanged();
        return;
      }
      throw error;
    }
    window.setTimeout(() => {
      setFeedback(null);
      setRevealed(false);
      loadNext();
    }, 220);
  }

  const learned = next?.learned_count || 0;
  const total = next?.total_count || 0;
  const progress = total ? Math.round((learned / total) * 100) : 0;

  if (selectedCategoryIds(settings) === null) {
    return (
      <main>
        <section className="hero-panel">
          <div>
            <p>Режим изучения</p>
            <h2>Сначала выберите категории</h2>
          </div>
        </section>
        <section className="word-card empty">Категории хранятся в профиле и применяются ко всем режимам.</section>
        <button className="wide primary-action" onClick={onNeedProfile}>Перейти в профиль</button>
      </main>
    );
  }

  if (limitReached) {
    return <LimitReachedView onUpgrade={onUpgrade} />;
  }

  return (
    <main className="learn-screen">
      <section className="learn-top-card">
        <div>
          <p className="eyebrow">Учить</p>
          <h2>{categorySummary(settings)}</h2>
          <span>{settings.current_level} · вспоминайте перевод до раскрытия</span>
        </div>
        <div className="hero-number">{settings.current_level}</div>
      </section>
      <section className="learn-progress-card">
        <div className="progress-row">
          <span>Сегодня</span>
          <strong>
            {subscription.limits.learned_words?.used_today || 0}
            {" / "}
            {subscription.limits.learned_words?.daily_limit ?? "∞"}
          </strong>
        </div>
        <ProgressBar
          value={subscription.limits.learned_words?.daily_limit ? Math.min(100, Math.round(((subscription.limits.learned_words?.used_today || 0) / subscription.limits.learned_words.daily_limit) * 100)) : progress}
        />
      </section>
      {!subscription.is_premium && subscription.limits.learned_words?.daily_limit !== null && (
        <p className="limit-copy">Бесплатно сегодня: {subscription.limits.learned_words?.used_today || 0}/{subscription.limits.learned_words?.daily_limit || 20} слов</p>
      )}
      <LearningFlashcard
        word={next?.word}
        feedback={cardExiting ? feedback : null}
        loading={loading}
        message={next?.message || undefined}
        revealed={revealed}
        onReveal={() => setRevealed(true)}
      />
      {next?.all_learned ? (
        <div className="actions">
          <button
            className="primary-action"
            onClick={() => {
              hapticTap();
              setReviewLearned(true);
              loadNext(true);
            }}
          >
            Повторить изученные слова
          </button>
          <button className="quiet-action" onClick={onNeedProfile}>Изменить категорию</button>
        </div>
      ) : (
        <div className={`learn-rating-actions ${revealed ? "visible" : ""}`}>
          <button className="rating-button unknown" disabled={!next?.word || !revealed || cardExiting} onClick={() => rateWord("unknown")}>
            <span>❌</span>
            Не знаю
          </button>
          <button className="rating-button known" disabled={!next?.word || !revealed || cardExiting} onClick={() => rateWord("known")}>
            <span>✅</span>
            Знаю
          </button>
        </div>
      )}
    </main>
  );
}

function TrainingView({
  settings,
  onNeedProfile,
  onGoLearn,
  onFullscreenChange,
}: {
  settings: Settings;
  onNeedProfile: () => void;
  onGoLearn: () => void;
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  const [mode, setMode] = useState<TrainingMode>(null);
  const { words, loading, message } = useWords(settings);

  useEffect(() => {
    onFullscreenChange(mode !== null);
    return () => onFullscreenChange(false);
  }, [mode, onFullscreenChange]);

  useTelegramBackButton(mode !== null, () => setMode(null));

  if (selectedCategoryIds(settings) === null) {
    return <EmptySettings title="Тренировка" onNeedProfile={onNeedProfile} />;
  }
  if (mode === "choice") return <TranslationChoice words={words} loading={loading} message={message} onBack={() => setMode(null)} onGoLearn={onGoLearn} />;
  if (mode === "match") return <MatchWords words={words} loading={loading} message={message} onBack={() => setMode(null)} />;

  return (
    <main className="training-screen">
      <section className="apphead">
        <div>
          <div className="eyebrow">Mashqlar · Режимы</div>
          <h1>Учить</h1>
        </div>
      </section>
      <p className="muted learn-intro">Выбери, как сегодня закрепляем слова.</p>
      <section className="training-mode-grid">
        <button className="training-mode-card blue" onClick={onGoLearn}>
          <span className="training-card-icon"><MiniIcon name="cards" /></span>
          <div>
            <strong>Новые слова</strong>
            <p>Карточки: смотри слово, проверяй себя, оценивай.</p>
          </div>
          <div className="training-card-meta">
            <span><MiniIcon name="clock" />3 мин</span>
            <span>{settings.current_level}</span>
          </div>
        </button>
        <button className="training-mode-card blue" disabled={loading || words.length < 4} onClick={() => setMode("choice")}>
          <span className="training-card-icon lime"><MiniIcon name="check" /></span>
          <div>
            <strong>Выбери перевод</strong>
            <p>Проверьте, насколько хорошо помните слова.</p>
          </div>
          <div className="training-card-meta">
            <span><MiniIcon name="clock" />2 мин</span>
            <span>Легко</span>
          </div>
        </button>
        <button className="training-mode-card green" disabled={loading || words.length < 4} onClick={() => setMode("match")}>
          <span className="training-card-icon green"><MiniIcon name="link" /></span>
          <div>
            <strong>Соедини пары</strong>
            <p>Найдите правильные пары слов и переводов.</p>
          </div>
          <div className="training-card-meta">
            <span><MiniIcon name="clock" />2 мин</span>
            <span>Средне</span>
          </div>
        </button>
        <button className="training-mode-card locked" disabled>
          <span className="training-card-icon gold"><MiniIcon name="brain" /></span>
          <div>
            <strong>Сложные слова</strong>
            <p>Только то, что даётся тебе труднее всего.</p>
          </div>
          <div className="training-card-meta">
            <span><MiniIcon name="clock" />4 мин</span>
            <span><MiniIcon name="lock" />Premium</span>
          </div>
        </button>
      </section>
      {message && <p className="comfort-copy">{message}</p>}
    </main>
  );
}

function TranslationChoice({ words, loading, message, onBack, onGoLearn }: { words: Word[]; loading: boolean; message: string; onBack: () => void; onGoLearn: () => void }) {
  const [deck, setDeck] = useState<Word[]>([]);
  const [round, setRound] = useState(0);
  const [feedback, setFeedback] = useState<ChoiceFeedback | null>(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [xp, setXp] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const advanceTimeout = useRef<number | null>(null);
  const playFeedback = useAnswerFeedback();
  const totalRounds = CHOICE_TRAINING_ROUNDS;

  function clearAdvanceTimeout() {
    if (advanceTimeout.current === null) return;
    window.clearTimeout(advanceTimeout.current);
    advanceTimeout.current = null;
  }

  useEffect(() => {
    clearAdvanceTimeout();
    setDeck(shuffle(words));
    setRound(0);
    setFeedback(null);
    setCorrect(0);
    setWrong(0);
    setStreak(0);
    setBestStreak(0);
    setXp(0);
  }, [words]);

  useEffect(() => clearAdvanceTimeout, []);

  const question = useMemo(() => {
    if (deck.length < 4 || round >= totalRounds) return null;
    const word = deck[round % deck.length];
    const options = shuffle([word.russian, ...shuffle(words.filter((item) => item.id !== word.id)).slice(0, 3).map((item) => item.russian)]);
    return { word, options };
  }, [deck, round, totalRounds, words]);
  const accuracy = correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0;
  const complete = deck.length >= 4 && round >= totalRounds;
  const encouragement = TRAINING_ENCOURAGEMENTS[Math.min(streak, TRAINING_ENCOURAGEMENTS.length - 1)];

  function choose(option: string) {
    if (!question || feedback) return;
    const isCorrect = option === question.word.russian;
    setFeedback({ option, correct: isCorrect });
    setCorrect((value) => value + (isCorrect ? 1 : 0));
    setWrong((value) => value + (isCorrect ? 0 : 1));
    if (isCorrect) {
      setStreak((value) => {
        const next = value + 1;
        setBestStreak((best) => Math.max(best, next));
        return next;
      });
      setXp((value) => value + 10);
    } else {
      setStreak(0);
    }
    playFeedback(isCorrect);
    clearAdvanceTimeout();
    advanceTimeout.current = window.setTimeout(() => {
      setFeedback(null);
      setRound((value) => value + 1);
      advanceTimeout.current = null;
    }, isCorrect ? 600 : 800);
  }

  function restart() {
    hapticTap();
    clearAdvanceTimeout();
    setDeck(shuffle(words));
    setRound(0);
    setFeedback(null);
    setCorrect(0);
    setWrong(0);
    setStreak(0);
    setBestStreak(0);
    setXp(0);
  }

  if (!question) {
    if (complete) {
      return (
        <main className="training-screen">
          <button className="quiet-action back-button" onClick={onBack}>Назад</button>
          <section className="training-result-card">
            <p>Урок завершен</p>
            <h2>{accuracy}% точность</h2>
            <div className="training-result-grid">
              <MetricCard label="Верно" value={correct} tone="green" />
              <MetricCard label="Ошибки" value={wrong} tone="orange" />
              <MetricCard label="Лучшая серия" value={bestStreak} tone="blue" />
            </div>
            <div className="training-result-xp">+{xp} XP за сессию</div>
            <div className="actions two">
              <button className="primary-action" onClick={restart}>Ещё раз</button>
              <button className="soft-action" onClick={onGoLearn}>К словам</button>
            </div>
          </section>
        </main>
      );
    }
    return <TrainingEmpty loading={loading} message={message || "Для тренировки нужно минимум четыре слова."} onBack={onBack} />;
  }

  return (
    <main className="training-screen">
      <button className="quiet-action back-button" onClick={onBack}>Назад</button>
      {feedback?.correct && <div className="choice-feedback-toast">Верно · +10 XP</div>}
      <section className="training-play-header">
        <div>
          <p>Выбери перевод</p>
          <h2>{round + 1} из {totalRounds}</h2>
        </div>
        <span>🔥 Серия: {streak}</span>
        <span>+{xp} XP</span>
        <div className="training-progress" aria-hidden="true">
          <i style={{ width: `${((round + (feedback ? 1 : 0)) / totalRounds) * 100}%` }} />
        </div>
      </section>
      <section className="choice-card training-word-card">
        <p>{feedback ? encouragement : "Как переводится слово?"}</p>
        <div className="training-word-row">
          <h2>{question.word.english}</h2>
          <button className={`speaker-button ${speaking ? "speaking" : ""}`} onClick={() => pronounce(question.word.english, () => setSpeaking(true), () => setSpeaking(false))} aria-label="Произнести слово">
            <MiniIcon name="volume" />
          </button>
        </div>
        {question.word.transcription && <span>{question.word.transcription}</span>}
      </section>
      <div className="choice-options">
        {question.options.map((option, index) => {
          const isCorrect = option === question.word.russian;
          const isSelected = feedback?.option === option;
          return (
            <button
              key={option}
              className={`choice-option ${isSelected && isCorrect ? "correct" : ""} ${isSelected && !isCorrect ? "wrong" : ""}`}
              disabled={Boolean(feedback)}
              onClick={() => choose(option)}
            >
              <span className="choice-key">{String.fromCharCode(65 + index)}</span>
              {option}
              {feedback && isCorrect && <span className="choice-mark" style={{color:"var(--green)"}}><MiniIcon name="check" /></span>}
              {feedback && isSelected && !isCorrect && <span className="choice-mark" style={{color:"var(--red)"}}><MiniIcon name="x" /></span>}
            </button>
          );
        })}
      </div>
    </main>
  );
}

function MatchWords({ words, loading, message, onBack }: { words: Word[]; loading: boolean; message: string; onBack: () => void }) {
  const [round, setRound] = useState(0);
  const [leftSelected, setLeftSelected] = useState<number | null>(null);
  const [matchedIds, setMatchedIds] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [streak, setStreak] = useState(0);
  const [xp, setXp] = useState(0);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const [leftShakeId, setLeftShakeId] = useState<number | null>(null);
  const playFeedback = useAnswerFeedback();
  const pairs = useMemo(() => (words.length < 4 ? [] : shuffle(words).slice(0, 4)), [round, words]);
  const translations = useMemo(() => shuffle(pairs), [pairs]);
  const complete = pairs.length > 0 && matchedIds.length === pairs.length;
  const accuracy = matchedIds.length + mistakes ? Math.round((matchedIds.length / (matchedIds.length + mistakes)) * 100) : 100;

  useEffect(() => {
    setLeftSelected(null);
    setMatchedIds([]);
    setMistakes(0);
    setStreak(0);
    setXp(0);
  }, [pairs]);

  function pickTranslation(wordId: number) {
    if (leftSelected === null || matchedIds.includes(wordId)) return;
    if (leftSelected === wordId) {
      setMatchedIds((items) => [...items, wordId]);
      setStreak((value) => value + 1);
      setXp((value) => value + 10);
      playFeedback(true);
    } else {
      setMistakes((value) => value + 1);
      setStreak(0);
      setShakeId(wordId);
      setLeftShakeId(leftSelected);
      playFeedback(false);
      window.setTimeout(() => {
        setShakeId(null);
        setLeftShakeId(null);
      }, 260);
    }
    setLeftSelected(null);
  }

  if (pairs.length < 4) return <TrainingEmpty loading={loading} message={message || "Для раунда нужно минимум четыре слова."} onBack={onBack} />;

  return (
    <main className="training-screen">
      <button className="quiet-action back-button" onClick={onBack}>Назад</button>
      <section className="training-play-header match">
        <div>
          <p>Соедини пары</p>
          <h2>{matchedIds.length} / {pairs.length} пары</h2>
        </div>
        <span>🔥 Серия: {streak}</span>
        <span>Ошибки: {mistakes}</span>
        <div className="training-progress" aria-hidden="true">
          <i style={{ width: `${(matchedIds.length / pairs.length) * 100}%` }} />
        </div>
      </section>
      <p className="match-helper">{complete ? "Раунд готов!" : leftSelected ? "Теперь выберите перевод справа." : "Выберите слово слева."}</p>
      <div className="match-board">
        <div className="match-column">
          {pairs.map((word) => (
            <button
              key={word.id}
              className={`match-tile english ${leftSelected === word.id ? "selected" : ""} ${matchedIds.includes(word.id) ? "locked" : ""} ${leftShakeId === word.id ? "wrong-shake" : ""}`}
              disabled={matchedIds.includes(word.id)}
              onClick={() => {
                hapticTap();
                setLeftSelected(word.id);
              }}
            >
              {word.english}
            </button>
          ))}
        </div>
        <div className="match-column">
          {translations.map((word) => (
            <button
              key={word.id}
              className={`match-tile ${matchedIds.includes(word.id) ? "locked" : ""} ${shakeId === word.id ? "wrong-shake" : ""}`}
              disabled={matchedIds.includes(word.id)}
              onClick={() => pickTranslation(word.id)}
            >
              {word.russian}
            </button>
          ))}
        </div>
      </div>
      {xp > 0 && <div className="match-xp-pop">+{xp} XP</div>}
      {complete && (
        <section className="mini-result training-mini-result">
          <MetricCard label="Собрано пар" value={matchedIds.length} tone="green" />
          <MetricCard label="Ошибки" value={mistakes} tone="orange" />
          <MetricCard label="Точность" value={`${accuracy}%`} tone="blue" />
          <button
            className="wide primary-action"
            onClick={() => {
              hapticTap();
              setRound((value) => value + 1);
            }}
          >
            Следующий раунд
          </button>
          <button className="wide soft-action" onClick={onBack}>Назад</button>
        </section>
      )}
    </main>
  );
}

function GameView({
  settings,
  subscription,
  resetSignal,
  paused,
  onActiveChange,
  onNeedProfile,
  onUpgrade,
  onStatsChanged,
  onSubscriptionChanged,
}: {
  settings: Settings;
  subscription: Subscription;
  resetSignal: number;
  paused: boolean;
  onActiveChange: (active: boolean) => void;
  onNeedProfile: () => void;
  onUpgrade: () => void;
  onStatsChanged: () => void;
  onSubscriptionChanged: () => Promise<Subscription>;
}) {
  const { words, loading, message } = useWords(settings);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [answers, setAnswers] = useState<GameAnswer[]>([]);
  const [prompt, setPrompt] = useState<GamePrompt | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [resultModal, setResultModal] = useState<ResultModal>(null);
  const [gameSpeaking, setGameSpeaking] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const playFeedback = useAnswerFeedback();
  const correctCount = answers.filter((answer) => answer.userWasCorrect).length;
  const wrongAnswers = answers.filter((answer) => !answer.userWasCorrect);

  function resetGame() {
    setRunning(false);
    setSeconds(60);
    setAnswers([]);
    setPrompt(null);
    setFeedback(null);
    setStreak(0);
    setBestStreak(0);
    setResultModal(null);
    setLimitReached(false);
  }

  function nextPrompt(source = words) {
    if (source.length < 2) return;
    const word = source[Math.floor(Math.random() * source.length)];
    const correctPair = Math.random() >= 0.5;
    const other = shuffle(source.filter((item) => item.id !== word.id))[0];
    setPrompt({ word, shownTranslation: correctPair ? word.russian : other.russian, isCorrectPair: correctPair });
  }

  async function start() {
    const deck = shuffle(words);
    try {
      await api("/game/start", { method: "POST" });
      void onSubscriptionChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("daily_wordy_games_limit_reached")) {
        setLimitReached(true);
        void onSubscriptionChanged();
        return;
      }
      throw error;
    }
    setAnswers([]);
    setSeconds(60);
    setStreak(0);
    setBestStreak(0);
    setFeedback(null);
    setRunning(true);
    nextPrompt(deck);
  }

  useEffect(resetGame, [resetSignal, settings.selected_category_ids, settings.current_category, settings.current_level]);
  useEffect(() => onActiveChange(running), [running, onActiveChange]);

  useEffect(() => {
    if (!running || paused) return;
    const interval = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(interval);
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [running, paused]);

  useEffect(() => {
    if (running || seconds !== 0 || answers.length === 0) return;
    void api("/game/result", {
      method: "POST",
      body: JSON.stringify({
        total_questions: answers.length,
        correct_answers: correctCount,
        wrong_answers: answers.length - correctCount,
        score: correctCount,
      }),
    }).then(onStatsChanged);
  }, [running, seconds, answers, correctCount, onStatsChanged]);

  function answer(userSaidCorrect: boolean) {
    if (!prompt || feedback) return;
    const userWasCorrect = userSaidCorrect === prompt.isCorrectPair;
    setFeedback(userWasCorrect ? "success" : "error");
    playFeedback(userWasCorrect);
    setAnswers((items) => [...items, { ...prompt, userWasCorrect }]);
    setStreak((current) => {
      const next = userWasCorrect ? current + 1 : 0;
      setBestStreak((best) => Math.max(best, next));
      return next;
    });
    window.setTimeout(() => {
      setFeedback(null);
      nextPrompt();
    }, 260);
  }

  if (selectedCategoryIds(settings) === null) return <EmptySettings title="Wordy" onNeedProfile={onNeedProfile} />;
  if (limitReached) return <LimitReachedView onUpgrade={onUpgrade} />;

  if (!running && answers.length > 0) {
    const accuracy = Math.round((correctCount / answers.length) * 100);
    const messageText = accuracy >= 85 ? "Отличный результат!" : accuracy >= 65 ? "Очень хорошо!" : "Есть над чем поработать";
    return (
      <main>
        <section className="result-hero" style={{textAlign:"center"}}>
          <div className="result-trophy"><MiniIcon name="trophy" /></div>
          <p>Итоги игры</p>
          <div className="result-score">{correctCount}</div>
          <h2>{messageText}</h2>
          <span className="muted">очков за 60 секунд</span>
        </section>
        <section className="score-grid">
          <MetricCard label="Вопросов" value={answers.length} tone="blue" />
          <MetricCard label="Правильно" value={correctCount} tone="green" />
          <MetricCard label="Ошибки" value={answers.length - correctCount} tone="orange" />
          <MetricCard label="Точность" value={`${accuracy}%`} tone="blue" />
        </section>
        <div className="actions two">
          <button className="primary-action" onClick={() => void start()}>Играть снова</button>
          <button className="quiet-action" disabled={!wrongAnswers.length} onClick={() => setResultModal("wrong")}>Разобрать ошибки</button>
        </div>
        <ResultModalView
          title={resultModal === "correct" ? "Правильные ответы" : "Ошибки"}
          answers={resultModal === "correct" ? answers.filter((item) => item.userWasCorrect) : wrongAnswers}
          open={resultModal !== null}
          empty={resultModal === "wrong" ? "Ошибок нет." : "Пока нет правильных ответов."}
          onClose={() => setResultModal(null)}
        />
      </main>
    );
  }

  return (
    <main className="game-screen">
      <section className="apphead">
        <div>
          <div className="eyebrow">Tezlik o'yini · Игра на скорость</div>
          <h1>Wordy</h1>
        </div>
        <div className="lvl">{settings.current_level}</div>
      </section>
      <div className="mgrid">
        <div className="mtile"><div className="ic"><MiniIcon name="clock" /></div><div className="v">{seconds}</div><div className="k">секунд</div></div>
        <div className="mtile"><div className="ic" style={{color:"var(--lime)"}}><MiniIcon name="star" /></div><div className="v">{correctCount}</div><div className="k">очки</div></div>
        <div className="mtile"><div className="ic" style={{color:"var(--gold)"}}><MiniIcon name="fire" /></div><div className="v">{streak}</div><div className="k">серия</div></div>
      </div>
      {!subscription.is_premium && subscription.limits.wordy_games?.daily_limit !== null && (
        <p className="limit-copy">
          Бесплатно сегодня: {subscription.limits.wordy_games?.used_today || 0}/{subscription.limits.wordy_games?.daily_limit || 5} игр
        </p>
      )}
      <section className={`game-card ${feedback ? `is-${feedback}` : ""}`}>
        <p className="game-name">Проверка перевода</p>
        <div className="game-word-row">
          <button
            className={`word-title game-word ${gameSpeaking ? "speaking" : ""}`}
            disabled={!prompt}
            onClick={() => prompt && pronounce(prompt.word.english, () => setGameSpeaking(true), () => setGameSpeaking(false))}
          >
            {prompt?.word.english || (loading ? "Загружаем..." : "Готовы начать?")}
          </button>
          {prompt && (
            <button className={`speaker-button ${gameSpeaking ? "speaking" : ""}`} onClick={() => pronounce(prompt.word.english, () => setGameSpeaking(true), () => setGameSpeaking(false))} aria-label="Произнести слово">
              <MiniIcon name="volume" />
            </button>
          )}
        </div>
        <p className="game-translation">{prompt?.shownTranslation || message || "За 60 секунд отметьте, верный ли перевод."}</p>
        <div className={`streak-pill ${streak > 2 ? "hot" : ""}`}>Лучшая серия: {bestStreak}</div>
      </section>
      {running ? (
        <div className="actions two">
          <button className="primary-action game-answer-button" onClick={() => answer(true)}>Верно</button>
          <button className="danger-action game-answer-button" onClick={() => answer(false)}>Неверно</button>
        </div>
      ) : (
        <button className="btn lime-action wide lg" disabled={loading || words.length < 2} onClick={() => void start()}>Начать игру ✦</button>
      )}
    </main>
  );
}

function ProfileView({
  user,
  settings,
  categories,
  subscription,
  onSubscriptionChanged,
  onSave,
  onFullscreenChange,
}: {
  user?: TelegramUser;
  settings: Settings;
  categories: Category[];
  subscription: Subscription;
  onSubscriptionChanged: () => Promise<Subscription>;
  onSave: (settings: Partial<Settings>) => Promise<void>;
  onFullscreenChange: (fullscreen: boolean) => void;
}) {
  const [draftCategories, setDraftCategories] = useState<string[]>(selectedCategoryIds(settings) || []);
  const [draftLevel, setDraftLevel] = useState<Level>(settings.current_level);
  const [screen, setScreen] = useState<ProfileScreen>("main");
  const [premiumPrompt, setPremiumPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileStats, setProfileStats] = useState<Stats | null>(null);
  const displayName = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram пользователь" : "Загружаем профиль";
  const avatarUrl = telegramAvatarUrl();
  const selectedCategoryChips = profileCategories(settings);
  const categoriesByName = new Map(categories.map((category) => [category.name, category]));

  useEffect(() => {
    setDraftCategories(selectedCategoryIds(settings) || []);
    setDraftLevel(settings.current_level);
  }, [settings.selected_category_ids, settings.current_category, settings.current_level]);

  useEffect(() => {
    api<Stats>("/stats/me").then(setProfileStats).catch(() => setProfileStats(null));
  }, []);

  useEffect(() => {
    onFullscreenChange(screen !== "main");
    return () => onFullscreenChange(false);
  }, [screen, onFullscreenChange]);

  useTelegramBackButton(screen !== "main" && screen !== "premium", () => {
    if (screen === "categories") {
      setScreen("settings");
      return;
    }
    if (screen === "premium" && premiumPrompt) {
      setPremiumPrompt(false);
    }
    setScreen("main");
  });

  async function save() {
    setSaving(true);
    try {
      await onSave({ selected_category_ids: draftCategories, current_level: draftLevel });
      setScreen("main");
    } finally {
      setSaving(false);
    }
  }

  if (screen === "categories") {
    return (
      <CategorySelectionScreen
        categories={categories}
        selected={draftCategories}
        onSave={async (nextCategories) => {
          setDraftCategories(nextCategories);
          setSaving(true);
          try {
            await onSave({ selected_category_ids: nextCategories, current_level: draftLevel });
            setScreen("main");
          } finally {
            setSaving(false);
          }
        }}
        onBack={() => setScreen("settings")}
        onLockedCategory={() => {
          setPremiumPrompt(true);
          setScreen("premium");
        }}
      />
    );
  }

  if (screen === "premium") {
    return (
      <PremiumScreen
        subscription={subscription}
        onBack={() => setScreen("main")}
        onSubscriptionChanged={onSubscriptionChanged}
        categoryLockedPrompt={premiumPrompt}
      />
    );
  }

  if (screen === "stats") {
    return (
      <div>
        <button className="quiet-action back-button" onClick={() => setScreen("main")}>Назад</button>
        <StatsView refreshKey={0} subscription={subscription} />
      </div>
    );
  }

  if (screen === "settings") {
    return (
      <main>
        <button className="quiet-action back-button" onClick={() => setScreen("main")}>Назад</button>
        <section className="stats-hero">
          <div>
            <p>Профиль</p>
            <h2>Настройки обучения</h2>
            <span>Категории и уровень используются во всех режимах, кроме игры во время активного раунда.</span>
          </div>
        </section>
        <section className="profile-panel">
          <h3>Выберите категории</h3>
          <p className="profile-helper">Можно выбрать несколько тем.</p>
          <CategoryMultiSelect
            categories={categories}
            selected={draftCategories}
            onOpen={() => setScreen("categories")}
          />
          {!subscription.is_premium && categories.some((category) => category.is_locked_for_user) && (
            <p className="profile-helper">Premium категории видны сразу, но для выбора нужна подписка.</p>
          )}
          <span className="filter-label">Уровень</span>
          <div className="levels">
            {LEVELS.map((level) => (
              <button key={level} className={draftLevel === level ? "active" : ""} onClick={() => setDraftLevel(level)}>
                {level}
              </button>
            ))}
          </div>
          <button className="wide primary-action profile-save" disabled={saving} onClick={save}>
            {saving ? "Сохраняем..." : "Сохранить"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="profile-screen">
      <section className="apphead" style={{marginBottom:14}}>
        <div><div className="eyebrow">Profil</div><h1>Профиль</h1></div>
      </section>
      <section className="profile-hero-card" style={subscription.is_premium ? {borderColor:"rgba(255,203,69,.24)"} : {}}>
        <div className="profile-avatar">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{profileInitials(user)}</span>}
        </div>
        <div className="profile-hero-copy">
          <p className="eyebrow">Profil</p>
          <h2>{displayName}</h2>
          <span className="muted3" style={{fontSize:13,fontWeight:600}}>{user?.username ? `@${user.username}` : user ? `ID: ${user.telegram_id}` : ""}</span>
          <div className="row" style={{gap:7,marginTop:8,flexWrap:"wrap"}}>
            {subscription.is_premium
              ? <span className="badge gold"><MiniIcon name="gem" />Premium</span>
              : <span className="badge neutral">Free</span>}
            <span className="badge blue">{settings.current_level}</span>
          </div>
        </div>
      </section>

      <section className="profile-summary-card">
        <div className="summary-item">
          <div className="set-row-icon" style={{background:"rgba(255,203,69,.16)",color:"var(--gold)",margin:"0 auto 8px"}}><MiniIcon name="fire" /></div>
          <strong>{profileStats?.games_played ?? "—"}</strong>
          <p>Игр сыграно</p>
        </div>
        <div className="summary-item">
          <div className="set-row-icon" style={{background:"rgba(200,249,77,.16)",color:"var(--lime)",margin:"0 auto 8px"}}><MiniIcon name="cards" /></div>
          <strong>{profileStats?.learned_words_count ?? "—"}</strong>
          <p>Выучено</p>
        </div>
        <div className="summary-item">
          <div className="set-row-icon" style={{background:"var(--blue-tint)",color:"var(--blue-soft)",margin:"0 auto 8px"}}><MiniIcon name="bolt" /></div>
          <strong>{profileStats?.best_score ?? "—"}</strong>
          <p>Рекорд</p>
        </div>
      </section>

      <section className="profile-current-card">
        <div className="profile-section-heading">
          <div>
            <p className="eyebrow">Текущий план</p>
            <h3>Настройки обучения</h3>
          </div>
          <button className="soft-action compact-button" onClick={() => setScreen("settings")}>Изменить</button>
        </div>
        <div className="level-orbit">
          <span>Уровень</span>
          <strong>{settings.current_level}</strong>
          <em>{LEVEL_LABELS[settings.current_level]}</em>
        </div>
        <div className="profile-chip-cloud">
          {selectedCategoryChips.length ? selectedCategoryChips.map((category) => {
            const categoryMeta = categoriesByName.get(category);
            const locked = Boolean(categoryMeta?.is_locked_for_user);
            return (
              <span key={category} className={`profile-category-chip ${locked ? "locked" : ""}`}>
                {locked ? "🔒" : categoryIcon(category)} {category}
                {locked && <strong>Premium</strong>}
              </span>
            );
          }) : (
            <span className="profile-category-chip muted">Категории не выбраны</span>
          )}
        </div>
      </section>

      <PremiumProfileCard
        subscription={subscription}
        onOpen={() => {
          setPremiumPrompt(false);
          setScreen("premium");
        }}
      />

      <section className="profile-settings-card">
        <div className="ey mb12">Настройки</div>
        <button className="settings-list-row" onClick={() => setScreen("settings")}>
          <div className="set-row-icon"><MiniIcon name="target" /></div>
          <div><strong>Уровень</strong><small>{settings.current_level} · {LEVEL_LABELS[settings.current_level]}</small></div>
          <span className="chevron-icon"><MiniIcon name="chevron" /></span>
        </button>
        <button className="settings-list-row" onClick={() => setScreen("settings")}>
          <div className="set-row-icon" style={{background:"rgba(200,249,77,.16)",color:"var(--lime)"}}><MiniIcon name="grid" /></div>
          <div><strong>Категории</strong><small>{categorySummary(settings)}</small></div>
          <span className="chevron-icon"><MiniIcon name="chevron" /></span>
        </button>
        <button className="settings-list-row" onClick={() => setScreen("stats")}>
          <div className="set-row-icon" style={{background:"rgba(55,217,160,.16)",color:"var(--green)"}}><MiniIcon name="chart" /></div>
          <div><strong>Статистика</strong><small>Прогресс, точность и Wordy</small></div>
          <span className="chevron-icon"><MiniIcon name="chevron" /></span>
        </button>
        <div className="settings-list-row disabled">
          <div className="set-row-icon" style={{background:"rgba(255,203,69,.16)",color:"var(--gold)"}}><MiniIcon name="bell" /></div>
          <div><strong>Уведомления</strong><small>Скоро</small></div>
          <span className="chevron-icon"><MiniIcon name="chevron" /></span>
        </div>
        <div className="settings-list-row disabled">
          <div className="set-row-icon" style={{background:"rgba(155,140,255,.16)",color:"var(--violet)"}}><MiniIcon name="globe" /></div>
          <div><strong>Язык</strong><small>Русский интерфейс</small></div>
          <span className="chevron-icon"><MiniIcon name="chevron" /></span>
        </div>
      </section>
    </main>
  );
}

function PremiumProfileCard({ subscription, onOpen }: { subscription: Subscription; onOpen: () => void }) {
  return (
    <section className={`card ${subscription.is_premium ? "" : "card-prem-upsell"}`} style={subscription.is_premium ? {border:"1px solid rgba(255,203,69,.2)"} : {}}>
      {subscription.is_premium ? (
        <>
          <div className="row" style={{marginBottom:8}}>
            <span className="badge gold"><MiniIcon name="gem" />Wordy Premium</span>
            <span className="badge green" style={{marginLeft:"auto"}}>Активна</span>
          </div>
          <p className="muted" style={{fontSize:13.5}}>
            {isAdminPremiumPlan(subscription.plan)
              ? <><b style={{color:"var(--txt)"}}>Admin Premium</b></>
              : <>Тариф: <b style={{color:"var(--txt)"}}>{planTariffLabel(subscription.plan)}</b>{subscription.expires_at ? ` · до ${formatDate(subscription.expires_at)}` : ""}</>}
          </p>
          <button className="btn btn-outline wide sm" style={{marginTop:14}} onClick={onOpen}>Управление подпиской</button>
        </>
      ) : (
        <>
          <div className="row">
            <span className="badge gold"><MiniIcon name="gem" />Premium</span>
          </div>
          <div className="h-card" style={{marginTop:10}}>Открой весь Wordy</div>
          <p className="muted" style={{fontSize:13.5,margin:"6px 0 14px"}}>Безлимит, все категории и расширенная статистика.</p>
          <button className="btn btn-gold wide sm" onClick={onOpen}>Получить Premium</button>
        </>
      )}
    </section>
  );
}

function CategoryMultiSelect({
  categories,
  selected,
  onOpen,
}: {
  categories: Category[];
  selected: string[];
  onOpen: () => void;
}) {
  const lockedCount = categories.filter((category) => category.is_locked_for_user).length;
  return (
    <button className="category-trigger" onClick={onOpen}>
      <span>{categorySummaryFromIds(selected)}</span>
      <strong>{categories.length ? `Выбрать${lockedCount ? ` · 🔒 ${lockedCount}` : ""}` : "Загрузка"}</strong>
    </button>
  );
}

function CategorySelectionScreen({
  categories,
  selected,
  onSave,
  onBack,
  onLockedCategory,
}: {
  categories: Category[];
  selected: string[];
  onSave: (categories: string[]) => void | Promise<void>;
  onBack: () => void;
  onLockedCategory: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);

  useEffect(() => {
    setDraft(selected);
  }, [selected]);

  const allActive = draft.length === 0;
  const [applying, setApplying] = useState(false);

  async function apply() {
    hapticTap();
    setApplying(true);
    try {
      await onSave(draft);
    } finally {
      setApplying(false);
    }
  }

  function toggle(category: string) {
    hapticTap();
    setDraft((current) => toggleCategorySelection(current, category));
  }

  function openLockedCategory() {
    hapticTap();
    onLockedCategory();
  }

  return (
    <main className="full-screen-view">
      <div className="category-screen-header">
        <button className="quiet-action back-button" onClick={onBack}>Назад</button>
        <section className="stats-hero">
          <div>
            <p>Настройки обучения</p>
            <h2>Выберите категории</h2>
          </div>
        </section>
      </div>

      <section className="category-screen-panel">
        <div className="category-chip-cloud">
          <button className={`category-chip ${allActive ? "active" : ""}`} onClick={() => setDraft([])}>
            {ALL_CATEGORIES_LABEL}
          </button>
          {categories.map((category) => {
            const active = draft.includes(category.name);
            return (
              <button
                key={category.id}
                className={`category-chip ${active ? "active" : ""} ${category.is_locked_for_user ? "locked" : ""}`}
                onClick={() => category.is_locked_for_user ? openLockedCategory() : toggle(category.name)}
              >
                <span>{category.is_locked_for_user ? "🔒 " : ""}{category.name}</span>
                {category.is_premium && <strong className="category-premium-badge">Premium</strong>}
              </button>
            );
          })}
        </div>
        <div className="category-panel-actions">
          <button className="quiet-action" onClick={onBack}>Отмена</button>
          <button className="primary-action" disabled={applying} onClick={() => void apply()}>
            {applying ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </section>
    </main>
  );
}

function SetupFlowScreen({
  categories,
  subscription,
  onSubscriptionChanged,
  onSave,
}: {
  categories: Category[];
  subscription: Subscription;
  onSubscriptionChanged: () => Promise<Subscription>;
  onSave: (settings: Partial<Settings>) => Promise<void>;
}) {
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [screen, setScreen] = useState<"setup" | "categories" | "premium">("setup");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState("");

  useTelegramBackButton(screen === "categories", () => setScreen("setup"));

  async function save() {
    if (!selectedLevel) {
      setValidation("Выберите уровень английского, чтобы начать.");
      return;
    }
    setSaving(true);
    setValidation("");
    try {
      await onSave({ current_level: selectedLevel, selected_category_ids: selectedCategories });
    } catch {
      setValidation("Не удалось сохранить настройки. Попробуйте еще раз.");
    } finally {
      setSaving(false);
    }
  }

  if (screen === "categories") {
    return (
      <CategorySelectionScreen
        categories={categories}
        selected={selectedCategories}
        onSave={(nextCategories) => {
          setSelectedCategories(nextCategories);
          setScreen("setup");
        }}
        onBack={() => setScreen("setup")}
        onLockedCategory={() => setScreen("premium")}
      />
    );
  }

  if (screen === "premium") {
    return (
      <PremiumScreen
        subscription={subscription}
        onBack={() => setScreen("categories")}
        onSubscriptionChanged={onSubscriptionChanged}
        categoryLockedPrompt
      />
    );
  }

  return (
    <main className="setup-screen">
      <div className="setup-hero">
        <p className="eyebrow">Первый запуск</p>
        <h2 id="setup-title">Настроим обучение</h2>
        <p>Выберите уровень и цель, чтобы Wordy подобрал подходящие слова.</p>
      </div>

      <div className="setup-content">
        <section className="setup-step">
          <div className="setup-step-title">
            <span>1</span>
            <h3>Ваш уровень английского</h3>
          </div>
          <div className="setup-level-grid">
            {LEVELS.map((level) => (
              <button
                key={level}
                className={`setup-level-option ${selectedLevel === level ? "active" : ""}`}
                onClick={() => {
                  hapticTap();
                  setSelectedLevel(level);
                  setValidation("");
                }}
              >
                <strong>{level}</strong>
                <span>{LEVEL_LABELS[level]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="setup-step">
          <div className="setup-step-title">
            <span>2</span>
            <div>
              <h3>Выберите категории</h3>
              <p>Можно выбрать несколько тем.</p>
            </div>
          </div>
          <CategoryMultiSelect
            categories={categories}
            selected={selectedCategories}
            onOpen={() => setScreen("categories")}
          />
        </section>

        <section className="placement-card" aria-label="Проверка уровня">
          <button disabled>
            <span>Проверить уровень</span>
            <strong>Скоро</strong>
          </button>
          <p>Автоматический тест уровня появится позже.</p>
        </section>
      </div>

      <div className="setup-footer">
        {validation && <p className="setup-validation">{validation}</p>}
        <button className="wide primary-action" disabled={saving} onClick={save}>
          {saving ? "Сохраняем..." : "Начать обучение"}
        </button>
      </div>
    </main>
  );
}

function LimitReachedView({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <main>
      <section className="result-hero">
        <p>Free лимит</p>
        <h2>Лимит на сегодня</h2>
        <span>Оформите Premium, чтобы заниматься без ограничений.</span>
      </section>
      <button className="wide primary-action" onClick={onUpgrade}>Перейти на Premium</button>
    </main>
  );
}

function PremiumScreen({
  subscription,
  onBack,
  onSubscriptionChanged,
  categoryLockedPrompt = false,
}: {
  subscription: Subscription;
  onBack: () => void;
  onSubscriptionChanged: () => Promise<Subscription>;
  categoryLockedPrompt?: boolean;
}) {
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly" | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [plans, setPlans] = useState<PremiumPlans | null>(null);
  const [invoiceLink, setInvoiceLink] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmedSubscription, setConfirmedSubscription] = useState<Subscription | null>(null);

  useTelegramBackButton(true, () => {
    if (selectedPlan) {
      setSelectedPlan(null);
      return;
    }
    onBack();
  });

  useEffect(() => {
    api<PremiumPlans>("/subscription/plans").then(setPlans).catch(() => {
      setPlans({
        monthly: { plan: "monthly", price_stars: 99, currency: "XTR" },
        yearly: { plan: "yearly", price_stars: 799, currency: "XTR" },
        fake_payments_enabled: false,
      });
    });
  }, []);

  async function refreshPaymentStatus() {
    const refreshed = await onSubscriptionChanged();
    if (refreshed.is_premium) {
      setConfirmedSubscription(refreshed);
      setSuccess(true);
      setSelectedPlan(null);
      setPaymentId("");
      setInvoiceLink("");
      setPaymentMessage("");
      return true;
    }
    return false;
  }

  function openTelegramInvoice(link: string) {
    const webApp = window.Telegram?.WebApp;
    if (webApp?.openInvoice) {
      webApp.openInvoice(link, (status) => {
        if (status === "paid") {
          setPaymentMessage("Платеж принят Telegram. Проверяем активацию...");
          void refreshPaymentStatus();
          return;
        }
        if (status === "cancelled" || status === "failed") {
          setPaymentMessage("Оплата не завершена.");
        }
      });
      return;
    }
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(link);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }

  async function openPayment(plan: "monthly" | "yearly") {
    setBusy(true);
    setPaymentMessage("");
    try {
      const invoice = await api<{ payment_id: number; plan: "monthly" | "yearly"; amount_stars: number; invoice_link: string }>("/subscription/telegram-stars/create-invoice", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      setPaymentId(String(invoice.payment_id));
      setInvoiceLink(invoice.invoice_link);
      setSelectedPlan(plan);
      setPaymentMessage("Откройте счет Telegram Stars и завершите оплату.");
      openTelegramInvoice(invoice.invoice_link);
    } finally {
      setBusy(false);
    }
  }

  async function confirmFakePayment() {
    if (!selectedPlan || !paymentId) return;
    setBusy(true);
    try {
      const confirmed = await api<Subscription>("/subscription/fake-confirm", {
        method: "POST",
        body: JSON.stringify({ plan: selectedPlan, fake_payment_id: paymentId }),
      });
      const refreshed = await onSubscriptionChanged();
      setConfirmedSubscription(refreshed || confirmed);
      setSuccess(true);
      setSelectedPlan(null);
      setPaymentId("");
    } finally {
      setBusy(false);
    }
  }

  async function createFakePayment(plan: "monthly" | "yearly") {
    setBusy(true);
    try {
      const checkout = await api<{ fake_payment_id: string; plan: "monthly" | "yearly"; provider: string }>("/subscription/fake-checkout", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      setPaymentId(checkout.fake_payment_id);
      setInvoiceLink("");
      setSelectedPlan(plan);
      setPaymentMessage("Тестовый платеж создан.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelSubscription() {
    setBusy(true);
    try {
      await api<Subscription>("/subscription/cancel", { method: "POST" });
      await onSubscriptionChanged();
      setSuccess(false);
      setConfirmedSubscription(null);
      onBack();
    } finally {
      setBusy(false);
    }
  }

  const displaySubscription = subscription.is_premium ? subscription : confirmedSubscription || subscription;

  if (selectedPlan) {
    const isFakePayment = paymentId.startsWith("fake_");
    return (
      <main className="full-screen-view premium-screen">
        <button className="quiet-action back-button" disabled={busy} onClick={() => setSelectedPlan(null)}>Назад</button>
        <section className="stats-hero premium-hero">
          <div>
            <p>Wordy Premium</p>
            <h2>{isFakePayment ? "Тестовая оплата" : "Оплата Telegram Stars"}</h2>
            <span>{isFakePayment ? "Режим доступен только при включенном dev-флаге." : "Premium активируется после подтверждения платежа Telegram."}</span>
          </div>
        </section>
        <section className="profile-panel">
          <h3>{selectedPlan === "monthly" ? "Premium на месяц" : "Premium на год"}</h3>
          <p className="profile-helper">{paymentMessage || `Платеж создан: ${paymentId || "создаем..."}`}</p>
          <div className="actions">
            {isFakePayment ? (
              <button className="primary-action" disabled={busy || !paymentId} onClick={() => void confirmFakePayment()}>Успешная оплата</button>
            ) : (
              <button className="primary-action" disabled={busy || !invoiceLink} onClick={() => openTelegramInvoice(invoiceLink)}>
                Открыть счет
              </button>
            )}
            {!isFakePayment && (
              <button className="quiet-action" disabled={busy} onClick={() => void refreshPaymentStatus()}>
                Проверить статус
              </button>
            )}
            <button className="quiet-action" disabled={busy} onClick={() => setSelectedPlan(null)}>Отмена</button>
          </div>
        </section>
      </main>
    );
  }

  if (success || subscription.is_premium) {
    return (
      <main className="full-screen-view premium-screen">
        <div className="row" style={{marginBottom:16}}>
          <button className="quiet-action back-button" style={{marginBottom:0}} onClick={onBack}>Назад</button>
          <span className="badge green" style={{marginLeft:"auto"}}>Подписка активна</span>
        </div>
        <div className="prem-hero-card mb12">
          <span style={{color:"var(--gold)",width:48,height:48,display:"inline-flex",margin:"0 auto"}}><MiniIcon name="gem" /></span>
          <div className="kbd-w" style={{fontWeight:800,fontSize:24,color:"var(--txt)",marginTop:8}}>Wordy Premium</div>
          <div className="row" style={{justifyContent:"center",gap:8,marginTop:10,flexWrap:"wrap"}}>
            <span className="badge gold">{isAdminPremiumPlan(displaySubscription.plan) ? "Admin" : planTariffLabel(displaySubscription.plan)}</span>
            {displaySubscription.expires_at && <span className="badge neutral">до {formatDate(displaySubscription.expires_at)}</span>}
          </div>
        </div>
        <div className="card mb12" style={{padding:"4px 18px"}}>
          <div className="prem-feat"><div className="pi"><MiniIcon name="refresh" /></div><div style={{flex:1}}><div className="pt">Безлимитное обучение</div><div className="ps">Без дневного лимита слов</div></div><span className="check-ic"><MiniIcon name="check" /></span></div>
          <div className="prem-feat"><div className="pi"><MiniIcon name="bolt" /></div><div style={{flex:1}}><div className="pt">Безлимитные игры</div><div className="ps">Wordy без ограничений</div></div><span className="check-ic"><MiniIcon name="check" /></span></div>
          <div className="prem-feat"><div className="pi"><MiniIcon name="grid" /></div><div style={{flex:1}}><div className="pt">Все категории</div><div className="ps">Открыты все темы</div></div><span className="check-ic"><MiniIcon name="check" /></span></div>
        </div>
        <button className="btn btn-outline wide" disabled={busy} onClick={() => void cancelSubscription()}>
          Управление подпиской
        </button>
      </main>
    );
  }

  return (
    <main className="full-screen-view premium-screen">
      <div className="row" style={{marginBottom:16}}>
        <button className="quiet-action back-button" style={{marginBottom:0}} onClick={onBack}>Назад</button>
        <span className="badge gold" style={{marginLeft:"auto"}}><MiniIcon name="gem" />Premium</span>
      </div>
      <div className="prem-hero-card mb12">
        <span style={{color:"var(--gold)",width:52,height:52,display:"inline-flex",margin:"0 auto"}}><MiniIcon name="gem" /></span>
        <div className="kbd-w" style={{fontWeight:800,fontSize:26,color:"var(--txt)",marginTop:8}}>Wordy <span style={{color:"var(--gold)"}}>Premium</span></div>
        <p className="muted" style={{fontSize:14,marginTop:6}}>{categoryLockedPrompt ? "Открой платные категории и учись без ограничений." : "Учись без границ. Открой весь словарь и все игры."}</p>
      </div>
      {categoryLockedPrompt && (
        <section className="premium-lock-card mb12">
          <strong>🔒 Premium категория</strong>
          <p>Оформите Premium, чтобы открыть все категории.</p>
        </section>
      )}
      <div className="card mb12" style={{padding:"4px 18px"}}>
        <div className="prem-feat">
          <div className="pi"><MiniIcon name="refresh" /></div>
          <div style={{flex:1}}><div className="pt">Безлимитное обучение</div><div className="ps">Без дневного лимита слов</div></div>
          <span className="check-ic"><MiniIcon name="check" /></span>
        </div>
        <div className="prem-feat">
          <div className="pi"><MiniIcon name="bolt" /></div>
          <div style={{flex:1}}><div className="pt">Безлимитные игры</div><div className="ps">Wordy без ограничений</div></div>
          <span className="check-ic"><MiniIcon name="check" /></span>
        </div>
        <div className="prem-feat">
          <div className="pi"><MiniIcon name="grid" /></div>
          <div style={{flex:1}}><div className="pt">Все категории</div><div className="ps">Открыты все темы</div></div>
          <span className="check-ic"><MiniIcon name="check" /></span>
        </div>
        <div className="prem-feat">
          <div className="pi"><MiniIcon name="chart" /></div>
          <div style={{flex:1}}><div className="pt">Расширенная статистика</div><div className="ps">Графики и прогноз прогресса</div></div>
          <span className="check-ic"><MiniIcon name="check" /></span>
        </div>
      </div>
      <section className="plan-grid">
        <PlanCard title="Premium на месяц" price={`${plans?.monthly.price_stars ?? 99} Stars / месяц`} onPay={() => void openPayment("monthly")} disabled={busy || !plans} />
        <PlanCard title="Premium на год" price={`${plans?.yearly.price_stars ?? 799} Stars / год`} badge="Выгодно" onPay={() => void openPayment("yearly")} disabled={busy || !plans} />
      </section>
      <p className="muted3" style={{textAlign:"center",fontSize:12,marginTop:12}}>Отмена в любой момент · оплата через Telegram Stars</p>
      {plans?.fake_payments_enabled && (
        <section className="plan-grid" style={{marginTop:12}}>
          <PlanCard title="Dev месяц" price="Fake payment" onPay={() => void createFakePayment("monthly")} disabled={busy} />
          <PlanCard title="Dev год" price="Fake payment" onPay={() => void createFakePayment("yearly")} disabled={busy} />
        </section>
      )}
    </main>
  );
}

function PlanCard({ title, price, badge, disabled, onPay }: { title: string; price: string; badge?: string; disabled: boolean; onPay: () => void }) {
  return (
    <section className="plan-card">
      <div>
        {badge && <span className="plan-badge">{badge}</span>}
        <h3>{title}</h3>
        <strong>{price}</strong>
      </div>
      <button className="primary-action" disabled={disabled} onClick={onPay}>Оплатить</button>
    </section>
  );
}

function AccuracyDonut({ pct }: { pct: number }) {
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" style={{flexShrink:0}}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--line-2)" strokeWidth="8" />
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--green)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" fontFamily="Unbounded" fontWeight="800" fontSize="17" fill="var(--txt)">{pct}%</text>
    </svg>
  );
}

function StatsView({ refreshKey, subscription }: { refreshKey: number; subscription: Subscription }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    api<Stats>("/stats/me").then(setStats);
  }, [refreshKey]);
  if (!stats) return <main className="comfort-copy">Загружаем статистику...</main>;
  const days = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  return (
    <main>
      <section className="apphead">
        <div>
          <div className="eyebrow">Statistika</div>
          <h1>Статистика</h1>
        </div>
        {subscription.is_premium && <span className="badge gold"><MiniIcon name="gem" />PRO</span>}
      </section>
      <div className="mgrid mb12" style={{gridTemplateColumns:"1fr 1fr"}}>
        <div className="mtile"><div className="ic" style={{color:"var(--lime)"}}><MiniIcon name="cards" /></div><div className="v">{stats.learned_words_count}</div><div className="k">Изучено слов</div></div>
        <div className="mtile"><div className="ic"><MiniIcon name="refresh" /></div><div className="v">{stats.reviewed_words_count}</div><div className="k">Повторено</div></div>
        <div className="mtile"><div className="ic" style={{color:"var(--gold)"}}><MiniIcon name="bolt" /></div><div className="v">{stats.games_played}</div><div className="k">Сыграно игр</div></div>
        <div className="mtile"><div className="ic" style={{color:"var(--gold)"}}><MiniIcon name="trophy" /></div><div className="v">{stats.best_score}</div><div className="k">Лучший счёт</div></div>
      </div>
      <section className="card mb12">
        <div className="acc-donut-row">
          <div className="acc-donut-info">
            <div className="ey">Точность ответов</div>
            <div className="acc-donut-pct">{stats.average_accuracy}%</div>
            <div className="muted3 acc-donut-sub">Правильно: {stats.correct_answers} · Ошибки: {stats.wrong_answers}</div>
          </div>
          <AccuracyDonut pct={stats.average_accuracy} />
        </div>
      </section>
      <section className="stats-grid">
        <MetricCard label="Изучено слов" value={stats.learned_words_count} tone="blue" />
        <MetricCard label="На повторение" value={stats.unknown_words_count} tone="orange" />
        <MetricCard label="Повторений" value={stats.reviewed_words_count} tone="green" />
        <MetricCard label="Сыграно игр" value={stats.games_played} tone="orange" />
        <MetricCard label="Лучший результат" value={stats.best_score} tone="blue" />
        <MetricCard label="Всего ответов" value={stats.correct_answers + stats.wrong_answers} tone="green" />
      </section>
    </main>
  );
}

function ResultModalView({ title, answers, open, empty, onClose }: { title: string; answers: GameAnswer[]; open: boolean; empty: string; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="result-modal">
        <div className="sheet-header">
          <div>
            <p>Результаты игры</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        {answers.length ? (
          <div className="result-list">
            {answers.map((answer, index) => (
              <div className={`result-item ${answer.userWasCorrect ? "correct" : "wrong"}`} key={`${answer.word.id}-${index}`}>
                <div className="result-word">
                  <strong>{answer.word.english}</strong>
                  <span>{answer.userWasCorrect ? "Верно" : "Ошибка"}</span>
                </div>
                <dl>
                  <div><dt>Показанный перевод</dt><dd>{answer.shownTranslation}</dd></div>
                  <div><dt>Правильный перевод</dt><dd>{answer.word.russian}</dd></div>
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className="comfort-copy">{empty}</p>
        )}
      </section>
    </div>
  );
}

function ConfirmExitGameModal({ open, onExit, onStay }: { open: boolean; onExit: () => void; onStay: () => void }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop compact" role="dialog" aria-modal="true">
      <section className="confirm-modal">
        <h2>Выйти из игры?</h2>
        <p>Текущий результат будет сброшен.</p>
        <div className="actions two">
          <button className="danger-action" onClick={onExit}>Выйти</button>
          <button className="primary-action" onClick={onStay}>Продолжить играть</button>
        </div>
      </section>
    </div>
  );
}

function EmptySettings({ title, onNeedProfile }: { title: string; onNeedProfile: () => void }) {
  return (
    <main>
      <section className="hero-panel">
        <div>
          <p>{title}</p>
          <h2>Выберите категории в профиле</h2>
        </div>
      </section>
      <section className="word-card empty">После сохранения категорий этот режим начнет использовать ваш набор слов.</section>
      <button className="wide primary-action" onClick={onNeedProfile}>Перейти в профиль</button>
    </main>
  );
}

function TrainingEmpty({ loading, message, onBack }: { loading: boolean; message: string; onBack: () => void }) {
  return (
    <main>
      <button className="quiet-action back-button" onClick={onBack}>Назад</button>
      <section className="word-card empty">{loading ? "Загружаем слова..." : message}</section>
    </main>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | string; tone: "blue" | "green" | "orange" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

type AdminPage =
  | "overview"
  | "users"
  | "activity"
  | "learning"
  | "wordy"
  | "subscriptions"
  | "payments"
  | "content"
  | "categories"
  | "admins"
  | "logs"
  | "settings";
type AdminUser = {
  id: number;
  telegram_id: number;
  username?: string | null;
  first_name: string;
  last_name?: string | null;
  selected_categories: string[] | null;
  selected_level: string;
  learned_words_count: number;
  unknown_words_count: number;
  reviewed_words_count: number;
  games_played: number;
  best_score: number;
  correct_answers: number;
  wrong_answers: number;
  average_accuracy: number;
  last_active_at?: string | null;
  created_at?: string | null;
  status: "active" | "banned";
  is_premium: boolean;
  subscription_plan?: string | null;
  subscription_status: string;
  subscription_expires_at?: string | null;
  subscription_source?: string | null;
};

const ADMIN_TOKEN_KEY = "wordy_admin_token";
const ADMIN_NAV: Array<{ id: AdminPage; label: string; icon: MiniIconName; group: string }> = [
  { id: "overview", label: "Обзор", icon: "grid", group: "Обзор" },
  { id: "users", label: "Пользователи", icon: "profile", group: "Обзор" },
  { id: "activity", label: "Активность", icon: "chart", group: "Обзор" },
  { id: "learning", label: "Обучение", icon: "learn", group: "Обучение" },
  { id: "wordy", label: "Wordy", icon: "bolt", group: "Обучение" },
  { id: "content", label: "Контент", icon: "cards", group: "Обучение" },
  { id: "categories", label: "Категории", icon: "grid", group: "Обучение" },
  { id: "subscriptions", label: "Подписки", icon: "gem", group: "Монетизация" },
  { id: "payments", label: "Платежи", icon: "star", group: "Монетизация" },
  { id: "admins", label: "Администраторы", icon: "lock", group: "Система" },
  { id: "logs", label: "Логи", icon: "clock", group: "Система" },
  { id: "settings", label: "Настройки", icon: "target", group: "Система" },
];

function adminAuthHeaders(): Record<string, string> {
  const initData = getTelegramInitData();
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  return initData ? { Authorization: `tma ${initData}` } : token ? { Authorization: `Bearer ${token}` } : {};
}

async function adminApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/admin/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...adminAuthHeaders(),
      ...options?.headers,
    },
  });
  if (!response.ok) throw new Error(await response.text());
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) return (await response.text()) as T;
  return response.json();
}

function AdminApp() {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [identity, setIdentity] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [globalSearch, setGlobalSearch] = useState("");
  const [page, setPage] = useState<AdminPage>(() => {
    const path = window.location.pathname;
    const match = ADMIN_NAV.find((item) => path.includes(`/admin/${item.id}`));
    if (path.includes("/admin/dashboard")) return "overview";
    return match?.id || "overview";
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(() => {
    const match = window.location.pathname.match(/\/admin\/users\/(\d+)/);
    return match ? Number(match[1]) : null;
  });

  function navigate(nextPage: AdminPage, userId?: number) {
    setPage(nextPage);
    setSelectedUserId(userId || null);
    const path = userId ? `/admin/users/${userId}` : `/admin/${nextPage}`;
    window.history.pushState({}, "", path);
  }

  useEffect(() => {
    adminApi("/me")
      .then((data: any) => {
        setIdentity(data.admin || "");
        setAuthorized(true);
      })
      .catch(() => setAuthorized(false))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <main className="admin-shell">Проверяем доступ...</main>;
  if (!authorized) return <AdminLogin onLoggedIn={() => setAuthorized(true)} />;

  return (
    <div className="admin-shell admin">
      <aside className="admin-sidebar sidebar">
        <div className="admin-brand sb-brand">
          <img src="/wordy-icon.svg" alt="" />
          <div className="bcol">
            <span className="bt">Wordy</span>
            <span className="bs">Admin panel</span>
          </div>
        </div>
        <nav className="admin-nav sb-nav">
          {["Обзор", "Обучение", "Монетизация", "Система"].map((group) => (
            <div key={group}>
              <div className="sb-group">{group}</div>
              {ADMIN_NAV.filter((item) => item.group === group).map((item) => (
                <button key={item.id} className={`nav-i ${page === item.id ? "active on" : ""}`} onClick={() => navigate(item.id)}>
                  <MiniIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">
            <span className="av">{identity.slice(0, 2).toUpperCase() || "SA"}</span>
            <div>
              <div className="nm">{identity || "secret-admin"}</div>
              <div className="rl">Super admin</div>
            </div>
          </div>
        </div>
      </aside>
      <main className="admin-main main">
        <AdminTopbar
          identity={identity}
          search={globalSearch}
          onSearch={setGlobalSearch}
          onRefresh={() => setRefreshKey((value) => value + 1)}
        />
        <div className="content">
          {page === "overview" && <AdminOverview refreshKey={refreshKey} />}
          {page === "users" && (selectedUserId ? <AdminUserDetail userId={selectedUserId} onBack={() => navigate("users")} refreshKey={refreshKey} /> : <AdminUsers onOpen={(id) => navigate("users", id)} globalSearch={globalSearch} refreshKey={refreshKey} />)}
          {page === "activity" && <AdminActivity refreshKey={refreshKey} />}
          {page === "learning" && <AdminLearning refreshKey={refreshKey} />}
          {page === "wordy" && <AdminWordy refreshKey={refreshKey} />}
          {page === "subscriptions" && <AdminSubscriptions refreshKey={refreshKey} />}
          {page === "payments" && <AdminPayments refreshKey={refreshKey} globalSearch={globalSearch} />}
          {page === "content" && <AdminContent refreshKey={refreshKey} />}
          {page === "categories" && <AdminCategories refreshKey={refreshKey} />}
          {page === "admins" && <AdminAdmins refreshKey={refreshKey} />}
          {page === "logs" && <AdminLogs refreshKey={refreshKey} />}
          {page === "settings" && <AdminSettings refreshKey={refreshKey} />}
        </div>
      </main>
    </div>
  );
}

function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function login() {
    setError("");
    try {
      const result = await fetch(`${API_URL}/admin/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (!result.ok) throw new Error(await result.text());
      const data = await result.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      onLoggedIn();
      window.history.replaceState({}, "", "/admin/dashboard");
    } catch {
      setError("Неверный секрет администратора.");
    }
  }

  return (
    <main className="admin-login">
      <section className="admin-login-card">
        <p className="eyebrow">Wordy</p>
        <h1>Вход администратора</h1>
        <p>Введите ADMIN_SECRET. Секрет проверяется только на сервере.</p>
        <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="ADMIN_SECRET" />
        {error && <div className="notice">{error}</div>}
        <button className="primary-action" onClick={login} disabled={!secret}>Войти</button>
      </section>
    </main>
  );
}

function AdminTopbar({
  identity,
  search,
  onSearch,
  onRefresh,
}: {
  identity: string;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="admin-topbar topbar">
      <div className="admin-search search">
        <MiniIcon name="grid" />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Поиск по админке, пользователям, платежам" />
      </div>
      <span className="admin-env env"><span className="dt" />Production</span>
      <span className="admin-identity">{identity || "admin"}</span>
      <button className="btn btn-ghost sm" onClick={onRefresh}><MiniIcon name="refresh" />Обновить</button>
    </header>
  );
}

function AdminOverview({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi("/dashboard").then(setData);
  }, [refreshKey]);
  if (!data) return <p>Загружаем дашборд...</p>;
  return (
    <>
      <AdminHeader title="Обзор" subtitle="Основные продуктовые, учебные и операционные метрики Wordy" />
      <section className="admin-metric-grid">
        <AdminMetric label="Пользователей" value={data.total_users} />
        <AdminMetric label="Новые сегодня" value={data.new_users_today} />
        <AdminMetric label="Новые за 7 дней" value={data.new_users_last_7_days} />
        <AdminMetric label="Активны сегодня" value={data.active_users_today} />
        <AdminMetric label="Активны 7 дней" value={data.active_users_last_7_days} />
        <AdminMetric label="Изучено слов" value={data.total_learned_words} />
        <AdminMetric label="Неизвестных слов" value={data.total_unknown_words} />
        <AdminMetric label="Игр сыграно" value={data.total_games_played} />
        <AdminMetric label="Средняя точность" value={`${data.average_accuracy}%`} />
        <AdminMetric label="Premium" value={data.premium_users_count} />
        <AdminMetric label="Free" value={data.free_users_count} />
        <AdminMetric label="Заблокированы" value={data.banned_users_count} />
      </section>
      <section className="admin-columns">
        <AdminList title="Рост пользователей" items={(data.new_users_by_day || []).map((item: any) => `${item.date}: ${item.count}`)} />
        <AdminList title="Учебная активность" items={(data.learning_activity_by_day || []).map((item: any) => `${item.date}: ${item.count}`)} />
        <AdminList title="Игровая активность" items={(data.game_activity_by_day || []).map((item: any) => `${item.date}: ${item.count}`)} />
        <AdminList title="Premium conversions" items={(data.premium_conversions_by_day || []).map((item: any) => `${item.date}: ${item.count}`)} />
        <AdminList title="Revenue Stars" items={(data.revenue_by_day || []).map((item: any) => `${item.date}: ${item.stars}`)} />
        <AdminList title="Операции" items={[`API: ${data.api_health}`, `DB: ${data.database_status}`, `Backup: ${data.last_backup_time ? formatDate(data.last_backup_time) : "нет данных"}`]} />
      </section>
      <AdminLists data={data} />
      <AdminList title="Последние действия админов" items={(data.latest_admin_actions || []).map((item: any) => `${formatDate(item.created_at)} · ${item.action}`)} />
    </>
  );
}

function AdminDashboard() {
  return <AdminOverview refreshKey={0} />;
}

function AdminLists({ data }: { data: any }) {
  return (
    <section className="admin-columns">
      <AdminList title="Топ категорий" items={(data.top_categories || []).map((item: any) => `${item.category}: ${item.count}`)} />
      <AdminList title="Уровни" items={(data.top_levels || []).map((item: any) => `${item.level}: ${item.count}`)} />
      <AdminList title="Новые пользователи" items={(data.new_users_by_day || []).map((item: any) => `${item.date}: ${item.count}`)} />
    </section>
  );
}

function AdminUsers({ onOpen, globalSearch, refreshKey }: { onOpen: (id: number) => void; globalSearch: string; refreshKey: number }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [premium, setPremium] = useState("");
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [total, setTotal] = useState(0);

  function load() {
    const params = new URLSearchParams();
    if (search || globalSearch) params.set("search", search || globalSearch);
    if (status) params.set("status", status);
    if (premium) params.set("premium", premium);
    if (level) params.set("level", level);
    if (category) params.set("category", category);
    adminApi<any>(`/users?${params.toString()}`).then((data) => {
      setUsers(data.items);
      setTotal(data.total || 0);
      setSelected([]);
    });
  }

  useEffect(() => {
    load();
    adminApi<string[]>("/categories").then(setCategories).catch(() => setCategories([]));
  }, [refreshKey]);

  useEffect(() => {
    if (globalSearch) load();
  }, [globalSearch]);

  async function bulk(action: string, plan?: string) {
    if (!selected.length) return;
    if (!window.confirm(`Подтвердить действие "${action}" для ${selected.length} пользователей?`)) return;
    await adminApi("/users/bulk-action", {
      method: "POST",
      body: JSON.stringify({ user_ids: selected, action, plan }),
    });
    load();
  }

  return (
    <>
      <AdminHeader title="Пользователи" subtitle="Поиск, фильтры и управление аккаунтами" />
      <section className="admin-filters">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="telegram_id, username, имя" />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="banned">Заблокированные</option>
        </select>
        <select value={premium} onChange={(event) => setPremium(event.target.value)}>
          <option value="">Free/Premium</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
        </select>
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">Все уровни</option>
          {LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Все категории</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="primary-action" onClick={load}>Найти</button>
      </section>
      <AdminExportButtons />
      <section className="admin-actions">
        <span className="admin-muted">Выбрано: {selected.length} · Всего: {total}</span>
        <button className="soft-action" onClick={() => downloadAdminCsv(`/export/users.csv?ids=${selected.join(",")}`, "wordy-selected-users.csv")} disabled={!selected.length}>Экспорт выбранных</button>
        <button className="danger-action" onClick={() => bulk("ban")} disabled={!selected.length}>Заблокировать</button>
        <button className="soft-action" onClick={() => bulk("unban")} disabled={!selected.length}>Разблокировать</button>
        <button className="danger-action" onClick={() => bulk("reset_stats")} disabled={!selected.length}>Сброс статистики</button>
        <button className="primary-action" onClick={() => bulk("grant_premium", "monthly")} disabled={!selected.length}>Premium месяц</button>
        <button className="danger-action" onClick={() => bulk("revoke_premium")} disabled={!selected.length}>Отозвать Premium</button>
      </section>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={users.length > 0 && selected.length === users.length} onChange={(event) => setSelected(event.target.checked ? users.map((user) => user.id) : [])} /></th>
              <th>ID</th><th>Telegram ID</th><th>username</th><th>Имя</th><th>Фамилия</th><th>Уровень</th><th>Категории</th><th>Слова</th><th>Игры</th><th>Точность</th><th>Подписка</th><th>Статус</th><th>Создан</th><th>Активность</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><input type="checkbox" checked={selected.includes(user.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id))} /></td>
                <td>{user.id}</td>
                <td>{user.telegram_id}</td>
                <td><button className="link-button" onClick={() => onOpen(user.id)}>{user.username ? `@${user.username}` : "нет"}</button></td>
                <td>{user.first_name}</td>
                <td>{user.last_name || ""}</td>
                <td>{user.selected_level || "Не выбран"}</td>
                <td>{formatCategories(user.selected_categories)}</td>
                <td>{user.learned_words_count}</td>
                <td>{user.games_played}</td>
                <td>{user.average_accuracy}%</td>
                <td><span className={`admin-status ${user.is_premium ? "premium" : ""}`}>{user.is_premium ? planLabel(user.subscription_plan) : "Free"}</span></td>
                <td><span className={`admin-status ${user.status}`}>{user.status === "banned" ? "banned" : "active"}</span></td>
                <td>{formatDate(user.created_at)}</td>
                <td>{formatDate(user.last_active_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AdminUserDetail({ userId, onBack, refreshKey }: { userId: number; onBack: () => void; refreshKey: number }) {
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState("overview");
  const [confirm, setConfirm] = useState<{ title: string; action: string; body?: Record<string, unknown> } | null>(null);
  const [customPremiumDays, setCustomPremiumDays] = useState("7");
  const [customPremiumNote, setCustomPremiumNote] = useState("");
  const [customPremiumError, setCustomPremiumError] = useState("");
  function load() {
    adminApi(`/users/${userId}`).then(setUser);
  }
  useEffect(load, [userId, refreshKey]);

  async function runAction(action: string, body?: Record<string, unknown>) {
    await adminApi(`/users/${userId}/${action}`, {
      method: "POST",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    setConfirm(null);
    load();
  }

  function confirmCustomPremiumGrant() {
    const durationDays = Number(customPremiumDays);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
      setCustomPremiumError("Введите количество дней от 1 до 3650.");
      return;
    }
    setCustomPremiumError("");
    setConfirm({
      title: `Выдать Premium на ${durationDays} дней?`,
      action: "grant-premium",
      body: {
        plan: "custom",
        duration_days: durationDays,
        ...(customPremiumNote.trim() ? { note: customPremiumNote.trim() } : {}),
      },
    });
  }

  if (!user) return <p>Загружаем пользователя...</p>;
  return (
    <>
      <button className="quiet-action back-button" onClick={onBack}>Назад</button>
      <AdminHeader title={`Пользователь #${user.id}`} subtitle={`${user.telegram_id} · ${user.username ? `@${user.username}` : user.first_name}`} />
      <section className="admin-metric-grid">
        <AdminMetric label="Изучено" value={user.learned_words_count} />
        <AdminMetric label="Не знает" value={user.unknown_words_count} />
        <AdminMetric label="Повторения" value={user.reviewed_words_count} />
        <AdminMetric label="Игры" value={user.games_played} />
        <AdminMetric label="Лучший счет" value={user.best_score} />
        <AdminMetric label="Точность" value={`${user.average_accuracy}%`} />
      </section>
      <section className="admin-card">
        <h3>Профиль</h3>
        <p>Telegram: <strong>{user.telegram_id}</strong> · username: <strong>{user.username ? `@${user.username}` : "нет"}</strong></p>
        <p>Категории: <strong>{formatCategories(user.selected_categories)}</strong></p>
        <p>Уровень: <strong>{user.selected_level || "Не выбран"}</strong></p>
        <p>Статус: <strong>{user.status === "banned" ? "Заблокирован" : "Активен"}</strong></p>
        <p>Подписка: <strong>{user.is_premium ? planLabel(user.subscription_plan) : "Free"}</strong></p>
        {user.subscription_expires_at && <p>Premium до: <strong>{formatDate(user.subscription_expires_at)}</strong></p>}
        <p>Создан: {formatDate(user.created_at)} · Активность: {formatDate(user.last_active_at)}</p>
      </section>
      <section className="admin-tabs">
        {[
          ["overview", "Overview"],
          ["learning", "Learning"],
          ["games", "Game history"],
          ["subscription", "Subscription"],
          ["actions", "Actions"],
          ["logs", "Logs"],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </section>
      {tab === "overview" && (
        <section className="admin-columns">
          <AdminList title="Активность" items={(user.activity_timeline || []).map((item: any) => `${item.event_type}: ${item.count}`)} />
          <AdminList title="Сессии" items={[`Всего событий: ${user.total_sessions || 0}`, `Weak words: ${user.weak_words_count || 0}`, `Last active: ${formatDate(user.last_active_at)}`]} />
          <AdminList title="Лучший результат" items={[`Best score: ${user.best_score}`, `Accuracy: ${user.average_accuracy}%`]} />
        </section>
      )}
      {tab === "learning" && (
        <section className="admin-columns">
          <AdminList title="Последние изученные" items={(user.recent_learned_words || []).map((item: any) => `${item.english} — ${item.russian}`)} />
          <AdminList title="Слабые слова" items={(user.recent_wrong_words || []).map((item: any) => `${item.english} — ${item.russian}`)} />
          <AdminList title="Итоги" items={[`Learned: ${user.learned_words_count}`, `Unknown: ${user.unknown_words_count}`, `Reviewed: ${user.reviewed_words_count}`]} />
        </section>
      )}
      {tab === "games" && <AdminSimpleTable rows={user.game_history || []} columns={["created_at", "score", "correct_answers", "wrong_answers", "total_questions"]} />}
      {tab === "subscription" && <AdminSimpleTable rows={user.subscriptions || []} columns={["plan", "status", "source", "started_at", "expires_at"]} />}
      <section className="admin-actions">
        <button className="danger-action" onClick={() => setConfirm({ title: "Сбросить статистику?", action: "reset-stats" })}>Сбросить статистику</button>
        <button className="danger-action" onClick={() => setConfirm({ title: "Сбросить изученные слова?", action: "reset-words" })}>Сбросить слова</button>
        <button className="danger-action" onClick={() => setConfirm({ title: "Сбросить настройки?", action: "reset-settings" })}>Сбросить настройки</button>
        <button className="danger-action" onClick={() => setConfirm({ title: "Полностью сбросить прогресс?", action: "full-reset" })}>Полный сброс</button>
        {user.status === "banned" ? (
          <button className="primary-action" onClick={() => setConfirm({ title: "Разблокировать пользователя?", action: "unban" })}>Разблокировать</button>
        ) : (
          <button className="danger-action" onClick={() => setConfirm({ title: "Заблокировать пользователя?", action: "ban" })}>Заблокировать</button>
        )}
        <button className="primary-action" onClick={() => setConfirm({ title: "Выдать Premium на месяц?", action: "grant-premium?plan=monthly" })}>Выдать Premium на месяц</button>
        <button className="primary-action" onClick={() => setConfirm({ title: "Выдать Premium на год?", action: "grant-premium?plan=yearly" })}>Выдать Premium на год</button>
        {user.is_premium && (
          <button className="danger-action" onClick={() => setConfirm({ title: "Отозвать Premium?", action: "revoke-premium" })}>Отозвать Premium</button>
        )}
      </section>
      <section className="admin-card admin-custom-premium">
        <h3>Выдать Premium на срок</h3>
        <label>
          <span>Количество дней</span>
          <input
            type="number"
            min="1"
            max="3650"
            value={customPremiumDays}
            onChange={(event) => {
              setCustomPremiumDays(event.target.value);
              setCustomPremiumError("");
            }}
          />
        </label>
        <div className="admin-quick-actions">
          {[7, 14, 30, 90, 180, 365].map((days) => (
            <button key={days} className="quiet-action" onClick={() => setCustomPremiumDays(String(days))}>
              {days} дней
            </button>
          ))}
        </div>
        <label>
          <span>Причина / комментарий</span>
          <textarea value={customPremiumNote} onChange={(event) => setCustomPremiumNote(event.target.value)} />
        </label>
        {customPremiumError && <p className="danger-text">{customPremiumError}</p>}
        <button className="primary-action" onClick={confirmCustomPremiumGrant}>Выдать Premium на срок</button>
      </section>
      {tab === "logs" && <AdminSimpleTable rows={user.admin_logs || []} columns={["created_at", "admin_identifier", "action", "details"]} />}
      {confirm && (
        <div className="modal-backdrop compact">
          <section className="confirm-modal">
            <h2>{confirm.title}</h2>
            <p>Это действие нельзя отменить.</p>
            <div className="actions two">
              <button className="danger-action" onClick={() => runAction(confirm.action, confirm.body)}>Подтвердить</button>
              <button className="quiet-action" onClick={() => setConfirm(null)}>Отмена</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function AdminPayments({ refreshKey, globalSearch }: { refreshKey: number; globalSearch: string }) {
  const [pricing, setPricing] = useState<PremiumPlans | null>(null);
  const [monthlyPrice, setMonthlyPrice] = useState("99");
  const [yearlyPrice, setYearlyPrice] = useState("799");
  const [payments, setPayments] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    adminApi<PremiumPlans>("/premium-pricing").then((data) => {
      setPricing(data);
      setMonthlyPrice(String(data.monthly.price_stars));
      setYearlyPrice(String(data.yearly.price_stars));
    });
    const params = new URLSearchParams();
    if (globalSearch) params.set("search", globalSearch);
    adminApi<any>(`/payments?${params.toString()}`).then(setPayments);
  }

  useEffect(load, [refreshKey, globalSearch]);

  async function savePricing() {
    setSaving(true);
    try {
      const next = await adminApi<PremiumPlans>("/premium-pricing", {
        method: "POST",
        body: JSON.stringify({
          monthly_price_stars: Number(monthlyPrice),
          yearly_price_stars: Number(yearlyPrice),
        }),
      });
      setPricing(next);
      setMonthlyPrice(String(next.monthly.price_stars));
      setYearlyPrice(String(next.yearly.price_stars));
    } finally {
      setSaving(false);
    }
  }

  if (!pricing || !payments) return <p>Загружаем платежи...</p>;

  return (
    <>
      <AdminHeader title="Premium и платежи" subtitle="Цены Telegram Stars и история оплат" />
      <section className="admin-card">
        <h3>Premium pricing</h3>
        <div className="admin-filters">
          <input type="number" min="1" value={monthlyPrice} onChange={(event) => setMonthlyPrice(event.target.value)} placeholder="Monthly price in Stars" />
          <input type="number" min="1" value={yearlyPrice} onChange={(event) => setYearlyPrice(event.target.value)} placeholder="Yearly price in Stars" />
          <button className="primary-action" disabled={saving || Number(monthlyPrice) < 1 || Number(yearlyPrice) < 1} onClick={() => void savePricing()}>
            {saving ? "Сохраняем..." : "Save"}
          </button>
        </div>
      </section>
      <section className="admin-metric-grid">
        <AdminMetric label="Всего платежей" value={payments.total_payments} />
        <AdminMetric label="Оплачено" value={payments.paid_payments} />
        <AdminMetric label="Ожидают" value={payments.pending_payments} />
        <AdminMetric label="Failed" value={payments.failed_payments} />
        <AdminMetric label="Revenue Stars" value={payments.revenue_stars} />
      </section>
      <section className="admin-export-row">
        <button className="soft-action" onClick={() => downloadAdminCsv("/export/payments.csv", "wordy-payments.csv")}>Экспорт платежей CSV</button>
      </section>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr><th>Дата</th><th>Пользователь</th><th>Тариф</th><th>Stars</th><th>Статус</th><th>Оплачен</th><th>Charge ID</th></tr>
          </thead>
          <tbody>
            {(payments.items || []).map((payment: any) => (
              <tr key={payment.id}>
                <td>{formatDate(payment.created_at)}</td>
                <td>{payment.user.username ? `@${payment.user.username}` : payment.user.first_name || payment.user.telegram_id}</td>
                <td>{planLabel(payment.plan)}</td>
                <td>{payment.amount_stars}</td>
                <td><span className={`admin-status ${payment.status}`}>{payment.status}</span></td>
                <td>{payment.paid_at ? formatDate(payment.paid_at) : ""}</td>
                <td>{payment.charge_id || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AdminAnalytics() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi("/analytics").then(setData);
  }, []);
  if (!data) return <p>Загружаем аналитику...</p>;
  return (
    <>
      <AdminHeader title="Аналитика" subtitle="Сводки по активности, играм и словам" />
      <AdminDashboard />
      <section className="admin-columns">
        <AdminList title="Игры по дням" items={(data.daily_game_activity || []).map((item: any) => `${item.date}: ${item.count}`)} />
        <AdminList title="Изученные слова по дням" items={(data.daily_learned_words || []).map((item: any) => `${item.date}: ${item.count}`)} />
      </section>
    </>
  );
}

function AdminActivity({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi("/activity").then(setData);
  }, [refreshKey]);
  if (!data) return <p>Загружаем активность...</p>;
  return (
    <>
      <AdminHeader title="Активность" subtitle="События, funnel и retention" />
      <section className="admin-columns">
        <AdminList title="Events by type" items={(data.events_by_type || []).map((item: any) => `${item.event_type}: ${item.count}`)} />
        <AdminList title="Funnel" items={(data.funnel || []).map((item: any) => `${item.event_type}: ${item.users}`)} />
        <AdminList title="Retention" items={Object.entries(data.retention || {}).map(([key, value]: any) => `${key}: ${value.retention_rate}% (${value.retained}/${value.users})`)} />
      </section>
      <AdminSimpleTable rows={data.events_by_day || []} columns={["date", "event_type", "count"]} />
    </>
  );
}

function AdminLearning({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi("/learning").then(setData);
  }, [refreshKey]);
  if (!data) return <p>Загружаем обучение...</p>;
  return (
    <>
      <AdminHeader title="Обучение" subtitle="Слова, уровни, категории и проблемные места" />
      <section className="admin-metric-grid">
        <AdminMetric label="Среднее слов на пользователя" value={data.average_words_learned_per_user} />
        <AdminMetric label="Без обучения" value={data.users_with_no_learning_activity} />
        <AdminMetric label="Застряли на первой сессии" value={data.users_stuck_on_first_session} />
      </section>
      <section className="admin-columns">
        <AdminList title="Most learned" items={(data.most_learned_words || []).map((item: any) => `${item.english}: ${item.learned_count}`)} />
        <AdminList title="Most difficult" items={(data.most_difficult_words || []).map((item: any) => `${item.english}: ${item.unknown_count}`)} />
        <AdminList title="Категории" items={(data.categories || []).map((item: any) => `${item.category}: ${item.learned_count}`)} />
      </section>
      <AdminSimpleTable rows={data.words || []} columns={["english", "translation", "category", "level", "learned_count", "unknown_count", "error_rate"]} />
    </>
  );
}

function AdminWordy({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi("/wordy").then(setData);
  }, [refreshKey]);
  if (!data) return <p>Загружаем Wordy...</p>;
  return (
    <>
      <AdminHeader title="Wordy" subtitle="Игры, точность и лидерборды" />
      <section className="admin-metric-grid">
        <AdminMetric label="Всего игр" value={data.total_games} />
        <AdminMetric label="Игры сегодня" value={data.games_today} />
        <AdminMetric label="Средний счет" value={data.average_score} />
        <AdminMetric label="Лучший счет" value={data.best_score} />
        <AdminMetric label="Средняя точность" value={`${data.average_accuracy}%`} />
      </section>
      <section className="admin-columns">
        <AdminList title="Failed words" items={(data.most_failed_words || []).map((item: any) => `${item.english}: ${item.unknown_count}`)} />
        <AdminList title="Successful words" items={(data.most_successful_words || []).map((item: any) => `${item.english}: ${item.learned_count}`)} />
      </section>
      <h3 className="admin-section-title">Leaderboard by best score</h3>
      <AdminSimpleTable rows={data.leaderboard_by_best_score || []} columns={["user_id", "telegram_id", "username", "games_played", "best_score", "accuracy"]} />
    </>
  );
}

function AdminSubscriptions({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    adminApi("/subscriptions").then(setData);
  }, [refreshKey]);
  if (!data) return <p>Загружаем подписки...</p>;
  return (
    <>
      <AdminHeader title="Подписки" subtitle="Premium, Free, конверсия и тарифы" />
      <section className="admin-metric-grid">
        <AdminMetric label="Premium" value={data.premium_users} />
        <AdminMetric label="Active premium" value={data.active_premium} />
        <AdminMetric label="Expired" value={data.expired_premium} />
        <AdminMetric label="Cancelled" value={data.cancelled_premium} />
        <AdminMetric label="Free" value={data.free_users} />
        <AdminMetric label="Conversion" value={`${data.conversion_rate}%`} />
      </section>
      <AdminSimpleTable rows={data.items || []} columns={["user", "plan", "status", "source", "started_at", "expires_at"]} />
    </>
  );
}

function AdminContent({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  function load() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (category) params.set("category", category);
    if (level) params.set("level", level);
    adminApi(`/content/words?${params.toString()}`).then(setData);
  }
  useEffect(load, [refreshKey]);
  async function toggle(word: any) {
    if (!window.confirm(`${word.is_disabled ? "Включить" : "Отключить"} слово ${word.english}?`)) return;
    await adminApi(`/content/words/${word.id}/${word.is_disabled ? "enable" : "disable"}`, { method: "POST" });
    load();
  }
  return (
    <>
      <AdminHeader title="Контент" subtitle="Управление словами, импорт/экспорт и валидация дублей" />
      <section className="admin-filters">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="word, translation, transcription" />
        <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Категория" />
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">Все уровни</option>
          {LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="primary-action" onClick={load}>Найти</button>
        <button className="soft-action" onClick={() => downloadAdminCsv("/export/words.csv", "wordy-words.csv")}>Export CSV</button>
      </section>
      {data ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>English word</th><th>translation</th><th>transcription</th><th>example</th><th>category</th><th>level</th><th>learned</th><th>unknown</th><th>status</th><th>actions</th></tr></thead>
            <tbody>{(data.items || []).map((word: any) => (
              <tr key={word.id}>
                <td>{word.english}</td><td>{word.translation}</td><td>{word.transcription}</td><td>{word.example}</td><td>{word.category}</td><td>{word.level}</td><td>{word.learned_count}</td><td>{word.unknown_count}</td>
                <td><span className={`admin-status ${word.is_disabled ? "banned" : "active"}`}>{word.is_disabled ? "disabled" : "active"}</span></td>
                <td><button className={word.is_disabled ? "soft-action" : "danger-action"} onClick={() => toggle(word)}>{word.is_disabled ? "Enable" : "Disable"}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>Загружаем слова...</p>}
    </>
  );
}

function AdminCategories({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  function load() {
    adminApi("/categories/dashboard").then((nextData) => {
      setData(nextData);
      setSelected([]);
    });
  }
  useEffect(load, [refreshKey]);
  async function addCategory() {
    if (!name.trim()) return;
    await adminApi("/categories", { method: "POST", body: JSON.stringify({ name }) });
    setName("");
    load();
  }
  async function disable(category: string) {
    if (!window.confirm(`Отключить категорию ${category}? Слова будут скрыты, но не удалены.`)) return;
    await adminApi(`/categories/${encodeURIComponent(category)}/disable`, { method: "POST" });
    load();
  }
  async function setPremium(category: string, isPremium: boolean) {
    if (isPremium && !window.confirm("Сделать категорию платной?\nБесплатные пользователи потеряют доступ к этой категории.")) return;
    await adminApi(`/categories/${encodeURIComponent(category)}/premium`, {
      method: "PATCH",
      body: JSON.stringify({ is_premium: isPremium }),
    });
    load();
  }
  async function bulkPremium(isPremium: boolean) {
    if (!selected.length) return;
    if (isPremium && !window.confirm("Сделать выбранные категории платными?\nБесплатные пользователи потеряют доступ к этим категориям.")) return;
    if (!isPremium && !window.confirm("Сделать выбранные категории бесплатными?")) return;
    await adminApi("/categories/bulk-premium", {
      method: "POST",
      body: JSON.stringify({ categories: selected, is_premium: isPremium }),
    });
    load();
  }
  return (
    <>
      <AdminHeader title="Категории" subtitle="Словарь, монетизация, вовлечение и безопасное отключение категорий" />
      <section className="admin-filters compact">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Новая категория" />
        <button className="primary-action" onClick={addCategory}>Добавить</button>
      </section>
      <section className="admin-actions">
        <span className="admin-muted">Выбрано: {selected.length}</span>
        <button className="primary-action" disabled={!selected.length} onClick={() => void bulkPremium(true)}>Сделать Premium</button>
        <button className="soft-action" disabled={!selected.length} onClick={() => void bulkPremium(false)}>Сделать Free</button>
      </section>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th><input type="checkbox" checked={(data?.items || []).length > 0 && selected.length === (data?.items || []).length} onChange={(event) => setSelected(event.target.checked ? (data?.items || []).map((item: any) => item.category) : [])} /></th><th>Категория</th><th>Монетизация</th><th>Слов</th><th>Активные слова</th><th>Выбрали</th><th>Изучено</th><th>Engagement</th><th>Действия</th></tr></thead>
          <tbody>{(data?.items || []).map((item: any) => (
            <tr key={item.category}>
              <td><input type="checkbox" checked={selected.includes(item.category)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.category] : current.filter((category) => category !== item.category))} /></td>
              <td>{item.category}</td>
              <td><span className={`admin-status ${item.is_premium ? "premium" : "free"}`}>{item.is_premium ? "Premium" : "Free"}</span></td>
              <td>{item.word_count}</td>
              <td>{item.enabled_word_count}</td>
              <td>{item.active_users}</td>
              <td>{item.learned_count}</td>
              <td>{item.engagement}</td>
              <td>
                <div className="admin-row-actions">
                  {item.is_premium ? (
                    <button className="soft-action" onClick={() => void setPremium(item.category, false)}>Сделать Free</button>
                  ) : (
                    <button className="primary-action" onClick={() => void setPremium(item.category, true)}>Сделать Premium</button>
                  )}
                  <button className="danger-action" onClick={() => disable(item.category)}>Отключить</button>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

function AdminAdmins({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  const [telegramId, setTelegramId] = useState("");
  useEffect(() => {
    adminApi("/admins").then(setData);
  }, [refreshKey]);
  async function requestAction(path: string) {
    if (!window.confirm("Подтвердить административное действие?")) return;
    await adminApi(path, { method: "POST", body: JSON.stringify({ telegram_id: Number(telegramId) }) });
    setTelegramId("");
    adminApi("/admins").then(setData);
  }
  if (!data) return <p>Загружаем администраторов...</p>;
  return (
    <>
      <AdminHeader title="Администраторы" subtitle="Доступ, секреты и аудит админов" />
      <section className="admin-metric-grid">
        <AdminMetric label="Admin secret" value={data.admin_secret_configured ? "configured" : "missing"} />
        <AdminMetric label="Masked secret" value={data.admin_secret_masked} />
        <AdminMetric label="Current admin" value={data.current_admin} />
      </section>
      <section className="admin-card">
        <h3>Allowed Telegram admin IDs</h3>
        <p>{(data.allowed_telegram_admin_ids || []).join(", ") || "Нет данных"}</p>
        <div className="admin-actions">
          <input value={telegramId} onChange={(event) => setTelegramId(event.target.value)} placeholder="Telegram ID" />
          <button className="soft-action" onClick={() => requestAction("/admins/add")}>Запросить добавление</button>
          <button className="danger-action" onClick={() => requestAction("/admins/remove")}>Запросить удаление</button>
          <button className="danger-action" onClick={() => requestAction("/admins/rotate-secret")}>Rotate secret</button>
        </div>
      </section>
      <AdminSimpleTable rows={data.recent_audit_logs || []} columns={["created_at", "admin_identifier", "action", "target_user_id"]} />
    </>
  );
}

function AdminSettings({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<any>(null);
  useEffect(() => {
    adminApi("/settings").then(setSettings);
  }, [refreshKey]);
  async function save() {
    await adminApi("/settings", { method: "PATCH", body: JSON.stringify(settings) });
    adminApi("/settings").then(setSettings);
  }
  if (!settings) return <p>Загружаем настройки...</p>;
  return (
    <>
      <AdminHeader title="Настройки" subtitle="Лимиты, defaults и maintenance mode" />
      <section className="admin-card settings-grid">
        <label>App name<input value={settings.app_name || ""} onChange={(event) => setSettings({ ...settings, app_name: event.target.value })} /></label>
        <label>Support text<input value={settings.support_contact_text || ""} onChange={(event) => setSettings({ ...settings, support_contact_text: event.target.value })} /></label>
        <label>Free learned limit<input type="number" value={settings.free_daily_learned_words_limit || 0} onChange={(event) => setSettings({ ...settings, free_daily_learned_words_limit: Number(event.target.value) })} /></label>
        <label>Free game limit<input type="number" value={settings.free_daily_game_limit || 0} onChange={(event) => setSettings({ ...settings, free_daily_game_limit: Number(event.target.value) })} /></label>
        <label>Default level<select value={settings.default_level || "A1"} onChange={(event) => setSettings({ ...settings, default_level: event.target.value })}>{LEVELS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="check-row"><input type="checkbox" checked={Boolean(settings.maintenance_mode)} onChange={(event) => setSettings({ ...settings, maintenance_mode: event.target.checked })} /> Maintenance mode</label>
        <button className="primary-action" onClick={save}>Сохранить</button>
      </section>
    </>
  );
}

function AdminLogs({ refreshKey }: { refreshKey: number }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [action, setAction] = useState("");
  useEffect(() => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    adminApi<any>(`/logs?${params.toString()}`).then((data) => setLogs(data.items));
  }, [refreshKey, action]);
  return (
    <>
      <AdminHeader title="Аудит лог" subtitle="Действия администраторов" />
      <section className="admin-filters compact">
        <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Тип действия" />
      </section>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Дата</th><th>Админ</th><th>Действие</th><th>Пользователь</th><th>Детали</th></tr></thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDate(log.created_at)}</td>
                <td>{log.admin_identifier}</td>
                <td>{log.action}</td>
                <td>{log.target_user_id || ""}</td>
                <td>{JSON.stringify(log.details || {})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function downloadAdminCsv(path: string, filename: string) {
  const csv = await adminApi<string>(path);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function AdminSimpleTable({ rows, columns }: { rows: any[]; columns: string[] }) {
  if (!rows.length) return <section className="admin-card empty-state">Нет данных</section>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || index}>
              {columns.map((column) => (
                <td key={column}>{formatAdminCell(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatAdminCell(value: any) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("username" in value || "telegram_id" in value || "first_name" in value) {
      return value.username ? `@${value.username}` : value.first_name || value.telegram_id || "";
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
  return String(value);
}

function AdminExportButtons() {
  return (
    <section className="admin-export-row">
      <button className="soft-action" onClick={() => downloadAdminCsv("/export/users.csv", "wordy-users.csv")}>Экспорт пользователей CSV</button>
      <button className="soft-action" onClick={() => downloadAdminCsv("/export/stats.csv", "wordy-stats.csv")}>Экспорт статистики CSV</button>
      <button className="soft-action" onClick={() => downloadAdminCsv("/export/learned.csv", "wordy-learned.csv")}>Экспорт слов CSV</button>
    </section>
  );
}

function AdminHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="admin-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function AdminMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="admin-metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function AdminList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="admin-card">
      <h3>{title}</h3>
      {items.length ? items.map((item) => <p key={item}>{item}</p>) : <p>Нет данных</p>}
    </section>
  );
}

function formatCategories(categories: string[] | null) {
  if (categories === null) return "Не выбраны";
  if (categories.length === 0) return ALL_CATEGORIES_LABEL;
  return categories.join(", ");
}

function formatDate(value?: string | null) {
  if (!value) return "нет данных";
  return new Date(value).toLocaleString("ru-RU");
}

function OutsideTelegramView() {
  return (
    <main className="telegram-only-screen">
      <section className="telegram-only-card">
        <p className="eyebrow">Wordy</p>
        <h1>Откройте приложение через Telegram</h1>
        <p>Для использования Wordy необходимо открыть приложение внутри Telegram.</p>
        <a className="telegram-open-button" href={TELEGRAM_OPEN_URL}>Открыть в Telegram</a>
      </section>
    </main>
  );
}

function BannedUserView() {
  return (
    <main className="telegram-only-screen">
      <section className="telegram-only-card">
        <p className="eyebrow">Wordy</p>
        <h1>Доступ ограничен</h1>
        <p>Ваш аккаунт был заблокирован.</p>
      </section>
    </main>
  );
}

function TelegramGate() {
  const [status, setStatus] = useState<"checking" | "allowed" | "blocked" | "banned">("checking");
  useEffect(() => {
    let cancelled = false;
    async function authorizeTelegramWebApp() {
      const initData = await waitForTelegramInitData();
      if (!initData) {
        if (!cancelled) setStatus("blocked");
        return;
      }
      try {
        await api<TelegramUser>("/auth/telegram");
        if (!cancelled) setStatus("allowed");
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!cancelled) setStatus(message.includes("User is banned") ? "banned" : "blocked");
      }
    }
    void authorizeTelegramWebApp();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") {
    return (
      <main className="telegram-only-screen">
        <section className="telegram-only-card">
          <p className="eyebrow">Wordy</p>
          <h1>Проверяем вход через Telegram</h1>
        </section>
      </main>
    );
  }
  if (status === "banned") return <BannedUserView />;
  if (status === "blocked") return <OutsideTelegramView />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  window.location.pathname.startsWith("/admin") ? <AdminApp /> : <TelegramGate />,
);
