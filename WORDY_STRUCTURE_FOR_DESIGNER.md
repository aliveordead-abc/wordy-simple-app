# Wordy Structure For Designer

Source inspected: `/root/simple-app` on 2026-06-15. This document is an application map for redesign work only. It describes what exists in code today and what must not break.

==================================================
## 1. PROJECT STRUCTURE
==================================================

### Main folders and files

- `frontend/`
  - React + Vite frontend.
  - The full user Mini App and admin panel are implemented in `frontend/src/main.tsx`.
  - Global visual system and all screen styles are in `frontend/src/styles.css`.
  - `frontend/index.html` loads Telegram WebApp JS and mounts React into `#root`.

- `frontend/src/`
  - `main.tsx`: app bootstrap, Telegram gate, user app navigation, all user screens, all admin screens, API helpers, shared UI components, admin tables/forms.
  - `styles.css`: global tokens, mobile app shell, bottom nav, cards, buttons, games, profile, premium, modals, admin layout, responsive breakpoints.
  - `vite-env.d.ts`: Vite type definitions.

- `frontend/dist/`
  - Built production frontend output. Do not redesign from this folder; use source files.

- `backend/`
  - FastAPI backend and data model.
  - `backend/app/main.py`: all public API routes, Telegram auth, user state, words, stats, premium, payments, admin APIs.
  - `backend/app/models.py`: database entities: users, settings, words, progress, stats, subscriptions, payments, admin audit logs, activity events.
  - `backend/app/schemas.py`: API request/response schemas.
  - `backend/data/words.csv`: seed word list.
  - `backend/admin/configure_telegram_bot.py`: operational bot setup helper.
  - `backend/Dockerfile`: API image build.

- `nginx/`
  - `nginx/default.conf`: HTTPS host, `/api/` proxy to FastAPI, `/sounds/` serving, SPA fallback to `index.html`.
  - `nginx/Dockerfile`: builds frontend with Node, then serves static files from nginx.

- Docker files
  - `docker-compose.yml`: Postgres, API, nginx services.
  - `backend/Dockerfile`: backend container.
  - `nginx/Dockerfile`: frontend build + nginx runtime.

- `public/assets`
  - There is no `public/assets/` folder in the current project.
  - Current public visual asset: `public/wordy-icon.svg`, used by the admin sidebar brand.

- `public/sounds/`
  - `correct.mp3`: correct-answer feedback.
  - `wrong.mp3`: wrong-answer feedback.
  - Used by training and Wordy game answer feedback.

- Design-related files
  - Primary: `frontend/src/styles.css`.
  - Component markup and UI state classes: `frontend/src/main.tsx`.
  - Brand/admin icon asset: `public/wordy-icon.svg`.

==================================================
## 2. USER APP NAVIGATION
==================================================

### Route/gate structure

- App root is rendered from `frontend/src/main.tsx` at `createRoot(...)`.
- If URL starts with `/admin`, `AdminApp` renders.
- Otherwise `TelegramGate` renders the Telegram Mini App gate, then `App`.

### Telegram gate screens

- Checking: "Проверяем вход через Telegram".
- Blocked/outside Telegram: "Откройте приложение через Telegram" with Telegram open link.
- Banned: "Доступ ограничен".

### Bottom navigation

Defined in `NAV_ITEMS` in `frontend/src/main.tsx`.

- `home`: Главная
- `learn`: Учить
- `game`: Wordy
- `profile`: Профиль

Important: `Tab` type includes `"stats"`, and `StatsView` can render as a root tab in code, but `stats` is not present in the visible bottom nav. Current visible navigation has 4 items.

### Root screens

- Home: `HomeView`
- Learn menu: `TrainingView`
- New Words: `LearnView`, entered from Learn menu or Home continue
- Wordy game: `GameView`
- Profile: `ProfileView`
- Stats: `StatsView`, rendered from Profile nested screen; also supported by root `tab === "stats"` but not navigable from bottom nav.

### Nested/fullscreen screens

Screens that hide bottom nav:

- New Words learning session: `learnMode === "cards"`.
- Training sessions: Choose Translation and Match Pairs when `TrainingView.mode !== null`.
- Wordy game tab always hides bottom nav.
- Profile nested screens: settings, categories, premium, stats.
- First launch setup screens.

### Screens opened from Profile

- Profile main -> settings: level/category settings.
- Profile settings -> category selector.
- Profile main -> Premium.
- Profile main -> Statistics.
- Locked category in category selector -> Premium prompt.

### Screens opened from Learn

- Learn menu -> New Words.
- Learn menu -> Choose Translation.
- Learn menu -> Match Pairs.
- Learn menu contains a disabled/locked "Сложные слова" card, but no screen exists for it.

### Screens opened from Premium/locked categories

- Locked category chip opens `PremiumScreen` with `categoryLockedPrompt`.
- Free daily limit screen opens Premium by switching to Profile/Premium entry context.
- Profile Premium card opens `PremiumScreen`.

==================================================
## 3. USER APP SCREENS
==================================================

### Home

- Code: `frontend/src/main.tsx`, `HomeView`.
- Purpose: daily dashboard and quick continuation.
- Entry: bottom nav "Главная"; initial `tab` is `home`.
- Main UI blocks: app heading, stats hero, daily goal card, continue lesson card, word-of-day card, Premium upsell for free users.
- Buttons/actions: continue lesson, pronounce word of day, try Premium.
- States: Premium/free badge, stats loaded or missing fallback, daily limit progress.
- Data used: `/stats/me`, `me.settings`, `me.subscription`, Telegram user first name.
- Layout notes: mobile root tab shell with bottom nav; content needs bottom padding.
- Designer should provide: mobile home frame, Premium/free variants, stats empty/loading treatment, word-of-day card, continue card, safe bottom-nav spacing.

### Learn Menu

- Code: `frontend/src/main.tsx`, `TrainingView` menu state.
- Purpose: choose learning/training mode.
- Entry: bottom nav "Учить".
- Main UI blocks: heading, intro copy, four training mode cards.
- Buttons/actions: New Words, Choose Translation, Match Pairs, disabled "Сложные слова".
- States: loading disables training modes if words are unavailable; message for not enough words; no categories selected empty state.
- Data used: selected settings, `/words`.
- Layout notes: bottom nav visible only on menu; training session cards use icon blocks and chips.
- Designer should provide: menu cards, disabled/locked card, loading/empty state, selected/pressed card states.

### New Words

- Code: `frontend/src/main.tsx`, `LearnView`, `LearningFlashcard`.
- Purpose: flashcard learning flow for new or reviewed words.
- Entry: Home "Продолжить урок" or Learn menu "Новые слова".
- Main UI blocks: progress card, optional free-limit copy, flip flashcard, speaker button, rating buttons.
- Buttons/actions: reveal card, pronounce, "Не знаю", "Знаю", repeat learned words, change category.
- States: loading, no categories, no words, all learned, card front/back, success animation, error animation, daily limit reached.
- Data used: `/words/next`, `/words/{id}/learned`, `/words/{id}/unknown`, subscription limits.
- Layout notes: fullscreen learning shell; bottom nav hidden; current CSS makes `learn-top-card` hidden.
- Designer should provide: flashcard front/back, reveal state, answer states, all-learned state, loading and empty states, daily limit state.

### Choose Translation

- Code: `frontend/src/main.tsx`, `TranslationChoice`.
- Purpose: 10-round multiple-choice translation training.
- Entry: Learn menu "Выбери перевод".
- Main UI blocks: back button, progress/status header, word card with speaker, option buttons, result card.
- Buttons/actions: back, pronounce, choose option, restart, go to words.
- States: loading/not enough words, active question, selected correct, selected wrong, feedback toast, complete result.
- Data used: words from `/words`, local round/correct/wrong/streak/xp state.
- Layout notes: fullscreen; bottom nav hidden; uses sound/haptics.
- Designer should provide: game-like training frame, option states, toast, progress bar, result screen, compact small-device layout.

### Match Pairs

- Code: `frontend/src/main.tsx`, `MatchWords`.
- Purpose: match English words to translations.
- Entry: Learn menu "Соедини пары".
- Main UI blocks: back button, progress/status header, helper text, two-column match board, mini result.
- Buttons/actions: select left word, select right translation, next round, back.
- States: loading/not enough words, left selected, matched/locked, wrong shake, complete round, XP display.
- Data used: words from `/words`, local matched/mistake/streak/xp state.
- Layout notes: fullscreen; two-column board must remain usable at 375px width.
- Designer should provide: selected/locked/wrong states, complete state, two-column responsive behavior.

### Wordy

- Code: `frontend/src/main.tsx`, `GameView`.
- Purpose: 60-second true/false translation speed game.
- Entry: bottom nav "Wordy".
- Main UI blocks: game header, timer/score/streak row, free-limit copy, game card, answer buttons, result screen, result modal.
- Buttons/actions: start game, pronounce word, "Верно", "Неверно", play again, review errors.
- States: no categories, loading/not enough words, idle, running, paused by navigation attempt, success/error answer animation, limit reached, completed result, review errors modal, confirm exit modal.
- Data used: `/words`, `/game/start`, `/game/result`, subscription game limits.
- Layout notes: fullscreen; bottom nav hidden; navigation away during active game prompts confirm modal.
- Designer should provide: idle/running/result states, timer pressure state, correct/wrong animations, exit confirmation, error review UI.

### Profile Main

- Code: `frontend/src/main.tsx`, `ProfileView` main state.
- Purpose: account overview, learning settings summary, Premium entry, management links.
- Entry: bottom nav "Профиль".
- Main UI blocks: avatar/profile card, summary cards, current plan/settings card, Premium card, settings list.
- Buttons/actions: edit settings, open Premium, open Statistics.
- States: Telegram avatar or initials, loading profile fallback, Premium/free status, categories selected/not selected, locked selected category chip.
- Data used: Telegram user, `/stats/me`, settings, categories, subscription.
- Layout notes: root tab screen with bottom nav.
- Designer should provide: profile header, avatar fallbacks, stat cards, settings rows, disabled rows for Notifications/Language.

### Profile Settings

- Code: `frontend/src/main.tsx`, `ProfileView` screen `"settings"`.
- Purpose: edit selected categories and level.
- Entry: Profile main "Изменить", Level row, Categories row.
- Main UI blocks: back button, hero, category trigger, Premium helper copy, level segmented grid, save button.
- Buttons/actions: back, open category selector, select level, save.
- States: saving, active level, categories loading, free user with locked categories.
- Data used: settings draft, categories, subscription.
- Layout notes: fullscreen; bottom nav hidden.
- Designer should provide: settings form, sticky/save behavior if needed, validation/saving states.

### Categories

- Code: `frontend/src/main.tsx`, `CategorySelectionScreen`.
- Purpose: choose all categories or multiple categories.
- Entry: first launch setup category step; Profile settings category trigger.
- Main UI blocks: back button, hero, scrollable category grid, sticky action row.
- Buttons/actions: all categories, category toggle, locked category -> Premium, cancel, save.
- States: all active, category active, locked category, Premium badge, applying/saving.
- Data used: `/categories`, selected category IDs, subscription lock metadata.
- Layout notes: fullscreen; bottom nav hidden; current category grid is two columns on mobile.
- Designer should provide: category card grid, active/locked/Premium states, sticky footer, empty/loading state.

### Premium

- Code: `frontend/src/main.tsx`, `PremiumScreen`, `PlanCard`, `PremiumProfileCard`.
- Purpose: explain Premium, show plans, open Telegram Stars invoice, manage active subscription.
- Entry: Profile Premium card, locked category prompt, free limit screen.
- Main UI blocks: hero, locked-category card if applicable, current status, benefits, monthly/yearly plan cards, dev fake payment cards when enabled, payment step screen, active subscription screen.
- Buttons/actions: back, open Premium, pay, open invoice, check status, cancel payment, fake confirm in dev, cancel subscription.
- States: free, locked-category prompt, selected plan/payment pending, invoice link ready, busy, payment success, active subscription, admin-granted Premium, fake payments enabled.
- Data used: `/subscription/plans`, `/subscription/telegram-stars/create-invoice`, `/subscription/fake-checkout`, `/subscription/fake-confirm`, `/subscription/cancel`, refreshed `/me`.
- Layout notes: fullscreen; bottom nav hidden; payment uses Telegram WebApp invoice APIs.
- Designer should provide: Premium sales screen, locked prompt, plan cards, active subscription management, payment pending/success/error states.

### Statistics

- Code: `frontend/src/main.tsx`, `StatsView`.
- Purpose: progress and accuracy metrics.
- Entry: Profile main -> Statistics; root `tab === "stats"` exists but is not in bottom nav.
- Main UI blocks: hero, accuracy card with progress bar, metric grid.
- Buttons/actions: none inside `StatsView`; Profile nested version adds back button.
- States: loading text, Premium badge if premium.
- Data used: `/stats/me`, subscription.
- Layout notes: nested Profile stats hides bottom nav.
- Designer should provide: metric cards, loading state, empty/zero state, Premium visual treatment.

### First Launch Setup

- Code: `frontend/src/main.tsx`, `SetupFlowScreen`.
- Purpose: require initial level/category setup when profile settings are incomplete.
- Entry: automatic when `needsSetup` is true after profile load.
- Main UI blocks: setup hero, level selector, category trigger, disabled placement test card, footer validation/save.
- Buttons/actions: choose level, open categories, disabled "Проверить уровень", start learning.
- States: setup, category selector, premium prompt from locked category, selected level, validation missing level, saving, save error.
- Data used: categories, settings save endpoint, subscription.
- Layout notes: full setup shell, no bottom nav.
- Designer should provide: onboarding frame, validation, category subflow, locked category Premium subflow, disabled future placement test.

### Limit Screen

- Code: `frontend/src/main.tsx`, `LimitReachedView`.
- Purpose: free daily limit reached for learned words or Wordy games.
- Entry: `LearnView` catches `daily_learned_words_limit_reached`; `GameView` catches `daily_wordy_games_limit_reached`.
- Main UI blocks: result hero, upgrade button.
- Buttons/actions: go to Premium.
- States: same view for learning/game limits; copy is generic.
- Data used: subscription limits via `/me` refresh.
- Layout notes: fullscreen in active flow.
- Designer should provide: limit reached screen with Premium CTA, optional variants for word limit and game limit.

### Banned Screen

- Code: `frontend/src/main.tsx`, `BannedUserView`.
- Purpose: prevent banned users from entering app.
- Entry: `TelegramGate` when `/auth/telegram` error includes "User is banned".
- Main UI blocks: single card with title and message.
- Buttons/actions: none.
- States: static.
- Data used: `/auth/telegram`.
- Layout notes: centered full viewport; outside app shell.
- Designer should provide: blocked account screen.

### Loading/Error/Gate Screens

- Code: `frontend/src/main.tsx`, `TelegramGate`, `OutsideTelegramView`, app-level `notice`, loading returns across screens.
- Purpose: auth check, outside-Telegram handling, generic load failures.
- Entry: before app, API failures, empty data.
- Main UI blocks: Telegram-only card, notice banners, text loading states, empty cards.
- Buttons/actions: outside Telegram link.
- States: checking, blocked/outside Telegram, auth/category/profile error notice, loading words, loading stats, loading admin data.
- Data used: Telegram initData, `/auth/telegram`, `/me`, `/categories`.
- Layout notes: Telegram-only screens are centered; notices render near top of app shell.
- Designer should provide: unified loading, empty, error, offline/retry pattern.

==================================================
## 4. ADMIN PANEL STRUCTURE
==================================================

Admin lives in the same React file. It renders when `window.location.pathname.startsWith("/admin")`.

### Admin Shell / Navigation

- Code: `frontend/src/main.tsx`, `AdminApp`, `ADMIN_NAV`, `AdminTopbar`.
- Purpose: desktop-first admin layout.
- Entry: `/admin/...`.
- Main UI blocks: left sidebar, grouped nav, brand, admin identity, sticky topbar, global search, refresh button, content area.
- States: checking access, authorized, unauthorized -> login.
- Designer should provide: desktop shell, tablet/mobile admin adaptation, nav active state, topbar/search/refresh states.

### Admin Login

- Code: `frontend/src/main.tsx`, `AdminLogin`.
- Purpose: secret-based admin login when Telegram admin auth is not available.
- Entry: any `/admin` path without valid admin auth.
- Main UI blocks: centered login card, password input, error notice, submit button.
- Actions: enter `ADMIN_SECRET`, log in.
- States: empty input disabled, invalid secret error.
- Designer should provide: login desktop frame, error state, focus/disabled states.

### Dashboard / Overview

- Code: `frontend/src/main.tsx`, `AdminOverview`.
- Purpose: product, learning, operations, and monetization overview.
- Entry: `/admin/dashboard` or `/admin/overview`.
- Main UI blocks: metric grid, list cards for growth/activity/game/conversions/revenue/operations, top categories, levels, latest admin actions.
- Actions: refresh from topbar.
- States: loading text.
- Designer should provide: metric cards, list cards, loading/empty states, chart/table alternatives if redesigning analytics.

### Users

- Code: `frontend/src/main.tsx`, `AdminUsers`.
- Purpose: search/filter users and bulk manage accounts.
- Entry: `/admin/users`.
- Main UI blocks: filters, export buttons, bulk action bar, large user table.
- Actions: search, filter by status/premium/level/category, select rows, export selected, ban/unban, reset stats, grant/revoke Premium, open user detail.
- States: selected rows, no results currently appears as empty table body, status badges active/banned/free/premium.
- Designer should provide: filters, table, selection, bulk actions, empty state, dangerous action confirmation pattern.

### User Detail

- Code: `frontend/src/main.tsx`, `AdminUserDetail`.
- Purpose: inspect one user and perform account actions.
- Entry: `/admin/users/{id}` from Users table.
- Main UI blocks: back button, user metrics, profile summary, tab bar, detail lists/tables, action bar, custom Premium form, confirm modal.
- Actions: reset stats, reset words, reset settings, full reset, ban/unban, grant monthly/yearly/custom Premium, revoke Premium.
- States: loading user, tabs overview/learning/games/subscription/actions/logs, confirm modal, custom Premium validation.
- Designer should provide: detail page, tab states, destructive confirmation modal, custom grant form, activity/history tables.

### Activity

- Code: `frontend/src/main.tsx`, `AdminActivity`.
- Purpose: event analytics, funnel, retention.
- Entry: `/admin/activity`.
- Main UI blocks: list cards and events-by-day table.
- Actions: refresh.
- States: loading, empty table.
- Designer should provide: analytics list/cards, retention visualization, loading/empty states.

### Learning Analytics

- Code: `frontend/src/main.tsx`, `AdminLearning`.
- Purpose: learning metrics and word difficulty.
- Entry: `/admin/learning`.
- Main UI blocks: metric grid, most learned/difficult/category list cards, words analytics table.
- Actions: refresh.
- States: loading, empty table.
- Designer should provide: metric cards, difficulty lists, large table design.

### Wordy Analytics

- Code: `frontend/src/main.tsx`, `AdminWordy`.
- Purpose: game metrics and leaderboard.
- Entry: `/admin/wordy`.
- Main UI blocks: metric grid, failed/successful words list cards, leaderboard table.
- Actions: refresh.
- States: loading, empty table.
- Designer should provide: leaderboard table, game KPI cards, empty/loading states.

### Subscriptions

- Code: `frontend/src/main.tsx`, `AdminSubscriptions`.
- Purpose: Premium/free subscription overview.
- Entry: `/admin/subscriptions`.
- Main UI blocks: metric grid, subscription table.
- Actions: refresh.
- States: loading, empty table, active/expired/cancelled badges.
- Designer should provide: subscription status cards and table.

### Payments

- Code: `frontend/src/main.tsx`, `AdminPayments`.
- Purpose: Telegram Stars pricing and payment history.
- Entry: `/admin/payments`.
- Main UI blocks: pricing form, payment metrics, export row, payment table.
- Actions: edit monthly/yearly Stars price, save, export payments CSV, global search.
- States: loading, saving, paid/pending/failed/cancelled badges.
- Designer should provide: pricing form, payment KPI cards, table, saving/validation states.

### Content

- Code: `frontend/src/main.tsx`, `AdminContent`.
- Purpose: manage word content visibility and export words.
- Entry: `/admin/content`.
- Main UI blocks: search/category/level filters, export CSV button, words table.
- Actions: find words, export CSV, enable/disable word.
- States: loading words, enabled/disabled badges, browser confirm for toggle.
- Designer should provide: content table, filters, row action states, empty state.

### Categories

- Code: `frontend/src/main.tsx`, `AdminCategories`.
- Purpose: manage category monetization and disable categories.
- Entry: `/admin/categories`.
- Main UI blocks: add category form, selected count/bulk monetization actions, category table.
- Actions: add category, select rows, make Premium/Free, disable category.
- States: selected rows, Premium/Free badges, browser confirm for paid/disable changes.
- Designer should provide: category management table, bulk action bar, confirmation pattern.

### Administrators

- Code: `frontend/src/main.tsx`, `AdminAdmins`.
- Purpose: show admin access configuration and audit subset.
- Entry: `/admin/admins`.
- Main UI blocks: admin secret metrics, allowed Telegram IDs card, action input/buttons, audit table.
- Actions: request add/remove admin ID, request secret rotation.
- States: loading, empty allowed IDs, browser confirm.
- Designer should provide: admin access screen, sensitive-action styling, audit list.

### Logs

- Code: `frontend/src/main.tsx`, `AdminLogs`.
- Purpose: admin audit log.
- Entry: `/admin/logs`.
- Main UI blocks: action filter, logs table.
- Actions: filter by action.
- States: empty table.
- Designer should provide: audit log table, filtering, empty/loading state.

### Settings

- Code: `frontend/src/main.tsx`, `AdminSettings`.
- Purpose: app-level settings and maintenance mode.
- Entry: `/admin/settings`.
- Main UI blocks: settings form grid.
- Actions: edit app name, support text, free limits, default level, maintenance mode; save.
- States: loading, checkbox state.
- Designer should provide: settings form, save feedback, boolean toggles, validation.

### Admin screens present in code but not routed

- `AdminAnalytics` exists in `frontend/src/main.tsx`, but it is not included in `ADMIN_NAV` and is not rendered by `AdminApp`.
- `AdminDashboard` exists as a wrapper around `AdminOverview`, but `AdminApp` renders `AdminOverview` directly.

==================================================
## 5. COMPONENT INVENTORY
==================================================

### Buttons

- Code/style: `.btn`, `.primary-action`, `.premium-action`, `.soft-action`, `.quiet-action`, `.danger-action`, `.rating-button`, `.icon-button`.
- Used in almost every user and admin screen.
- Current issue: several semantically different actions share pill styling; destructive actions rely mainly on red tint.
- Designer should specify: primary/secondary/quiet/danger/premium/disabled/loading/pressed/focus states.

### Cards

- Code/style: `.card`, `.hero-panel`, `.learn-top-card`, `.profile-*card`, `.premium-*`, `.admin-card`, `.metric-card`.
- Used across Home, Learn, Wordy, Profile, Premium, Stats, Admin.
- Current issue: many card variants are CSS class combinations, not separate components.
- Designer should specify: card hierarchy, padding, radius, hero vs content vs metric variants.

### Chips and badges

- Code/style: `.badge`, `.premium-badge`, `.plan-badge`, `.category-premium-badge`, `.chip`, `.admin-status`.
- Used for Premium, levels, limits, categories, statuses.
- Current issue: some statuses use emoji text, some use icons, some use plain badges.
- Designer should specify: level chip, status badge, Premium badge, locked badge, selected chip.

### Bottom nav

- Code/style: `NAV_ITEMS`, `.bottom-nav`.
- Used in user root tabs only.
- Current issue: only 4 visible tabs although code has `stats` as a possible tab.
- Designer should specify: active/inactive icons, labels, safe-area spacing, tap target, hidden states.

### Headers

- Code/style: `.apphead`, `.stats-hero`, `.premium-hero`, `.result-hero`, `.admin-header`, `.admin-topbar`.
- Used across user root/nested screens and admin.
- Current issue: Telegram already provides native Mini App header; app-level topbar is hidden.
- Designer should specify: screen title treatment without duplicating Telegram native header.

### Tables

- Code/style: `.admin-table-wrap`, `.admin-table`, `AdminSimpleTable`.
- Used throughout admin.
- Current issue: many tables are very wide and horizontally scroll.
- Designer should specify: desktop table density, sticky headers, horizontal scroll, empty/loading rows, status cells.

### Forms

- Code/style: inputs/selects in admin filters/settings/login, level/category selectors in user app.
- Used in setup, profile settings, admin login, users filters, settings, payments, content, categories.
- Current issue: form controls are mostly untyped visually; browser confirms are used for dangerous admin actions.
- Designer should specify: text input, password input, select, checkbox/toggle, textarea, validation, save feedback.

### Category selector

- Code: `CategoryMultiSelect`, `CategorySelectionScreen`.
- Used in first launch and Profile settings.
- Current issue: same category screen handles onboarding and profile; locked categories route to Premium.
- Designer should specify: all-categories state, multi-select state, locked state, Premium badge, sticky footer.

### Premium cards

- Code: `PremiumProfileCard`, `PremiumScreen`, `PlanCard`.
- Used in Profile, locked categories, free limit.
- Current issue: payment flow has multiple states but limited visual distinction.
- Designer should specify: sales card, plan comparison, active subscription state, invoice pending state, success state, admin-granted state.

### Game/training cards

- Code: `LearningFlashcard`, `TranslationChoice`, `MatchWords`, `GameView`.
- Used in New Words, Choose Translation, Match Pairs, Wordy.
- Current issue: interactive answer feedback is CSS animation/state class based.
- Designer should specify: reveal animation, correct/wrong state, selected state, locked state, timer/result states.

### Stats cards

- Code: `MetricCard`, `AdminMetric`.
- Used in Profile, Stats, training result, Wordy result, admin dashboards.
- Current issue: user/admin metric cards share visual ideas but different CSS.
- Designer should specify: number hierarchy, captions, color coding, zero/empty values.

### Loading states

- Code: `.loader`, text returns like "Загружаем...", `AdminSimpleTable` empty card.
- Used in flashcards, training empty, stats, admin pages.
- Current issue: inconsistent loading presentation.
- Designer should specify: app-wide loading component and table loading skeletons.

### Error states

- Code: `.notice`, `OutsideTelegramView`, `BannedUserView`, validation messages, confirm modals.
- Used at app shell, gate, setup validation, admin login, dangerous actions.
- Current issue: generic API errors mostly become simple text/notice.
- Designer should specify: error banner, validation, blocked state, retry state, destructive confirm state.

==================================================
## 6. APP FLOWS
==================================================

### 1. First launch

Telegram Mini App opens -> `TelegramGate` waits for Telegram initData -> `/auth/telegram` -> `App` loads `/me` and `/categories` -> if level/category missing, `SetupFlowScreen` -> choose level -> choose category/all categories -> save `/me/settings` -> app root.

### 2. Learning

Home or Learn -> New Words -> `/words/next` -> tap card to reveal -> pronounce optional -> rate `Знаю` or `Не знаю` -> POST learned/unknown -> feedback animation -> next word.

### 3. Training

Learn -> Choose Translation -> 10 rounds -> select answer -> correct/wrong feedback + sound/haptics -> result -> restart or go to words.

Learn -> Match Pairs -> select English word -> select translation -> matched/wrong feedback -> complete round -> next round or back.

### 4. Game

Wordy -> load words -> Start game -> `/game/start` checks daily limit -> 60-second true/false prompts -> answer feedback -> timer ends -> `/game/result` -> result screen -> optionally review errors.

### 5. Profile

Profile -> edit settings -> choose level/category -> save settings.

Profile -> Premium -> plan/payment/active subscription management.

Profile -> Statistics -> progress metrics.

### 6. Premium

Locked category -> Premium prompt -> select plan -> Telegram Stars invoice -> payment status refresh -> active Premium.

Free limit -> Limit screen -> Premium.

Profile -> Premium card -> Premium plans or active management.

### 7. Admin

`/admin` -> check `/admin/api/me` -> if unauthorized, secret login -> dashboard -> sidebar navigation -> user management and analytics. Users table -> user detail -> destructive actions require confirmation.

==================================================
## 7. DESIGN REQUIREMENTS FOR DESIGNER
==================================================

For user app, deliver mobile-first frames at 390x844 for:

- Telegram gate: checking, outside Telegram, banned.
- First launch setup: default, level selected, category subflow, validation, saving, locked category Premium prompt.
- Home: free and Premium.
- Learn menu: normal, loading/not enough words, locked training card.
- New Words: loading, front card, revealed card, correct, wrong, all learned, no category, no words, daily limit.
- Choose Translation: question, selected correct, selected wrong, toast, complete result, not enough words.
- Match Pairs: no selection, selected left, matched/locked, wrong shake, complete result.
- Wordy: idle, running, correct/wrong feedback, paused/exit confirm, limit reached, result, review errors.
- Profile: free, Premium, no categories, locked category chip, stats loading.
- Profile settings/categories: active level, selected categories, locked categories, saving.
- Premium: free plans, locked category variant, payment pending, invoice actions, success/active, admin-granted Premium, cancellation.
- Statistics: loading, zero/empty, populated.

For admin, deliver desktop-first frames for:

- Login.
- Shell/sidebar/topbar.
- Dashboard.
- Users table and filters.
- User detail with tabs and confirm modal.
- Activity, Learning, Wordy analytics.
- Subscriptions.
- Payments and pricing.
- Content words table.
- Categories management.
- Administrators.
- Logs.
- Settings.

Required states across the design system:

- Empty state.
- Loading state.
- Error state.
- Selected state.
- Active state.
- Locked/Premium state.
- Success state.
- Wrong/error answer state.
- Disabled state.
- Button hover/pressed/focus/loading states.
- Responsive behavior at 375x667, 390x844, 412x915, 430x932.

==================================================
## 8. TECHNICAL CONSTRAINTS
==================================================

- Wordy is a Telegram Mini App. Telegram has a native header; do not design a duplicate app header.
- Main target size: 390x844.
- Also check: 375x667, 412x915, 430x932.
- Bottom nav height is around 84px plus safe-area inset.
- Important buttons must not sit behind the bottom nav.
- Full session screens may hide bottom nav: learning cards, training games, Wordy, Profile nested screens, setup, Premium.
- Telegram WebView popups/modals are risky; prefer full screens for major flows.
- Current app still uses modals for result details and game exit confirmation; redesign should keep them simple and robust if retained.
- Admin is desktop-first with responsive fallback under 980px and 760px.
- Audio files are fixed public assets at `/sounds/correct.mp3` and `/sounds/wrong.mp3`.
- Payment flow depends on Telegram Stars and `window.Telegram.WebApp.openInvoice`.
- Back navigation uses Telegram BackButton for fullscreen sessions; redesign must preserve clear back affordances.
- Do not break API data contracts: settings, categories, subscription limits, word progress, game result, admin tables.

==================================================
## 9. FILE MAP
==================================================

| File path | What it controls | Related screen/component |
|---|---|---|
| `frontend/src/main.tsx` | React bootstrap and all app logic | User app, admin app |
| `frontend/src/main.tsx` `TelegramGate` | Telegram auth gate | Checking, outside Telegram, banned |
| `frontend/src/main.tsx` `App` | User app state and navigation | Bottom nav, fullscreen hiding, setup gate |
| `frontend/src/main.tsx` `NAV_ITEMS` | Visible bottom nav items | Home, Learn, Wordy, Profile |
| `frontend/src/main.tsx` `HomeView` | Home dashboard | Home |
| `frontend/src/main.tsx` `TrainingView` | Learn menu and training routing | Learn, Choose Translation, Match Pairs |
| `frontend/src/main.tsx` `LearnView` | Flashcard learning | New Words |
| `frontend/src/main.tsx` `TranslationChoice` | Multiple-choice training | Choose Translation |
| `frontend/src/main.tsx` `MatchWords` | Pair matching training | Match Pairs |
| `frontend/src/main.tsx` `GameView` | 60-second Wordy game | Wordy |
| `frontend/src/main.tsx` `ProfileView` | Profile main and nested profile screens | Profile, settings, stats, Premium |
| `frontend/src/main.tsx` `CategorySelectionScreen` | Category grid | Categories in setup/profile |
| `frontend/src/main.tsx` `SetupFlowScreen` | First launch setup | Onboarding |
| `frontend/src/main.tsx` `LimitReachedView` | Free limit screen | Premium upsell from limits |
| `frontend/src/main.tsx` `PremiumScreen` | Premium plans/payment/active state | Premium |
| `frontend/src/main.tsx` `StatsView` | User progress metrics | Statistics |
| `frontend/src/main.tsx` `ResultModalView` | Wordy answer review modal | Game result details |
| `frontend/src/main.tsx` `ConfirmExitGameModal` | Active-game exit confirmation | Wordy navigation guard |
| `frontend/src/main.tsx` `ADMIN_NAV` | Admin sidebar routes | Admin nav |
| `frontend/src/main.tsx` `AdminApp` | Admin shell/routing | Admin panel |
| `frontend/src/main.tsx` `AdminLogin` | Secret login | Admin login |
| `frontend/src/main.tsx` `AdminOverview` | Admin dashboard metrics | Dashboard |
| `frontend/src/main.tsx` `AdminUsers` | User search/table/bulk actions | Admin users |
| `frontend/src/main.tsx` `AdminUserDetail` | Single user detail/action tabs | User detail |
| `frontend/src/main.tsx` `AdminActivity` | Activity analytics | Admin activity |
| `frontend/src/main.tsx` `AdminLearning` | Learning analytics | Admin learning |
| `frontend/src/main.tsx` `AdminWordy` | Game analytics | Admin Wordy |
| `frontend/src/main.tsx` `AdminSubscriptions` | Subscription metrics/table | Admin subscriptions |
| `frontend/src/main.tsx` `AdminPayments` | Pricing and payment history | Admin payments |
| `frontend/src/main.tsx` `AdminContent` | Word content table | Admin content |
| `frontend/src/main.tsx` `AdminCategories` | Category management | Admin categories |
| `frontend/src/main.tsx` `AdminAdmins` | Admin access/audit | Admin administrators |
| `frontend/src/main.tsx` `AdminLogs` | Audit log table | Admin logs |
| `frontend/src/main.tsx` `AdminSettings` | App settings form | Admin settings |
| `frontend/src/styles.css` | Global tokens, layout, components, responsive rules | All UI |
| `frontend/index.html` | HTML shell and Telegram script | App bootstrap |
| `public/wordy-icon.svg` | Brand icon | Admin sidebar |
| `public/sounds/correct.mp3` | Correct answer sound | Training, Wordy |
| `public/sounds/wrong.mp3` | Wrong answer sound | Training, Wordy |
| `backend/app/main.py` | API routes and business rules | Auth, words, stats, Premium, admin |
| `backend/app/models.py` | Database entities | User/profile/progress/subscription/admin data |
| `backend/app/schemas.py` | API schemas | Frontend/backend contracts |
| `backend/data/words.csv` | Initial word data | Words/categories/levels |
| `nginx/default.conf` | Static serving and API proxy | Deployment routing |
| `docker-compose.yml` | DB/API/nginx services | Deployment |
| `backend/Dockerfile` | Backend image | Deployment |
| `nginx/Dockerfile` | Frontend build and nginx runtime | Deployment |

==================================================
## 10. WHAT CANNOT BE BROKEN
==================================================

- Telegram Mini App auth gate and `initData` authorization header.
- Outside-Telegram and banned-user blocking behavior.
- First launch setup requirement when category/level are incomplete.
- Bottom nav visibility rules for root vs fullscreen sessions.
- Telegram BackButton behavior in fullscreen screens.
- Category selection semantics:
  - `null` means not selected/setup required.
  - `[]` means all categories.
  - non-empty array means selected categories.
- Premium lock behavior for premium categories.
- Free daily limits for learned words and Wordy games.
- Flashcard reveal-before-rating behavior.
- Wordy active-game exit confirmation.
- Correct/wrong feedback classes and sound/haptic hooks.
- Telegram Stars invoice flow and payment status refresh.
- Admin authorization using Telegram admin IDs or `ADMIN_SECRET` token.
- Admin destructive actions and confirmations.
- Admin export CSV actions.
- API paths used by screens.

==================================================
## 11. SUMMARY
==================================================

The current app is a single React/Vite frontend with a mobile Telegram Mini App and a desktop-first admin panel in `frontend/src/main.tsx`. Visual styling is centralized in `frontend/src/styles.css`. The user app has four visible bottom-nav tabs: Home, Learn, Wordy, Profile. Most deeper flows are fullscreen and hide bottom nav. Admin has a sidebar with Dashboard, Users, Activity, Learning, Wordy, Content, Categories, Subscriptions, Payments, Administrators, Logs, and Settings.

The designer should focus on a mobile-first Mini App system for 390x844, with complete states for onboarding, learning, training, game, profile, Premium, limits, and errors. Admin should be redesigned desktop-first around dense tables, filters, metrics, and safe destructive actions.
