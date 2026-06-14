import asyncio
import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from time import time
from urllib.parse import parse_qsl

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, case, distinct, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from .db import Base, engine, get_db
from .models import AdminAuditLog, AppSetting, CategorySetting, Payment, User, UserActivityEvent, UserSettings, UserStats, UserSubscription, UserWordProgress, Word
from .payments import fake_payment_provider
from .schemas import (
    AdminLoginIn,
    AdminPremiumGrantIn,
    AdminCategoryBulkPremiumPatch,
    AdminCategoryPremiumPatch,
    AdminSettingsPatch,
    AdminUserBulkActionIn,
    AdminWordIn,
    CategoryOut,
    FakeCheckoutIn,
    FakeCheckoutOut,
    FakeConfirmIn,
    GameResultIn,
    LearnedIn,
    MeOut,
    NextWordOut,
    PremiumPlansOut,
    PremiumPlanOut,
    PremiumPricingPatch,
    ReviewIn,
    SettingsOut,
    SettingsPatch,
    StatsOut,
    SubscriptionOut,
    TelegramUserOut,
    TelegramStarsInvoiceIn,
    TelegramStarsInvoiceOut,
    UserStateIn,
    UserStateOut,
    WordOut,
)

LEVELS = {"A1", "A2", "B1", "B2", "C1"}
ALL_CATEGORIES = "Все категории"
TELEGRAM_AUTH_MAX_AGE_SECONDS = int(os.getenv("TELEGRAM_AUTH_MAX_AGE_SECONDS", "86400"))
ADMIN_TOKEN_MAX_AGE_SECONDS = int(os.getenv("ADMIN_TOKEN_MAX_AGE_SECONDS", "43200"))
FREE_DAILY_LEARNED_WORD_LIMIT = 20
FREE_DAILY_GAME_LIMIT = 5
PLAN_DURATIONS = {"monthly": 30, "yearly": 365}
DEFAULT_PLAN_PRICES_STARS = {"monthly": 99, "yearly": 799}
PLAN_PRICE_SETTING_KEYS = {"monthly": "premium_monthly_price_stars", "yearly": "premium_yearly_price_stars"}
TELEGRAM_STARS_PROVIDER = "telegram_stars"
TELEGRAM_STARS_CURRENCY = "XTR"
MINI_APP_URL = "https://englearn.boruz.uz"
BOT_MENU_TEXT = "Wordy"
BOT_COMMANDS = [
    {"command": "start", "description": "Открыть Wordy"},
    {"command": "help", "description": "Как пользоваться"},
    {"command": "premium", "description": "Premium"},
    {"command": "profile", "description": "Профиль"},
]
START_MESSAGE = (
    "Wordy — учи английские слова легко\n\n"
    "Тренируйте словарный запас, играйте в Wordy и отслеживайте прогресс каждый день."
)
HELP_MESSAGE = (
    "Как пользоваться Wordy:\n\n"
    "1. Выберите уровень.\n"
    "2. Выберите категории.\n"
    "3. Учите новые слова.\n"
    "4. Тренируйтесь, чтобы закрепить материал.\n"
    "5. Играйте в Wordy и отслеживайте прогресс."
)
PREMIUM_MESSAGE = (
    "Wordy Premium открывает больше возможностей: больше слов и тренировок в день, "
    "больше игр Wordy и быстрый прогресс без дневных лимитов."
)
PROFILE_MESSAGE = "Откройте профиль в Wordy, чтобы посмотреть прогресс, уровень и Premium-статус."

app = FastAPI(title="Vocabulary Trainer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def validate_telegram_init_data(init_data: str) -> dict:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not bot_token:
        raise HTTPException(status_code=503, detail="Telegram auth is not configured")
    if not init_data:
        raise HTTPException(status_code=401, detail="Telegram initData is required")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="Telegram initData hash is required")

    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram initData")

    auth_date = int(pairs.get("auth_date", "0") or "0")
    if TELEGRAM_AUTH_MAX_AGE_SECONDS > 0 and time() - auth_date > TELEGRAM_AUTH_MAX_AGE_SECONDS:
        raise HTTPException(status_code=401, detail="Telegram initData expired")

    try:
        user = json.loads(pairs.get("user", "{}"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=401, detail="Invalid Telegram user data") from exc
    if not user.get("id"):
        raise HTTPException(status_code=401, detail="Telegram user is required")
    return user


def admin_telegram_ids() -> set[int]:
    raw = os.getenv("ADMIN_TELEGRAM_IDS", "")
    ids = set()
    for item in raw.split(","):
        item = item.strip()
        if item:
            ids.add(int(item))
    return ids


def admin_secret() -> str:
    return os.getenv("ADMIN_SECRET", "")


def sign_admin_token(identifier: str) -> str:
    secret = admin_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="Admin secret login is not configured")
    issued_at = str(int(time()))
    nonce = secrets.token_urlsafe(12)
    payload = f"{identifier}:{issued_at}:{nonce}"
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{signature}"


def verify_admin_token(token: str) -> str:
    secret = admin_secret()
    if not secret:
        raise HTTPException(status_code=401, detail="Admin token login is unavailable")
    parts = token.split(":")
    if len(parts) != 4:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    identifier, issued_at, nonce, signature = parts
    payload = f"{identifier}:{issued_at}:{nonce}"
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid admin token")
    if time() - int(issued_at) > ADMIN_TOKEN_MAX_AGE_SECONDS:
        raise HTTPException(status_code=401, detail="Admin token expired")
    return identifier


async def get_admin_identifier(
    authorization: str | None = Header(default=None),
) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Admin authorization is required")
    if authorization.startswith("tma "):
        user_data = validate_telegram_init_data(authorization.removeprefix("tma ").strip())
        telegram_id = int(user_data["id"])
        if telegram_id not in admin_telegram_ids():
            raise HTTPException(status_code=403, detail="Admin access denied")
        return f"telegram:{telegram_id}"
    if authorization.startswith("Bearer "):
        return verify_admin_token(authorization.removeprefix("Bearer ").strip())
    raise HTTPException(status_code=401, detail="Unsupported admin authorization")


async def ensure_user_children(db: AsyncSession, user_id: int) -> None:
    await db.execute(
        insert(UserSettings)
        .values(user_id=user_id, current_category="", selected_category_ids=None, current_level="A1")
        .on_conflict_do_nothing(index_elements=[UserSettings.user_id])
    )
    await db.execute(
        insert(UserStats)
        .values(user_id=user_id)
        .on_conflict_do_nothing(index_elements=[UserStats.user_id])
    )


async def track_activity(db: AsyncSession, user: User, event_type: str, details: dict | None = None) -> None:
    user.last_active_at = datetime.utcnow()
    db.add(UserActivityEvent(user_id=user.id, event_type=event_type, details=details or {}))


async def log_admin_action(
    db: AsyncSession,
    admin_identifier: str,
    action: str,
    target_user_id: int | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        AdminAuditLog(
            admin_identifier=admin_identifier,
            action=action,
            target_user_id=target_user_id,
            details=details or {},
        )
    )


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if await maintenance_mode_enabled(db):
        raise HTTPException(status_code=503, detail="maintenance_mode")
    if not authorization or not authorization.startswith("tma "):
        raise HTTPException(status_code=401, detail="Telegram authorization is required")
    user_data = validate_telegram_init_data(authorization.removeprefix("tma ").strip())
    telegram_id = int(user_data["id"])

    stmt = (
        insert(User)
        .values(
            telegram_id=telegram_id,
            username=user_data.get("username"),
            first_name=user_data.get("first_name") or "",
            last_name=user_data.get("last_name"),
            language_code=user_data.get("language_code"),
        )
        .on_conflict_do_update(
            index_elements=[User.telegram_id],
            set_={
                "username": user_data.get("username"),
                "first_name": user_data.get("first_name") or "",
                "last_name": user_data.get("last_name"),
                "language_code": user_data.get("language_code"),
                "updated_at": func.now(),
            },
        )
    )
    await db.execute(stmt)
    await db.commit()
    user = await db.scalar(select(User).where(User.telegram_id == telegram_id))
    if not user:
        raise HTTPException(status_code=401, detail="Telegram user is required")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="User is banned")
    await ensure_user_children(db, user.id)
    await track_activity(db, user, "app_open")
    await db.commit()
    return user


async def get_settings(db: AsyncSession, user: User) -> UserSettings:
    settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if not settings:
        await ensure_user_children(db, user.id)
        await db.commit()
        settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if not settings:
        raise HTTPException(status_code=500, detail="User settings are unavailable")
    if settings.selected_category_ids is None and settings.current_category:
        settings.selected_category_ids = [] if settings.current_category == ALL_CATEGORIES else [settings.current_category]
        await db.commit()
        await db.refresh(settings)
    expired_count = await expire_stale_subscriptions_for_user(db, user.id)
    if not await is_premium_user(db, user.id):
        removed_categories = await cleanup_locked_categories_for_user(db, user)
        if expired_count or removed_categories:
            await track_activity(
                db,
                user,
                "premium_expired" if expired_count else "premium_category_cleanup",
                {"removed_categories": removed_categories, "source": "settings_load"},
            )
            await db.commit()
            await db.refresh(settings)
    return settings


async def get_stats_row(db: AsyncSession, user: User) -> UserStats:
    stats = await db.scalar(select(UserStats).where(UserStats.user_id == user.id))
    if not stats:
        await ensure_user_children(db, user.id)
        await db.commit()
        stats = await db.scalar(select(UserStats).where(UserStats.user_id == user.id))
    if not stats:
        raise HTTPException(status_code=500, detail="User stats are unavailable")
    return stats


def today_start() -> datetime:
    return datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


async def active_subscription(db: AsyncSession, user_id: int) -> UserSubscription | None:
    now = datetime.utcnow()
    return await db.scalar(
        select(UserSubscription)
        .where(
            and_(
                UserSubscription.user_id == user_id,
                UserSubscription.status == "active",
                UserSubscription.expires_at > now,
            )
        )
        .order_by(UserSubscription.expires_at.desc())
        .limit(1)
    )


async def is_premium_user(db: AsyncSession, user_id: int) -> bool:
    return await active_subscription(db, user_id) is not None


async def expire_stale_subscriptions_for_user(db: AsyncSession, user_id: int) -> int:
    now = datetime.utcnow()
    subscriptions = list(
        await db.scalars(
            select(UserSubscription).where(
                and_(
                    UserSubscription.user_id == user_id,
                    UserSubscription.status == "active",
                    UserSubscription.expires_at <= now,
                )
            )
        )
    )
    for subscription in subscriptions:
        subscription.status = "expired"
    return len(subscriptions)


async def daily_activity_count(db: AsyncSession, user_id: int, event_type: str) -> int:
    return await db.scalar(
        select(func.count(UserActivityEvent.id)).where(
            and_(
                UserActivityEvent.user_id == user_id,
                UserActivityEvent.event_type == event_type,
                UserActivityEvent.created_at >= today_start(),
            )
        )
    ) or 0


async def subscription_limits(db: AsyncSession, user_id: int, premium: bool) -> dict:
    learned_today = await daily_activity_count(db, user_id, "word_learned")
    games_today = await daily_activity_count(db, user_id, "game_started")
    return {
        "learned_words": {
            "used_today": learned_today,
            "daily_limit": None if premium else FREE_DAILY_LEARNED_WORD_LIMIT,
            "remaining_today": None if premium else max(FREE_DAILY_LEARNED_WORD_LIMIT - learned_today, 0),
        },
        "wordy_games": {
            "used_today": games_today,
            "daily_limit": None if premium else FREE_DAILY_GAME_LIMIT,
            "remaining_today": None if premium else max(FREE_DAILY_GAME_LIMIT - games_today, 0),
        },
    }


def fake_payments_enabled() -> bool:
    return os.getenv("ENABLE_FAKE_PAYMENTS", "").lower() in {"1", "true", "yes", "on"}


async def get_plan_prices(db: AsyncSession) -> dict[str, int]:
    rows = (
        await db.execute(
            select(AppSetting).where(AppSetting.key.in_(PLAN_PRICE_SETTING_KEYS.values()))
        )
    ).scalars()
    settings = {row.key: row.value for row in rows}
    prices: dict[str, int] = {}
    for plan, key in PLAN_PRICE_SETTING_KEYS.items():
        try:
            prices[plan] = max(1, int(settings.get(key, DEFAULT_PLAN_PRICES_STARS[plan])))
        except (TypeError, ValueError):
            prices[plan] = DEFAULT_PLAN_PRICES_STARS[plan]
    return prices


def serialize_plan_prices(prices: dict[str, int]) -> PremiumPlansOut:
    return PremiumPlansOut(
        monthly=PremiumPlanOut(plan="monthly", price_stars=prices["monthly"]),
        yearly=PremiumPlanOut(plan="yearly", price_stars=prices["yearly"]),
        fake_payments_enabled=fake_payments_enabled(),
    )


async def set_plan_prices(db: AsyncSession, monthly_price_stars: int, yearly_price_stars: int) -> None:
    values = {"monthly": monthly_price_stars, "yearly": yearly_price_stars}
    for plan, value in values.items():
        stmt = (
            insert(AppSetting)
            .values(key=PLAN_PRICE_SETTING_KEYS[plan], value=str(value))
            .on_conflict_do_update(
                index_elements=[AppSetting.key],
                set_={"value": str(value), "updated_at": func.now()},
            )
        )
        await db.execute(stmt)


async def get_app_setting_value(db: AsyncSession, key: str, default: str = "") -> str:
    value = await db.scalar(select(AppSetting.value).where(AppSetting.key == key))
    return value if value is not None else default


async def set_app_setting_value(db: AsyncSession, key: str, value: str) -> None:
    await db.execute(
        insert(AppSetting)
        .values(key=key, value=value)
        .on_conflict_do_update(
            index_elements=[AppSetting.key],
            set_={"value": value, "updated_at": func.now()},
        )
    )


async def ensure_category_settings(db: AsyncSession) -> None:
    categories = list(await db.scalars(select(distinct(Word.category)).order_by(Word.category)))
    for category in categories:
        await db.execute(
            insert(CategorySetting)
            .values(name=category, is_premium=False)
            .on_conflict_do_nothing(index_elements=[CategorySetting.name])
        )


async def premium_category_names(db: AsyncSession) -> set[str]:
    await ensure_category_settings(db)
    return set(await db.scalars(select(CategorySetting.name).where(CategorySetting.is_premium.is_(True))))


async def category_rows_for_user(db: AsyncSession, user_id: int) -> list[CategoryOut]:
    await ensure_category_settings(db)
    premium = await is_premium_user(db, user_id)
    rows = (
        await db.execute(
            select(
                Word.category,
                func.count(Word.id),
                func.coalesce(CategorySetting.is_premium, False),
            )
            .outerjoin(CategorySetting, CategorySetting.name == Word.category)
            .where(Word.is_disabled.is_(False))
            .group_by(Word.category, CategorySetting.is_premium)
            .order_by(Word.category)
        )
    ).all()
    return [
        CategoryOut(
            id=category,
            name=category,
            word_count=word_count,
            is_premium=bool(is_category_premium),
            is_locked_for_user=bool(is_category_premium) and not premium,
        )
        for category, word_count, is_category_premium in rows
    ]


async def accessible_categories_for_user(db: AsyncSession, user: User, categories: list[str] | None) -> list[str] | None:
    if await is_premium_user(db, user.id):
        return categories
    premium_names = await premium_category_names(db)
    if categories is None:
        return None
    async def free_categories() -> list[str]:
        stmt = select(distinct(Word.category)).where(Word.is_disabled.is_(False))
        if premium_names:
            stmt = stmt.where(Word.category.not_in(list(premium_names)))
        return list(await db.scalars(stmt))
    if not categories:
        return await free_categories()
    unlocked_categories = [category for category in categories if category not in premium_names]
    return unlocked_categories or await free_categories()


async def cleanup_locked_categories_for_user(db: AsyncSession, user: User) -> list[str]:
    settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if not settings:
        await ensure_user_children(db, user.id)
        settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    if not settings:
        raise HTTPException(status_code=500, detail="User settings are unavailable")

    categories = selected_categories_from_settings(settings)
    if categories is None:
        return []

    premium_names = await premium_category_names(db)
    removed_categories = [category for category in categories if category in premium_names]
    if not removed_categories:
        return []

    unlocked_categories = [category for category in categories if category not in premium_names]
    settings.selected_category_ids = unlocked_categories
    settings.current_category = legacy_category_from_list(unlocked_categories)
    return removed_categories


async def mark_user_subscription_lost(
    db: AsyncSession,
    user: User,
    status: str,
    event_type: str,
    details: dict | None = None,
) -> list[str]:
    subscription = await active_subscription(db, user.id)
    if subscription:
        subscription.status = status
        subscription.expires_at = datetime.utcnow()
    removed_categories = await cleanup_locked_categories_for_user(db, user)
    await track_activity(
        db,
        user,
        event_type,
        {**(details or {}), "removed_categories": removed_categories},
    )
    return removed_categories


async def maintenance_mode_enabled(db: AsyncSession) -> bool:
    return (await get_app_setting_value(db, "maintenance_mode", "false")).lower() in {"1", "true", "yes", "on"}


async def grant_user_subscription(
    db: AsyncSession,
    user_id: int,
    plan: str,
    source: str = "admin",
    duration_days: int | None = None,
) -> UserSubscription:
    now = datetime.utcnow()
    if duration_days is None:
        duration_days = PLAN_DURATIONS[plan]
    expires_at = now + timedelta(days=duration_days)
    await db.execute(
        text("UPDATE user_subscriptions SET status = 'replaced', updated_at = now() WHERE user_id = :user_id AND status = 'active'"),
        {"user_id": user_id},
    )
    subscription = UserSubscription(
        user_id=user_id,
        plan=plan,
        status="active",
        started_at=now,
        expires_at=expires_at,
        source=source,
        fake_payment_id=f"{source}_{user_id}_{plan}_{int(now.timestamp())}",
    )
    db.add(subscription)
    return subscription


async def serialize_subscription(db: AsyncSession, user_id: int) -> SubscriptionOut:
    expired_count = await expire_stale_subscriptions_for_user(db, user_id)
    if expired_count:
        user = await db.scalar(select(User).where(User.id == user_id))
        if user:
            removed_categories = await cleanup_locked_categories_for_user(db, user)
            await track_activity(
                db,
                user,
                "premium_expired",
                {"removed_categories": removed_categories, "source": "subscription_load"},
            )
        await db.commit()
    subscription = await active_subscription(db, user_id)
    premium = subscription is not None
    return SubscriptionOut(
        is_premium=premium,
        plan=subscription.plan if subscription else None,
        status=subscription.status if subscription else "free",
        started_at=subscription.started_at.isoformat() if subscription else None,
        expires_at=subscription.expires_at.isoformat() if subscription else None,
        source=subscription.source if subscription else None,
        limits=await subscription_limits(db, user_id, premium),
    )


async def latest_subscription_summary(db: AsyncSession, user_id: int) -> dict:
    subscription = await db.scalar(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .order_by(UserSubscription.created_at.desc())
        .limit(1)
    )
    active = await active_subscription(db, user_id)
    return {
        "is_premium": active is not None,
        "subscription_plan": active.plan if active else (subscription.plan if subscription else None),
        "subscription_status": active.status if active else (subscription.status if subscription else "free"),
        "subscription_expires_at": active.expires_at.isoformat() if active else (
            subscription.expires_at.isoformat() if subscription else None
        ),
        "subscription_source": active.source if active else (subscription.source if subscription else None),
    }


async def enforce_learn_limit(db: AsyncSession, user: User) -> None:
    if await is_premium_user(db, user.id):
        return
    learned_today = await daily_activity_count(db, user.id, "word_learned")
    if learned_today >= FREE_DAILY_LEARNED_WORD_LIMIT:
        raise HTTPException(status_code=402, detail="daily_learned_words_limit_reached")


async def enforce_game_limit(db: AsyncSession, user: User) -> None:
    if await is_premium_user(db, user.id):
        return
    games_today = await daily_activity_count(db, user.id, "game_started")
    if games_today >= FREE_DAILY_GAME_LIMIT:
        raise HTTPException(status_code=402, detail="daily_wordy_games_limit_reached")


async def import_words_if_empty() -> None:
    csv_path = Path(os.getenv("CSV_PATH", "/app/data/words.csv"))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS selected_category_ids JSONB"))
        await conn.execute(text("ALTER TABLE words ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS category_settings (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                is_premium BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                updated_at TIMESTAMP NOT NULL DEFAULT now()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_words_is_disabled ON words (is_disabled)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_words_category_level_disabled ON words (category, level, is_disabled)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_is_banned ON users (is_banned)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_last_active_at ON users (last_active_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_created_at ON users (created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_category_settings_name ON category_settings (name)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_category_settings_is_premium ON category_settings (is_premium)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_activity_type_created ON user_activity_events (event_type, created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_word_progress_status_updated ON user_word_progress (status, updated_at)"))
        await conn.execute(text("CREATE TABLE IF NOT EXISTS app_settings (id SERIAL PRIMARY KEY, key VARCHAR(128) UNIQUE NOT NULL, value TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT now())"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_app_settings_key ON app_settings (key)"))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                plan VARCHAR(32) NOT NULL,
                amount_stars INTEGER NOT NULL,
                currency VARCHAR(8) NOT NULL DEFAULT 'XTR',
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                provider VARCHAR(32) NOT NULL DEFAULT 'telegram_stars',
                invoice_payload VARCHAR(255) UNIQUE NOT NULL,
                invoice_link TEXT,
                telegram_payment_charge_id VARCHAR(255) UNIQUE,
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                paid_at TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT now()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_user_id ON payments (user_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_status ON payments (status)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_provider ON payments (provider)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_invoice_payload ON payments (invoice_payload)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_telegram_payment_charge_id ON payments (telegram_payment_charge_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_created_at ON payments (created_at)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_paid_at ON payments (paid_at)"))

    async with AsyncSession(engine) as db:
        prices = await get_plan_prices(db)
        await set_plan_prices(db, prices["monthly"], prices["yearly"])
        await db.commit()
        count = await db.scalar(select(func.count(Word.id)))
        if count:
            await ensure_category_settings(db)
            await db.commit()
            return
        if not csv_path.exists():
            raise RuntimeError(f"CSV file not found: {csv_path}")

        with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
            rows = [
                Word(
                    english=row["english"].strip(),
                    russian=row["russian"].strip(),
                    transcription=row.get("transcription", "").strip(),
                    example=row.get("example", "").strip(),
                    category=row["category"].strip(),
                    level=row["level"].strip().upper(),
                )
                for row in csv.DictReader(file)
                if row.get("english") and row.get("russian")
            ]
        db.add_all(rows)
        await db.commit()
        await ensure_category_settings(db)
        await db.commit()


@app.on_event("startup")
async def startup() -> None:
    await import_words_if_empty()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/auth/telegram", response_model=TelegramUserOut)
async def telegram_auth(user: User = Depends(get_current_user)) -> User:
    return user


@app.get("/me", response_model=MeOut)
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    settings = await get_settings(db, user)
    return MeOut(
        user=TelegramUserOut.model_validate(user),
        settings=serialize_settings(settings),
        subscription=await serialize_subscription(db, user.id),
    )


@app.patch("/me/settings", response_model=SettingsOut)
async def patch_me_settings(
    payload: SettingsPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SettingsOut:
    settings = await get_settings(db, user)
    if payload.selected_category_ids is not None:
        categories = normalize_payload_categories(payload.selected_category_ids)
        await validate_categories(db, categories)
        categories = await accessible_categories_for_user(db, user, categories)
        settings.selected_category_ids = categories
        settings.current_category = legacy_category_from_list(categories)
    elif payload.current_category is not None:
        category = payload.current_category
        categories = [] if category == ALL_CATEGORIES else ([category] if category else None)
        await validate_categories(db, categories)
        categories = await accessible_categories_for_user(db, user, categories)
        settings.selected_category_ids = categories
        settings.current_category = legacy_category_from_list(categories)
    if payload.current_level is not None:
        settings.current_level = payload.current_level if payload.current_level in LEVELS else "A1"
    if payload.selected_category_ids is not None or payload.current_category is not None:
        await track_activity(db, user, "category_changed", {"categories": settings.selected_category_ids})
    if payload.current_level is not None:
        await track_activity(db, user, "level_changed", {"level": settings.current_level})
    await db.commit()
    await db.refresh(settings)
    return serialize_settings(settings)


@app.get("/categories", response_model=list[CategoryOut])
async def categories(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CategoryOut]:
    return await category_rows_for_user(db, user.id)


def serialize_settings(settings: UserSettings) -> SettingsOut:
    categories = selected_categories_from_settings(settings)
    return SettingsOut(
        current_category=settings.current_category,
        current_level=settings.current_level,
        selected_category_ids=categories,
    )


def selected_categories_from_settings(settings: UserSettings) -> list[str] | None:
    if settings.selected_category_ids is not None:
        return list(settings.selected_category_ids)
    if not settings.current_category:
        return None
    if settings.current_category == ALL_CATEGORIES:
        return []
    return [settings.current_category]


def normalize_payload_categories(categories: list[str]) -> list[str]:
    cleaned = []
    for category in categories:
        if category == ALL_CATEGORIES:
            return []
        if category and category not in cleaned:
            cleaned.append(category)
    return cleaned


def legacy_category_from_list(categories: list[str] | None) -> str:
    if categories is None:
        return ""
    if not categories:
        return ALL_CATEGORIES
    if len(categories) == 1:
        return categories[0]
    return "Несколько категорий"


async def validate_categories(db: AsyncSession, categories: list[str] | None) -> None:
    if not categories:
        return
    existing = set(
        await db.scalars(
            select(distinct(Word.category)).where(and_(Word.category.in_(categories), Word.is_disabled.is_(False)))
        )
    )
    missing = [category for category in categories if category not in existing]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown categories: {', '.join(missing)}")


def filtered_words_stmt(categories: list[str] | None, level: str):
    stmt = select(Word).where(Word.is_disabled.is_(False))
    if categories:
        stmt = stmt.where(Word.category.in_(categories))
    if level:
        stmt = stmt.where(Word.level == level)
    return stmt


@app.get("/words", response_model=list[WordOut])
async def words(
    category: str | None = None,
    categories: list[str] | None = Query(default=None),
    level: str | None = Query(default=None, pattern="^(A1|A2|B1|B2|C1)$"),
    learned_only: bool = False,
    include_learned: bool = True,
    limit: int = Query(default=200, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Word]:
    settings = await get_settings(db, user)
    selected_category_ids = selected_categories_from_settings(settings)
    if categories is not None:
        selected_category_ids = normalize_payload_categories(categories)
    elif category is not None:
        selected_category_ids = [] if category == ALL_CATEGORIES else ([category] if category else [])
    selected_category_ids = await accessible_categories_for_user(db, user, selected_category_ids)
    selected_level = level or settings.current_level
    stmt = filtered_words_stmt(selected_category_ids, selected_level)
    if learned_only:
        stmt = stmt.join(UserWordProgress).where(
            and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "learned")
        )
    elif not include_learned:
        learned_ids = select(UserWordProgress.word_id).where(
            and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "learned")
        )
        stmt = stmt.where(Word.id.not_in(learned_ids))
    stmt = stmt.order_by(func.random()).limit(limit)
    return list(await db.scalars(stmt))


@app.get("/words/next", response_model=NextWordOut)
async def next_word(
    review_learned: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NextWordOut:
    settings = await get_settings(db, user)
    selected_category_ids = await accessible_categories_for_user(db, user, selected_categories_from_settings(settings))
    if selected_category_ids is None or not settings.current_level:
        return NextWordOut(
            learned_count=0,
            available_count=0,
            total_count=0,
            message="Выберите категории в профиле.",
        )

    base = filtered_words_stmt(selected_category_ids, settings.current_level)
    total_count = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    learned_ids = select(UserWordProgress.word_id).where(
        and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "learned")
    )
    learned_count = await db.scalar(
        select(func.count(UserWordProgress.id))
        .join(Word, Word.id == UserWordProgress.word_id)
        .where(
            and_(
                UserWordProgress.user_id == user.id,
                UserWordProgress.status == "learned",
                *([Word.category.in_(selected_category_ids)] if selected_category_ids else []),
                Word.level == settings.current_level,
            )
        )
    ) or 0
    stmt = filtered_words_stmt(selected_category_ids, settings.current_level)
    if not review_learned:
        stmt = stmt.where(Word.id.not_in(learned_ids))
    else:
        stmt = stmt.where(Word.id.in_(learned_ids))
    available_count = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    word = await db.scalar(stmt.order_by(func.random()).limit(1))
    all_learned = total_count > 0 and available_count == 0 and not review_learned
    message = None
    if total_count == 0:
        message = "В этой категории и уровне пока нет слов."
    elif all_learned:
        message = "Все слова в этой категории изучены. Можно повторить изученные слова."
    return NextWordOut(
        word=word,
        learned_count=learned_count,
        available_count=available_count,
        total_count=total_count,
        all_learned=all_learned,
        message=message,
    )


async def save_word_status(db: AsyncSession, user: User, word_id: int, status: str) -> None:
    word = await db.scalar(select(Word).where(Word.id == word_id))
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")
    if not await is_premium_user(db, user.id) and word.category in (await premium_category_names(db)):
        raise HTTPException(status_code=403, detail="upgrade_required")
    stmt = (
        insert(UserWordProgress)
        .values(user_id=user.id, word_id=word_id, status=status)
        .on_conflict_do_update(
            constraint="uq_user_word_progress",
            set_={"status": status, "updated_at": func.now()},
        )
    )
    await db.execute(stmt)


@app.post("/words/{word_id}/learned")
async def save_learned_word(
    word_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await enforce_learn_limit(db, user)
    await save_word_status(db, user, word_id, "learned")
    stats = await get_stats_row(db, user)
    stats.reviewed_words_count += 1
    stats.correct_answers += 1
    await track_activity(db, user, "word_learned", {"word_id": word_id})
    await db.commit()
    return {"ok": True}


@app.post("/words/{word_id}/unknown")
async def save_unknown_word(
    word_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await save_word_status(db, user, word_id, "unknown")
    stats = await get_stats_row(db, user)
    stats.reviewed_words_count += 1
    stats.wrong_answers += 1
    await track_activity(db, user, "word_unknown", {"word_id": word_id})
    await db.commit()
    return {"ok": True}


@app.post("/learned")
async def save_learned_alias(
    payload: LearnedIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    return await (save_learned_word if payload.known else save_unknown_word)(payload.word_id, user, db)


@app.post("/reviews")
async def save_review(
    payload: ReviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    stats = await get_stats_row(db, user)
    stats.reviewed_words_count += 1
    if payload.remembered:
        stats.correct_answers += 1
    else:
        stats.wrong_answers += 1
        await save_word_status(db, user, payload.word_id, "unknown")
    await db.commit()
    return {"ok": True}


@app.post("/game/result")
async def save_game_result(
    payload: GameResultIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    stats = await get_stats_row(db, user)
    stats.games_played += 1
    stats.best_score = max(stats.best_score, payload.score)
    stats.correct_answers += payload.correct_answers
    stats.wrong_answers += payload.wrong_answers
    await track_activity(
        db,
        user,
        "game_finished",
        {
            "total_questions": payload.total_questions,
            "correct_answers": payload.correct_answers,
            "wrong_answers": payload.wrong_answers,
            "score": payload.score,
        },
    )
    await db.commit()
    return {"ok": True}


@app.post("/game/start")
async def save_game_start(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await enforce_game_limit(db, user)
    await track_activity(db, user, "game_started")
    await db.commit()
    return {"ok": True}


@app.post("/game-results")
async def save_game_result_alias(
    payload: GameResultIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    return await save_game_result(payload, user, db)


@app.get("/stats/me", response_model=StatsOut)
async def stats_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StatsOut:
    stats = await get_stats_row(db, user)
    learned = await db.scalar(
        select(func.count(UserWordProgress.id)).where(
            and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "learned")
        )
    ) or 0
    unknown = await db.scalar(
        select(func.count(UserWordProgress.id)).where(
            and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "unknown")
        )
    ) or 0
    total_answers = stats.correct_answers + stats.wrong_answers
    average_accuracy = round((stats.correct_answers / total_answers) * 100) if total_answers else 0
    return StatsOut(
        learned_words_count=learned,
        unknown_words_count=unknown,
        reviewed_words_count=stats.reviewed_words_count,
        games_played=stats.games_played,
        best_score=stats.best_score,
        correct_answers=stats.correct_answers,
        wrong_answers=stats.wrong_answers,
        average_accuracy=average_accuracy,
    )


@app.get("/stats", response_model=StatsOut)
async def stats_alias(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StatsOut:
    return await stats_me(user, db)


@app.get("/subscription/me", response_model=SubscriptionOut)
async def subscription_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    return await serialize_subscription(db, user.id)


@app.get("/subscription/plans", response_model=PremiumPlansOut)
async def subscription_plans(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PremiumPlansOut:
    return serialize_plan_prices(await get_plan_prices(db))


def telegram_bot_token() -> str:
    token = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Telegram bot token is not configured")
    return token


async def telegram_bot_api(method: str, payload: dict | None = None) -> dict:
    token = telegram_bot_token()
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload or {}).encode()

    def request() -> dict:
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()
            raise HTTPException(status_code=502, detail=f"Telegram Bot API error: {body}") from exc
        except urllib.error.URLError as exc:
            raise HTTPException(status_code=502, detail=f"Telegram Bot API unavailable: {exc.reason}") from exc

    result = await asyncio.to_thread(request)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=f"Telegram Bot API error: {result}")
    return result


def mini_app_inline_keyboard(text: str = "Открыть Wordy") -> dict:
    return {
        "inline_keyboard": [
            [
                {
                    "text": text,
                    "web_app": {"url": MINI_APP_URL},
                }
            ]
        ]
    }


async def send_mini_app_message(chat_id: int, text: str, button_text: str = "Открыть Wordy") -> None:
    await telegram_bot_api(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text,
            "reply_markup": mini_app_inline_keyboard(button_text),
        },
    )


@app.post("/subscription/telegram-stars/create-invoice", response_model=TelegramStarsInvoiceOut)
async def create_telegram_stars_invoice(
    payload: TelegramStarsInvoiceIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TelegramStarsInvoiceOut:
    prices = await get_plan_prices(db)
    amount_stars = prices[payload.plan]
    invoice_payload = f"wordy:{user.id}:{payload.plan}:{secrets.token_urlsafe(24)}"
    title = "Wordy Premium на месяц" if payload.plan == "monthly" else "Wordy Premium на год"
    description = "Доступ Premium в Wordy без дневных лимитов."
    api_result = await telegram_bot_api(
        "createInvoiceLink",
        {
            "title": title,
            "description": description,
            "payload": invoice_payload,
            "provider_token": "",
            "currency": TELEGRAM_STARS_CURRENCY,
            "prices": [{"label": title, "amount": amount_stars}],
        },
    )
    invoice_link = api_result["result"]
    payment = Payment(
        user_id=user.id,
        plan=payload.plan,
        amount_stars=amount_stars,
        currency=TELEGRAM_STARS_CURRENCY,
        status="pending",
        provider=TELEGRAM_STARS_PROVIDER,
        invoice_payload=invoice_payload,
        invoice_link=invoice_link,
    )
    db.add(payment)
    await track_activity(db, user, "telegram_stars_invoice_created", {"plan": payload.plan, "amount_stars": amount_stars})
    await db.commit()
    await db.refresh(payment)
    return TelegramStarsInvoiceOut(
        payment_id=payment.id,
        plan=payment.plan,
        amount_stars=payment.amount_stars,
        invoice_link=invoice_link,
    )


@app.post("/subscription/fake-checkout", response_model=FakeCheckoutOut)
async def subscription_fake_checkout(
    payload: FakeCheckoutIn,
    user: User = Depends(get_current_user),
) -> FakeCheckoutOut:
    if not fake_payments_enabled():
        raise HTTPException(status_code=404, detail="Fake payments are disabled")
    checkout = fake_payment_provider.create_checkout(user.id, payload.plan)
    return FakeCheckoutOut(fake_payment_id=checkout.payment_id, plan=checkout.plan, provider=checkout.provider)


@app.post("/subscription/fake-confirm", response_model=SubscriptionOut)
async def subscription_fake_confirm(
    payload: FakeConfirmIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    if not fake_payments_enabled():
        raise HTTPException(status_code=404, detail="Fake payments are disabled")
    if not fake_payment_provider.confirm(payload.fake_payment_id):
        raise HTTPException(status_code=400, detail="Invalid fake payment")
    await grant_user_subscription(db, user.id, payload.plan, "fake")
    await track_activity(db, user, "premium_activated", {"plan": payload.plan, "source": "fake"})
    await db.commit()
    return await serialize_subscription(db, user.id)


@app.post("/subscription/cancel", response_model=SubscriptionOut)
async def subscription_cancel(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    subscription = await active_subscription(db, user.id)
    if subscription:
        await mark_user_subscription_lost(
            db,
            user,
            "canceled",
            "premium_canceled",
            {"source": subscription.source},
        )
        await db.commit()
    return await serialize_subscription(db, user.id)


async def handle_pre_checkout_query(update: dict, db: AsyncSession) -> None:
    query = update.get("pre_checkout_query") or {}
    payload = query.get("invoice_payload")
    payment = await db.scalar(select(Payment).where(Payment.invoice_payload == payload)) if payload else None
    user = await db.scalar(select(User).where(User.id == payment.user_id)) if payment else None
    ok = bool(
        payment
        and user
        and payment.status == "pending"
        and payment.currency == TELEGRAM_STARS_CURRENCY
        and query.get("currency") == TELEGRAM_STARS_CURRENCY
        and int(query.get("total_amount") or 0) == payment.amount_stars
        and int((query.get("from") or {}).get("id") or 0) == user.telegram_id
    )
    await telegram_bot_api(
        "answerPreCheckoutQuery",
        {
            "pre_checkout_query_id": query.get("id"),
            "ok": ok,
            **({} if ok else {"error_message": "Payment validation failed"}),
        },
    )


async def handle_successful_payment(update: dict, db: AsyncSession) -> None:
    message = update.get("message") or {}
    successful_payment = message.get("successful_payment") or {}
    invoice_payload = successful_payment.get("invoice_payload")
    telegram_charge_id = successful_payment.get("telegram_payment_charge_id")
    currency = successful_payment.get("currency")
    total_amount = successful_payment.get("total_amount")
    telegram_user_id = int((message.get("from") or {}).get("id") or 0)
    if not invoice_payload or not telegram_charge_id:
        return

    payment = await db.scalar(select(Payment).where(Payment.invoice_payload == invoice_payload))
    if not payment:
        return
    user = await db.scalar(select(User).where(User.id == payment.user_id))
    if not user:
        payment.status = "failed"
        await db.commit()
        return
    if payment.status == "paid":
        return
    if (
        payment.provider != TELEGRAM_STARS_PROVIDER
        or currency != TELEGRAM_STARS_CURRENCY
        or int(total_amount or 0) != payment.amount_stars
        or telegram_user_id != user.telegram_id
    ):
        payment.status = "failed"
        await db.commit()
        return

    existing_charge = await db.scalar(
        select(Payment).where(
            and_(
                Payment.telegram_payment_charge_id == telegram_charge_id,
                Payment.status == "paid",
            )
        )
    )
    if existing_charge:
        payment.status = "failed"
        await db.commit()
        return

    now = datetime.utcnow()
    payment.status = "paid"
    payment.paid_at = now
    payment.telegram_payment_charge_id = telegram_charge_id
    await grant_user_subscription(db, payment.user_id, payment.plan, TELEGRAM_STARS_PROVIDER)
    await track_activity(
        db,
        user,
        "premium_activated",
        {"plan": payment.plan, "source": TELEGRAM_STARS_PROVIDER, "payment_id": payment.id},
    )
    await db.commit()


async def handle_bot_command(update: dict) -> None:
    message = update.get("message") or {}
    text = (message.get("text") or "").strip()
    chat_id = int((message.get("chat") or {}).get("id") or 0)
    if not text or not chat_id:
        return

    command = text.split()[0].split("@", 1)[0].lower()
    if command == "/start":
        await send_mini_app_message(chat_id, START_MESSAGE)
    elif command == "/help":
        await send_mini_app_message(chat_id, HELP_MESSAGE)
    elif command == "/premium":
        await send_mini_app_message(chat_id, PREMIUM_MESSAGE, "Открыть Premium")
    elif command == "/profile":
        await send_mini_app_message(chat_id, PROFILE_MESSAGE, "Открыть профиль")


@app.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    expected_secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    if expected_secret and not hmac.compare_digest(x_telegram_bot_api_secret_token or "", expected_secret):
        raise HTTPException(status_code=403, detail="Invalid Telegram webhook secret")
    update = await request.json()
    if update.get("pre_checkout_query"):
        await handle_pre_checkout_query(update, db)
    if (update.get("message") or {}).get("successful_payment"):
        await handle_successful_payment(update, db)
    await handle_bot_command(update)
    return {"ok": True}


def accuracy_expr(correct_col, wrong_col):
    total = correct_col + wrong_col
    return case((total > 0, func.round((correct_col * 100.0) / total)), else_=0)


async def admin_user_summary(db: AsyncSession, user_id: int) -> dict:
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user.id))
    stats = await db.scalar(select(UserStats).where(UserStats.user_id == user.id))
    learned = await db.scalar(
        select(func.count(UserWordProgress.id)).where(
            and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "learned")
        )
    ) or 0
    unknown = await db.scalar(
        select(func.count(UserWordProgress.id)).where(
            and_(UserWordProgress.user_id == user.id, UserWordProgress.status == "unknown")
        )
    ) or 0
    correct = stats.correct_answers if stats else 0
    wrong = stats.wrong_answers if stats else 0
    total = correct + wrong
    subscription = await latest_subscription_summary(db, user.id)
    return {
        "id": user.id,
        "telegram_id": user.telegram_id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "language_code": user.language_code,
        "selected_categories": selected_categories_from_settings(settings) if settings else None,
        "selected_level": settings.current_level if settings else "",
        "learned_words_count": learned,
        "unknown_words_count": unknown,
        "reviewed_words_count": stats.reviewed_words_count if stats else 0,
        "games_played": stats.games_played if stats else 0,
        "best_score": stats.best_score if stats else 0,
        "correct_answers": correct,
        "wrong_answers": wrong,
        "average_accuracy": round((correct / total) * 100) if total else 0,
        "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "status": "banned" if user.is_banned else "active",
        **subscription,
    }


@app.post("/admin/api/login")
async def admin_login(payload: AdminLoginIn) -> dict[str, str]:
    secret = admin_secret()
    if not secret or not hmac.compare_digest(payload.secret, secret):
        raise HTTPException(status_code=403, detail="Invalid admin secret")
    return {"token": sign_admin_token("secret-admin")}


@app.get("/admin/api/me")
async def admin_me(admin: str = Depends(get_admin_identifier)) -> dict[str, str]:
    return {"admin": admin}


@app.get("/admin/api/categories")
async def admin_categories(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    await ensure_category_settings(db)
    await db.commit()
    result = await db.scalars(select(distinct(Word.category)).order_by(Word.category))
    return list(result)


async def daily_counts(db: AsyncSession, column, model_id, since: datetime, where_clause=None) -> list[dict]:
    stmt = select(func.date(column), func.count(model_id)).where(column >= since)
    if where_clause is not None:
        stmt = stmt.where(where_clause)
    rows = (
        await db.execute(
            stmt.group_by(func.date(column)).order_by(func.date(column))
        )
    ).all()
    return [{"date": str(day), "count": count} for day, count in rows]


async def activity_event_counts(db: AsyncSession, event_types: list[str], since: datetime) -> list[dict]:
    rows = (
        await db.execute(
            select(func.date(UserActivityEvent.created_at), UserActivityEvent.event_type, func.count(UserActivityEvent.id))
            .where(and_(UserActivityEvent.created_at >= since, UserActivityEvent.event_type.in_(event_types)))
            .group_by(func.date(UserActivityEvent.created_at), UserActivityEvent.event_type)
            .order_by(func.date(UserActivityEvent.created_at))
        )
    ).all()
    return [{"date": str(day), "event_type": event_type, "count": count} for day, event_type, count in rows]


async def latest_admin_actions(db: AsyncSession, limit: int = 8) -> list[dict]:
    rows = (
        await db.execute(select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit))
    ).scalars()
    return [
        {
            "id": row.id,
            "admin_identifier": row.admin_identifier,
            "action": row.action,
            "target_user_id": row.target_user_id,
            "details": row.details,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@app.get("/admin/api/dashboard")
async def admin_dashboard(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    now = datetime.utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    seven_days = now - timedelta(days=7)
    thirty_days = now - timedelta(days=30)
    total_users = await db.scalar(select(func.count(User.id))) or 0
    new_today = await db.scalar(select(func.count(User.id)).where(User.created_at >= today)) or 0
    new_7d = await db.scalar(select(func.count(User.id)).where(User.created_at >= seven_days)) or 0
    active_today = await db.scalar(select(func.count(User.id)).where(User.last_active_at >= today)) or 0
    active_7d = await db.scalar(select(func.count(User.id)).where(User.last_active_at >= seven_days)) or 0
    total_learned = await db.scalar(
        select(func.count(UserWordProgress.id)).where(UserWordProgress.status == "learned")
    ) or 0
    total_unknown = await db.scalar(
        select(func.count(UserWordProgress.id)).where(UserWordProgress.status == "unknown")
    ) or 0
    total_games = await db.scalar(select(func.coalesce(func.sum(UserStats.games_played), 0))) or 0
    correct = await db.scalar(select(func.coalesce(func.sum(UserStats.correct_answers), 0))) or 0
    wrong = await db.scalar(select(func.coalesce(func.sum(UserStats.wrong_answers), 0))) or 0
    banned = await db.scalar(select(func.count(User.id)).where(User.is_banned.is_(True))) or 0
    premium_users = await db.scalar(
        select(func.count(distinct(UserSubscription.user_id))).where(
            and_(UserSubscription.status == "active", UserSubscription.expires_at > now)
        )
    ) or 0
    revenue_stars = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount_stars), 0)).where(Payment.status == "paid")
    ) or 0
    zero_activity = await db.scalar(
        select(func.count(User.id))
        .outerjoin(UserStats, UserStats.user_id == User.id)
        .outerjoin(UserWordProgress, UserWordProgress.user_id == User.id)
        .where(
            and_(
                UserWordProgress.id.is_(None),
                func.coalesce(UserStats.games_played, 0) == 0,
                func.coalesce(UserStats.reviewed_words_count, 0) == 0,
            )
        )
    ) or 0
    top_categories = [
        {"category": category, "count": count}
        for category, count in (
            await db.execute(
                select(Word.category, func.count(UserWordProgress.id))
                .join(UserWordProgress, UserWordProgress.word_id == Word.id)
                .where(UserWordProgress.status == "learned")
                .group_by(Word.category)
                .order_by(func.count(UserWordProgress.id).desc())
                .limit(8)
            )
        ).all()
    ]
    top_levels = [
        {"level": level or "Не выбран", "count": count}
        for level, count in (
            await db.execute(
                select(UserSettings.current_level, func.count(UserSettings.id))
                .group_by(UserSettings.current_level)
                .order_by(func.count(UserSettings.id).desc())
            )
        ).all()
    ]
    new_users_by_day = [
        {"date": str(day), "count": count}
        for day, count in (
            await db.execute(
                select(func.date(User.created_at), func.count(User.id))
                .where(User.created_at >= now - timedelta(days=14))
                .group_by(func.date(User.created_at))
                .order_by(func.date(User.created_at))
            )
        ).all()
    ]
    learning_activity_by_day = await daily_counts(
        db,
        UserActivityEvent.created_at,
        UserActivityEvent.id,
        thirty_days,
        UserActivityEvent.event_type == "word_learned",
    )
    game_activity_by_day = await daily_counts(
        db,
        UserActivityEvent.created_at,
        UserActivityEvent.id,
        thirty_days,
        UserActivityEvent.event_type == "game_finished",
    )
    premium_conversions_by_day = await daily_counts(
        db,
        UserSubscription.created_at,
        UserSubscription.id,
        thirty_days,
        UserSubscription.status == "active",
    )
    revenue_by_day = [
        {"date": str(day), "stars": int(stars or 0)}
        for day, stars in (
            await db.execute(
                select(func.date(Payment.paid_at), func.coalesce(func.sum(Payment.amount_stars), 0))
                .where(and_(Payment.status == "paid", Payment.paid_at >= thirty_days))
                .group_by(func.date(Payment.paid_at))
                .order_by(func.date(Payment.paid_at))
            )
        ).all()
    ]
    return {
        "total_users": total_users,
        "new_users_today": new_today,
        "new_users_last_7_days": new_7d,
        "active_users_today": active_today,
        "active_users_last_7_days": active_7d,
        "total_learned_words": total_learned,
        "total_unknown_words": total_unknown,
        "total_games_played": total_games,
        "average_accuracy": round((correct / (correct + wrong)) * 100) if correct + wrong else 0,
        "top_categories": top_categories,
        "top_levels": top_levels,
        "new_users_by_day": new_users_by_day,
        "banned_users_count": banned,
        "premium_users_count": premium_users,
        "free_users_count": max(total_users - premium_users, 0),
        "users_with_zero_activity": zero_activity,
        "learning_activity_by_day": learning_activity_by_day,
        "game_activity_by_day": game_activity_by_day,
        "premium_conversions_by_day": premium_conversions_by_day,
        "revenue_by_day": revenue_by_day,
        "revenue_stars": int(revenue_stars),
        "api_health": "ok",
        "database_status": "ok",
        "last_backup_time": None,
        "latest_admin_actions": await latest_admin_actions(db),
    }


@app.get("/admin/api/premium-pricing", response_model=PremiumPlansOut)
async def admin_get_premium_pricing(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> PremiumPlansOut:
    return serialize_plan_prices(await get_plan_prices(db))


@app.post("/admin/api/premium-pricing", response_model=PremiumPlansOut)
async def admin_update_premium_pricing(
    payload: PremiumPricingPatch,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> PremiumPlansOut:
    await set_plan_prices(db, payload.monthly_price_stars, payload.yearly_price_stars)
    await log_admin_action(
        db,
        admin,
        "update_premium_pricing",
        details={
            "monthly_price_stars": payload.monthly_price_stars,
            "yearly_price_stars": payload.yearly_price_stars,
        },
    )
    await db.commit()
    return serialize_plan_prices(await get_plan_prices(db))


@app.get("/admin/api/payments")
async def admin_payments(
    status: str | None = None,
    provider: str | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    base = select(Payment.id).join(User, User.id == Payment.user_id)
    if status:
        base = base.where(Payment.status == status)
    if provider:
        base = base.where(Payment.provider == provider)
    if search:
        like = f"%{search}%"
        conditions = [Payment.invoice_payload.ilike(like), Payment.telegram_payment_charge_id.ilike(like), User.username.ilike(like)]
        if search.isdigit():
            conditions.extend([Payment.id == int(search), User.telegram_id == int(search)])
        base = base.where(or_(*conditions))
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    paid = await db.scalar(select(func.count(Payment.id)).where(Payment.status == "paid")) or 0
    pending = await db.scalar(select(func.count(Payment.id)).where(Payment.status == "pending")) or 0
    failed = await db.scalar(select(func.count(Payment.id)).where(Payment.status == "failed")) or 0
    cancelled = await db.scalar(select(func.count(Payment.id)).where(Payment.status.in_(["cancelled", "canceled"]))) or 0
    revenue = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount_stars), 0)).where(Payment.status == "paid")
    ) or 0
    ids = list(await db.scalars(base.order_by(Payment.created_at.desc()).offset((page - 1) * page_size).limit(page_size)))
    rows = (
        await db.execute(
            select(Payment, User)
            .join(User, User.id == Payment.user_id)
            .where(Payment.id.in_(ids) if ids else text("false"))
            .order_by(Payment.created_at.desc())
        )
    ).all()
    return {
        "total_payments": total,
        "paid_payments": paid,
        "pending_payments": pending,
        "failed_payments": failed,
        "cancelled_payments": cancelled,
        "revenue_stars": int(revenue),
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": payment.id,
                "user": {
                    "id": user.id,
                    "telegram_id": user.telegram_id,
                    "username": user.username,
                    "first_name": user.first_name,
                },
                "plan": payment.plan,
                "amount_stars": payment.amount_stars,
                "currency": payment.currency,
                "status": payment.status,
                "provider": payment.provider,
                "invoice_payload": payment.invoice_payload,
                "created_at": payment.created_at.isoformat(),
                "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
                "charge_id": payment.telegram_payment_charge_id,
            }
            for payment, user in rows
        ],
    }


@app.get("/admin/api/users")
async def admin_users(
    search: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    premium: str | None = None,
    category: str | None = None,
    level: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    last_active_from: datetime | None = None,
    last_active_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(User.id).outerjoin(UserSettings, UserSettings.user_id == User.id)
    if search:
        like = f"%{search}%"
        conditions = [User.username.ilike(like), User.first_name.ilike(like), User.last_name.ilike(like)]
        if search.isdigit():
            conditions.append(User.telegram_id == int(search))
        stmt = stmt.where(or_(*conditions))
    if status_filter == "banned":
        stmt = stmt.where(User.is_banned.is_(True))
    elif status_filter == "active":
        stmt = stmt.where(User.is_banned.is_(False))
    if premium in {"free", "premium"}:
        active_subs = (
            select(distinct(UserSubscription.user_id))
            .where(and_(UserSubscription.status == "active", UserSubscription.expires_at > datetime.utcnow()))
        )
        stmt = stmt.where(User.id.in_(active_subs) if premium == "premium" else User.id.not_in(active_subs))
    if level:
        stmt = stmt.where(UserSettings.current_level == level)
    if created_from:
        stmt = stmt.where(User.created_at >= created_from)
    if created_to:
        stmt = stmt.where(User.created_at <= created_to)
    if last_active_from:
        stmt = stmt.where(User.last_active_at >= last_active_from)
    if last_active_to:
        stmt = stmt.where(User.last_active_at <= last_active_to)
    if category:
        stmt = stmt.where(
            or_(
                UserSettings.current_category == category,
                text("user_settings.selected_category_ids::jsonb ? :category").bindparams(category=category),
            )
        )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    ids = list(
        await db.scalars(
            stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    )
    return {
        "items": [await admin_user_summary(db, user_id) for user_id in ids],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.get("/admin/api/users/{user_id}")
async def admin_user_detail(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    summary = await admin_user_summary(db, user_id)
    timeline = [
        {"event_type": event_type, "count": count}
        for event_type, count in (
            await db.execute(
                select(UserActivityEvent.event_type, func.count(UserActivityEvent.id))
                .where(UserActivityEvent.user_id == user_id)
                .group_by(UserActivityEvent.event_type)
                .order_by(func.count(UserActivityEvent.id).desc())
            )
        ).all()
    ]
    recent_learned = [
        {"id": word_id, "english": english, "russian": russian, "updated_at": updated_at.isoformat()}
        for word_id, english, russian, updated_at in (
            await db.execute(
                select(Word.id, Word.english, Word.russian, UserWordProgress.updated_at)
                .join(UserWordProgress, UserWordProgress.word_id == Word.id)
                .where(and_(UserWordProgress.user_id == user_id, UserWordProgress.status == "learned"))
                .order_by(UserWordProgress.updated_at.desc())
                .limit(20)
            )
        ).all()
    ]
    recent_wrong = [
        {"id": word_id, "english": english, "russian": russian, "updated_at": updated_at.isoformat()}
        for word_id, english, russian, updated_at in (
            await db.execute(
                select(Word.id, Word.english, Word.russian, UserWordProgress.updated_at)
                .join(UserWordProgress, UserWordProgress.word_id == Word.id)
                .where(and_(UserWordProgress.user_id == user_id, UserWordProgress.status == "unknown"))
                .order_by(UserWordProgress.updated_at.desc())
                .limit(20)
            )
        ).all()
    ]
    game_history = [
        {
            "created_at": created_at.isoformat(),
            "score": (details or {}).get("score"),
            "correct_answers": (details or {}).get("correct_answers"),
            "wrong_answers": (details or {}).get("wrong_answers"),
            "total_questions": (details or {}).get("total_questions"),
        }
        for created_at, details in (
            await db.execute(
                select(UserActivityEvent.created_at, UserActivityEvent.details)
                .where(and_(UserActivityEvent.user_id == user_id, UserActivityEvent.event_type == "game_finished"))
                .order_by(UserActivityEvent.created_at.desc())
                .limit(50)
            )
        ).all()
    ]
    subscriptions = [
        {
            "plan": sub.plan,
            "status": sub.status,
            "source": sub.source,
            "started_at": sub.started_at.isoformat(),
            "expires_at": sub.expires_at.isoformat(),
            "created_at": sub.created_at.isoformat(),
        }
        for sub in (
            await db.execute(
                select(UserSubscription)
                .where(UserSubscription.user_id == user_id)
                .order_by(UserSubscription.created_at.desc())
                .limit(20)
            )
        ).scalars()
    ]
    logs = [
        {
            "id": log.id,
            "admin_identifier": log.admin_identifier,
            "action": log.action,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
        }
        for log in (
            await db.execute(
                select(AdminAuditLog)
                .where(AdminAuditLog.target_user_id == user_id)
                .order_by(AdminAuditLog.created_at.desc())
                .limit(50)
            )
        ).scalars()
    ]
    return {
        **summary,
        "weak_words_count": summary["unknown_words_count"],
        "total_sessions": sum(item["count"] for item in timeline),
        "activity_timeline": timeline,
        "recent_learned_words": recent_learned,
        "recent_wrong_words": recent_wrong,
        "game_history": game_history,
        "subscriptions": subscriptions,
        "admin_logs": logs,
    }


async def reset_user_stats_row(db: AsyncSession, user_id: int) -> None:
    stats = await db.scalar(select(UserStats).where(UserStats.user_id == user_id))
    if not stats:
        db.add(UserStats(user_id=user_id))
        return
    stats.reviewed_words_count = 0
    stats.games_played = 0
    stats.best_score = 0
    stats.correct_answers = 0
    stats.wrong_answers = 0


async def reset_user_settings_row(db: AsyncSession, user_id: int) -> None:
    settings = await db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
    if not settings:
        db.add(UserSettings(user_id=user_id, current_category="", selected_category_ids=None, current_level=""))
        return
    settings.current_category = ""
    settings.selected_category_ids = None
    settings.current_level = ""


async def require_target_user(db: AsyncSession, user_id: int) -> User:
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post("/admin/api/users/{user_id}/reset-stats")
async def admin_reset_stats(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await require_target_user(db, user_id)
    await reset_user_stats_row(db, user_id)
    await log_admin_action(db, admin, "reset_user_stats", user_id)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/reset-words")
async def admin_reset_words(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await require_target_user(db, user_id)
    await db.execute(text("DELETE FROM user_word_progress WHERE user_id = :user_id"), {"user_id": user_id})
    await log_admin_action(db, admin, "delete_user_progress", user_id)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/reset-settings")
async def admin_reset_settings(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await require_target_user(db, user_id)
    await reset_user_settings_row(db, user_id)
    await log_admin_action(db, admin, "reset_user_settings", user_id)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/full-reset")
async def admin_full_reset(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await require_target_user(db, user_id)
    await db.execute(text("DELETE FROM user_word_progress WHERE user_id = :user_id"), {"user_id": user_id})
    await reset_user_stats_row(db, user_id)
    await reset_user_settings_row(db, user_id)
    await log_admin_action(db, admin, "full_reset_user_progress", user_id)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/ban")
async def admin_ban_user(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    user = await require_target_user(db, user_id)
    user.is_banned = True
    await log_admin_action(db, admin, "ban_user", user_id)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/unban")
async def admin_unban_user(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    user = await require_target_user(db, user_id)
    user.is_banned = False
    await log_admin_action(db, admin, "unban_user", user_id)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/grant-premium")
async def admin_grant_premium(
    user_id: int,
    payload: AdminPremiumGrantIn | None = Body(default=None),
    plan: str | None = Query(default=None, pattern="^(monthly|yearly|custom)$"),
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await require_target_user(db, user_id)
    grant_plan = payload.plan if payload else (plan or "monthly")
    duration_days = payload.duration_days if payload else None
    note = payload.note if payload else None
    if grant_plan == "custom" and duration_days is None:
        raise HTTPException(status_code=422, detail="duration_days is required for custom premium grants")
    subscription = await grant_user_subscription(db, user_id, grant_plan, "admin", duration_days)
    log_details = {
        "plan": grant_plan,
        "expires_at": subscription.expires_at.isoformat(),
    }
    if duration_days is not None:
        log_details["duration_days"] = duration_days
    if note:
        log_details["note"] = note
    await log_admin_action(db, admin, "grant_premium", user_id, log_details)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/users/{user_id}/revoke-premium")
async def admin_revoke_premium(
    user_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    user = await require_target_user(db, user_id)
    removed_categories = await mark_user_subscription_lost(db, user, "revoked", "premium_revoked", {"admin": admin})
    await log_admin_action(
        db,
        admin,
        "revoke_premium",
        user_id,
        {"removed_categories": removed_categories},
    )
    await db.commit()
    return {"ok": True}


async def apply_admin_user_action(db: AsyncSession, user_id: int, action: str, plan: str | None = None) -> None:
    user = await require_target_user(db, user_id)
    if action == "ban":
        user.is_banned = True
    elif action == "unban":
        user.is_banned = False
    elif action == "reset_stats":
        await reset_user_stats_row(db, user_id)
    elif action == "reset_words":
        await db.execute(text("DELETE FROM user_word_progress WHERE user_id = :user_id"), {"user_id": user_id})
    elif action == "reset_settings":
        await reset_user_settings_row(db, user_id)
    elif action == "full_reset":
        await db.execute(text("DELETE FROM user_word_progress WHERE user_id = :user_id"), {"user_id": user_id})
        await reset_user_stats_row(db, user_id)
        await reset_user_settings_row(db, user_id)
    elif action == "grant_premium":
        await grant_user_subscription(db, user_id, plan or "monthly", "admin")
    elif action == "revoke_premium":
        await mark_user_subscription_lost(db, user, "revoked", "premium_revoked", {"source": "bulk_admin_action"})


@app.post("/admin/api/users/bulk-action")
async def admin_bulk_user_action(
    payload: AdminUserBulkActionIn,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.action == "grant_premium" and not payload.plan:
        raise HTTPException(status_code=400, detail="plan is required for grant_premium")
    affected = []
    for user_id in payload.user_ids:
        await apply_admin_user_action(db, user_id, payload.action, payload.plan)
        affected.append(user_id)
    await log_admin_action(
        db,
        admin,
        f"bulk_{payload.action}",
        details={"user_ids": affected, "count": len(affected), "plan": payload.plan},
    )
    await db.commit()
    return {"ok": True, "count": len(affected)}


@app.get("/admin/api/analytics")
async def admin_analytics(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    since = datetime.utcnow() - timedelta(days=30)
    daily_game_activity = [
        {"date": str(day), "count": count}
        for day, count in (
            await db.execute(
                select(func.date(UserActivityEvent.created_at), func.count(UserActivityEvent.id))
                .where(and_(UserActivityEvent.event_type == "game_finished", UserActivityEvent.created_at >= since))
                .group_by(func.date(UserActivityEvent.created_at))
                .order_by(func.date(UserActivityEvent.created_at))
            )
        ).all()
    ]
    daily_learned_words = [
        {"date": str(day), "count": count}
        for day, count in (
            await db.execute(
                select(func.date(UserActivityEvent.created_at), func.count(UserActivityEvent.id))
                .where(and_(UserActivityEvent.event_type == "word_learned", UserActivityEvent.created_at >= since))
                .group_by(func.date(UserActivityEvent.created_at))
                .order_by(func.date(UserActivityEvent.created_at))
            )
        ).all()
    ]
    return {**await admin_dashboard(admin, db), "daily_game_activity": daily_game_activity, "daily_learned_words": daily_learned_words}


@app.get("/admin/api/activity")
async def admin_activity(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    since = datetime.utcnow() - timedelta(days=30)
    tracked = [
        "app_open",
        "category_changed",
        "level_changed",
        "word_learned",
        "word_unknown",
        "training_session",
        "game_started",
        "game_finished",
        "premium_page_opened",
        "telegram_stars_invoice_created",
        "premium_activated",
        "payment_failed",
    ]
    by_type = [
        {"event_type": event_type, "count": count}
        for event_type, count in (
            await db.execute(
                select(UserActivityEvent.event_type, func.count(UserActivityEvent.id))
                .where(UserActivityEvent.created_at >= since)
                .group_by(UserActivityEvent.event_type)
                .order_by(func.count(UserActivityEvent.id).desc())
            )
        ).all()
    ]
    funnel_events = ["app_open", "category_changed", "word_learned", "game_started", "premium_page_opened", "telegram_stars_invoice_created", "premium_activated"]
    funnel = [
        {
            "event_type": event_type,
            "users": await db.scalar(
                select(func.count(distinct(UserActivityEvent.user_id))).where(
                    and_(UserActivityEvent.event_type == event_type, UserActivityEvent.created_at >= since)
                )
            ) or 0,
        }
        for event_type in funnel_events
    ]
    cohorts = {}
    for days in (1, 3, 7):
        start = today_start() - timedelta(days=days)
        end = start + timedelta(days=1)
        new_users = select(User.id).where(and_(User.created_at >= start, User.created_at < end))
        retained = await db.scalar(
            select(func.count(distinct(UserActivityEvent.user_id))).where(
                and_(UserActivityEvent.user_id.in_(new_users), UserActivityEvent.created_at >= start + timedelta(days=days))
            )
        ) or 0
        total = await db.scalar(select(func.count()).select_from(new_users.subquery())) or 0
        cohorts[f"day_{days}"] = {"users": total, "retained": retained, "retention_rate": round((retained / total) * 100) if total else 0}
    return {
        "events_by_day": await activity_event_counts(db, tracked, since),
        "events_by_type": by_type,
        "funnel": funnel,
        "retention": cohorts,
    }


@app.get("/admin/api/learning")
async def admin_learning(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    learned_rows = (
        await db.execute(
            select(Word, func.count(UserWordProgress.id).label("learned_count"))
            .join(UserWordProgress, UserWordProgress.word_id == Word.id)
            .where(UserWordProgress.status == "learned")
            .group_by(Word.id)
            .order_by(func.count(UserWordProgress.id).desc())
            .limit(25)
        )
    ).all()
    unknown_rows = (
        await db.execute(
            select(Word, func.count(UserWordProgress.id).label("unknown_count"))
            .join(UserWordProgress, UserWordProgress.word_id == Word.id)
            .where(UserWordProgress.status == "unknown")
            .group_by(Word.id)
            .order_by(func.count(UserWordProgress.id).desc())
            .limit(25)
        )
    ).all()
    word_rows = (
        await db.execute(
            select(
                Word,
                func.count(case((UserWordProgress.status == "learned", 1))).label("learned_count"),
                func.count(case((UserWordProgress.status == "unknown", 1))).label("unknown_count"),
            )
            .outerjoin(UserWordProgress, UserWordProgress.word_id == Word.id)
            .group_by(Word.id)
            .order_by(Word.english)
            .limit(100)
        )
    ).all()
    users_with_no_learning = await db.scalar(
        select(func.count(User.id)).where(
            User.id.not_in(select(distinct(UserWordProgress.user_id)))
        )
    ) or 0
    users_stuck_first_session = await db.scalar(
        select(func.count(User.id))
        .outerjoin(UserStats, UserStats.user_id == User.id)
        .where(and_(func.coalesce(UserStats.reviewed_words_count, 0) <= 1, func.coalesce(UserStats.games_played, 0) == 0))
    ) or 0
    learned_per_user = (
        select(UserWordProgress.user_id, func.count(UserWordProgress.id).label("learned_count"))
        .where(UserWordProgress.status == "learned")
        .group_by(UserWordProgress.user_id)
        .subquery()
    )
    avg_words = await db.scalar(select(func.coalesce(func.avg(learned_per_user.c.learned_count), 0))) or 0
    return {
        "most_learned_words": [serialize_word_analytics(word, learned_count, 0) for word, learned_count in learned_rows],
        "most_difficult_words": [serialize_word_analytics(word, 0, unknown_count) for word, unknown_count in unknown_rows],
        "most_marked_unknown_words": [serialize_word_analytics(word, 0, unknown_count) for word, unknown_count in unknown_rows],
        "categories": [
            {"category": category, "learned_count": count}
            for category, count in (
                await db.execute(
                    select(Word.category, func.count(UserWordProgress.id))
                    .join(UserWordProgress, UserWordProgress.word_id == Word.id)
                    .where(UserWordProgress.status == "learned")
                    .group_by(Word.category)
                    .order_by(func.count(UserWordProgress.id).desc())
                )
            ).all()
        ],
        "levels": [
            {"level": level, "learned_count": count}
            for level, count in (
                await db.execute(
                    select(Word.level, func.count(UserWordProgress.id))
                    .join(UserWordProgress, UserWordProgress.word_id == Word.id)
                    .where(UserWordProgress.status == "learned")
                    .group_by(Word.level)
                    .order_by(func.count(UserWordProgress.id).desc())
                )
            ).all()
        ],
        "average_words_learned_per_user": round(float(avg_words), 2),
        "users_with_no_learning_activity": users_with_no_learning,
        "users_stuck_on_first_session": users_stuck_first_session,
        "words": [serialize_word_analytics(word, learned, unknown) for word, learned, unknown in word_rows],
    }


def serialize_word_analytics(word: Word, learned_count: int, unknown_count: int) -> dict:
    total = learned_count + unknown_count
    return {
        "id": word.id,
        "english": word.english,
        "translation": word.russian,
        "russian": word.russian,
        "transcription": word.transcription,
        "example": word.example,
        "category": word.category,
        "level": word.level,
        "learned_count": learned_count,
        "unknown_count": unknown_count,
        "error_rate": round((unknown_count / total) * 100) if total else 0,
        "is_disabled": word.is_disabled,
    }


@app.get("/admin/api/wordy")
async def admin_wordy(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    today = today_start()
    total_games = await db.scalar(select(func.coalesce(func.sum(UserStats.games_played), 0))) or 0
    games_today = await db.scalar(
        select(func.count(UserActivityEvent.id)).where(and_(UserActivityEvent.event_type == "game_finished", UserActivityEvent.created_at >= today))
    ) or 0
    total_score_rows = (
        await db.execute(
            select(UserActivityEvent.details).where(UserActivityEvent.event_type == "game_finished")
        )
    ).all()
    scores = [int((details or {}).get("score") or 0) for (details,) in total_score_rows]
    top_players = [
        {
            "user_id": user_id,
            "telegram_id": telegram_id,
            "username": username,
            "first_name": first_name,
            "games_played": games,
            "best_score": best,
            "total_score": correct,
            "accuracy": round((correct / (correct + wrong)) * 100) if correct + wrong else 0,
        }
        for user_id, telegram_id, username, first_name, games, best, correct, wrong in (
            await db.execute(
                select(User.id, User.telegram_id, User.username, User.first_name, UserStats.games_played, UserStats.best_score, UserStats.correct_answers, UserStats.wrong_answers)
                .join(UserStats, UserStats.user_id == User.id)
                .where(UserStats.games_played > 0)
                .order_by(UserStats.best_score.desc())
                .limit(50)
            )
        ).all()
    ]
    correct = await db.scalar(select(func.coalesce(func.sum(UserStats.correct_answers), 0))) or 0
    wrong = await db.scalar(select(func.coalesce(func.sum(UserStats.wrong_answers), 0))) or 0
    return {
        "total_games": int(total_games),
        "games_today": games_today,
        "average_score": round(sum(scores) / len(scores)) if scores else 0,
        "best_score": max(scores) if scores else (await db.scalar(select(func.coalesce(func.max(UserStats.best_score), 0))) or 0),
        "average_accuracy": round((correct / (correct + wrong)) * 100) if correct + wrong else 0,
        "average_session_length": None,
        "most_failed_words": (await admin_learning(admin, db))["most_difficult_words"][:10],
        "most_successful_words": (await admin_learning(admin, db))["most_learned_words"][:10],
        "leaderboard_by_best_score": top_players,
        "leaderboard_by_total_score": sorted(top_players, key=lambda item: item["total_score"], reverse=True)[:50],
        "leaderboard_by_accuracy": sorted(top_players, key=lambda item: item["accuracy"], reverse=True)[:50],
    }


@app.get("/admin/api/subscriptions")
async def admin_subscriptions(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    now = datetime.utcnow()
    total_users = await db.scalar(select(func.count(User.id))) or 0
    active = await db.scalar(select(func.count(distinct(UserSubscription.user_id))).where(and_(UserSubscription.status == "active", UserSubscription.expires_at > now))) or 0
    expired = await db.scalar(select(func.count(UserSubscription.id)).where(UserSubscription.expires_at <= now)) or 0
    cancelled = await db.scalar(select(func.count(UserSubscription.id)).where(UserSubscription.status.in_(["canceled", "cancelled", "revoked"]))) or 0
    rows = (
        await db.execute(
            select(UserSubscription, User)
            .join(User, User.id == UserSubscription.user_id)
            .order_by(UserSubscription.created_at.desc())
            .limit(100)
        )
    ).all()
    return {
        "premium_users": active,
        "active_premium": active,
        "expired_premium": expired,
        "cancelled_premium": cancelled,
        "free_users": max(total_users - active, 0),
        "conversion_rate": round((active / total_users) * 100) if total_users else 0,
        "plan_distribution": [
            {"plan": plan, "count": count}
            for plan, count in (
                await db.execute(
                    select(UserSubscription.plan, func.count(UserSubscription.id))
                    .where(UserSubscription.status == "active")
                    .group_by(UserSubscription.plan)
                )
            ).all()
        ],
        "items": [
            {
                "id": sub.id,
                "user": {"id": user.id, "telegram_id": user.telegram_id, "username": user.username, "first_name": user.first_name},
                "plan": sub.plan,
                "status": sub.status,
                "source": sub.source,
                "started_at": sub.started_at.isoformat(),
                "expires_at": sub.expires_at.isoformat(),
            }
            for sub, user in rows
        ],
    }


@app.get("/admin/api/content/words")
async def admin_words(
    search: str | None = None,
    category: str | None = None,
    level: str | None = None,
    include_disabled: bool = True,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(Word)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Word.english.ilike(like), Word.russian.ilike(like), Word.transcription.ilike(like)))
    if category:
        stmt = stmt.where(Word.category == category)
    if level:
        stmt = stmt.where(Word.level == level)
    if not include_disabled:
        stmt = stmt.where(Word.is_disabled.is_(False))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    words = list(await db.scalars(stmt.order_by(Word.category, Word.level, Word.english).offset((page - 1) * page_size).limit(page_size)))
    counts = {}
    if words:
        for word_id, status, count in (
            await db.execute(
                select(UserWordProgress.word_id, UserWordProgress.status, func.count(UserWordProgress.id))
                .where(UserWordProgress.word_id.in_([word.id for word in words]))
                .group_by(UserWordProgress.word_id, UserWordProgress.status)
            )
        ).all():
            counts.setdefault(word_id, {})[status] = count
    return {
        "items": [
            serialize_word_analytics(word, counts.get(word.id, {}).get("learned", 0), counts.get(word.id, {}).get("unknown", 0))
            for word in words
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@app.post("/admin/api/content/words")
async def admin_create_word(
    payload: AdminWordIn,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    duplicate = await db.scalar(
        select(Word.id).where(
            and_(func.lower(Word.english) == payload.english.lower(), Word.category == payload.category, Word.level == payload.level)
        )
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Duplicate word in category/level")
    word = Word(**payload.model_dump())
    db.add(word)
    await log_admin_action(db, admin, "create_word", details={"english": payload.english, "category": payload.category, "level": payload.level})
    await db.commit()
    await db.refresh(word)
    return serialize_word_analytics(word, 0, 0)


@app.put("/admin/api/content/words/{word_id}")
async def admin_update_word(
    word_id: int,
    payload: AdminWordIn,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    word = await db.scalar(select(Word).where(Word.id == word_id))
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")
    for key, value in payload.model_dump().items():
        setattr(word, key, value)
    await log_admin_action(db, admin, "update_word", details={"word_id": word_id, "english": payload.english})
    await db.commit()
    await db.refresh(word)
    learned = await db.scalar(select(func.count(UserWordProgress.id)).where(and_(UserWordProgress.word_id == word.id, UserWordProgress.status == "learned"))) or 0
    unknown = await db.scalar(select(func.count(UserWordProgress.id)).where(and_(UserWordProgress.word_id == word.id, UserWordProgress.status == "unknown"))) or 0
    return serialize_word_analytics(word, learned, unknown)


@app.post("/admin/api/content/words/{word_id}/disable")
async def admin_disable_word(
    word_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    word = await db.scalar(select(Word).where(Word.id == word_id))
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")
    word.is_disabled = True
    await log_admin_action(db, admin, "disable_word", details={"word_id": word_id, "english": word.english})
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/content/words/{word_id}/enable")
async def admin_enable_word(
    word_id: int,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    word = await db.scalar(select(Word).where(Word.id == word_id))
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")
    word.is_disabled = False
    await log_admin_action(db, admin, "enable_word", details={"word_id": word_id, "english": word.english})
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/content/import-csv")
async def admin_import_words_csv(
    request: Request,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    body = (await request.body()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(body))
    required = {"english", "russian", "category", "level"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(status_code=400, detail="CSV must include english,russian,category,level")
    created = 0
    skipped = 0
    for row in reader:
        english = (row.get("english") or "").strip()
        russian = (row.get("russian") or "").strip()
        category = (row.get("category") or "").strip()
        level = (row.get("level") or "").strip().upper()
        if not english or not russian or not category or level not in LEVELS:
            skipped += 1
            continue
        duplicate = await db.scalar(
            select(Word.id).where(and_(func.lower(Word.english) == english.lower(), Word.category == category, Word.level == level))
        )
        if duplicate:
            skipped += 1
            continue
        db.add(
            Word(
                english=english,
                russian=russian,
                transcription=(row.get("transcription") or "").strip(),
                example=(row.get("example") or "").strip(),
                category=category,
                level=level,
            )
        )
        created += 1
    await log_admin_action(db, admin, "import_words_csv", details={"created": created, "skipped": skipped})
    await db.commit()
    return {"ok": True, "created": created, "skipped": skipped}


@app.get("/admin/api/categories/dashboard")
async def admin_categories_dashboard(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await ensure_category_settings(db)
    rows = (
        await db.execute(
            select(
                Word.category,
                func.count(Word.id),
                func.count(case((Word.is_disabled.is_(False), 1))),
                func.coalesce(CategorySetting.is_premium, False),
            )
            .outerjoin(CategorySetting, CategorySetting.name == Word.category)
            .group_by(Word.category)
            .group_by(CategorySetting.is_premium)
            .order_by(Word.category)
        )
    ).all()
    items = []
    for category, word_count, enabled_count, is_category_premium in rows:
        active_users = await db.scalar(
            select(func.count(UserSettings.id)).where(
                or_(
                    UserSettings.current_category == category,
                    text("user_settings.selected_category_ids::jsonb ? :category").bindparams(category=category),
                )
            )
        ) or 0
        learned_count = await db.scalar(
            select(func.count(UserWordProgress.id))
            .join(Word, Word.id == UserWordProgress.word_id)
            .where(and_(Word.category == category, UserWordProgress.status == "learned"))
        ) or 0
        items.append(
            {
                "category": category,
                "word_count": word_count,
                "enabled_word_count": enabled_count,
                "is_premium": bool(is_category_premium),
                "active_users": active_users,
                "learned_count": learned_count,
                "engagement": learned_count,
            }
        )
    return {"items": items}


@app.post("/admin/api/categories")
async def admin_add_category(
    payload: dict,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    await set_app_setting_value(db, f"category_meta:{name}", json.dumps({"icon": payload.get("icon") or ""}))
    await db.execute(
        insert(CategorySetting)
        .values(name=name, is_premium=bool(payload.get("is_premium") or False))
        .on_conflict_do_update(
            index_elements=[CategorySetting.name],
            set_={"is_premium": bool(payload.get("is_premium") or False), "updated_at": func.now()},
        )
    )
    await log_admin_action(db, admin, "add_category", details={"category": name})
    await db.commit()
    return {"ok": True}


@app.put("/admin/api/categories/{category}")
async def admin_rename_category(
    category: str,
    payload: dict,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    new_name = str(payload.get("name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Category name is required")
    await db.execute(text("UPDATE words SET category = :new_name WHERE category = :category"), {"new_name": new_name, "category": category})
    await db.execute(
        text("UPDATE category_settings SET name = :new_name, updated_at = now() WHERE name = :category"),
        {"new_name": new_name, "category": category},
    )
    await log_admin_action(db, admin, "rename_category", details={"from": category, "to": new_name})
    await db.commit()
    return {"ok": True}


async def set_category_premium_state(
    db: AsyncSession,
    admin: str,
    category: str,
    is_premium: bool,
) -> None:
    exists = await db.scalar(select(func.count(Word.id)).where(Word.category == category)) or 0
    if not exists:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.execute(
        insert(CategorySetting)
        .values(name=category, is_premium=is_premium)
        .on_conflict_do_update(
            index_elements=[CategorySetting.name],
            set_={"is_premium": is_premium, "updated_at": func.now()},
        )
    )
    await log_admin_action(
        db,
        admin,
        "category_premium_enabled" if is_premium else "category_premium_disabled",
        details={"category_id": category, "category": category, "is_premium": is_premium},
    )


@app.patch("/admin/api/categories/{category}/premium")
async def admin_set_category_premium(
    category: str,
    payload: AdminCategoryPremiumPatch,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await set_category_premium_state(db, admin, category, payload.is_premium)
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/categories/bulk-premium")
async def admin_bulk_set_category_premium(
    payload: AdminCategoryBulkPremiumPatch,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    for category in payload.categories:
        await set_category_premium_state(db, admin, category, payload.is_premium)
    await log_admin_action(
        db,
        admin,
        "bulk_category_premium_enabled" if payload.is_premium else "bulk_category_premium_disabled",
        details={"categories": payload.categories, "count": len(payload.categories), "is_premium": payload.is_premium},
    )
    await db.commit()
    return {"ok": True, "count": len(payload.categories)}


@app.post("/admin/api/categories/{category}/disable")
async def admin_disable_category(
    category: str,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await db.execute(text("UPDATE words SET is_disabled = true WHERE category = :category"), {"category": category})
    await log_admin_action(db, admin, "disable_category", details={"category": category})
    await db.commit()
    return {"ok": True}


@app.get("/admin/api/admins")
async def admin_admins(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    secret_value = admin_secret()
    allowed_ids = sorted(admin_telegram_ids())
    return {
        "current_admin": admin,
        "allowed_telegram_admin_ids": allowed_ids,
        "admin_secret_configured": bool(secret_value),
        "admin_secret_masked": f"{secret_value[:2]}{'*' * max(len(secret_value) - 4, 0)}{secret_value[-2:]}" if len(secret_value) >= 4 else "***",
        "last_admin_login": None,
        "recent_audit_logs": await latest_admin_actions(db, 25),
    }


@app.post("/admin/api/admins/add")
async def admin_add_admin_id(
    payload: dict,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    telegram_id = int(payload.get("telegram_id") or 0)
    if telegram_id <= 0:
        raise HTTPException(status_code=400, detail="telegram_id is required")
    await log_admin_action(db, admin, "request_add_admin_id", details={"telegram_id": telegram_id, "note": "ADMIN_TELEGRAM_IDS must be updated in environment"})
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/admins/remove")
async def admin_remove_admin_id(
    payload: dict,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    telegram_id = int(payload.get("telegram_id") or 0)
    if telegram_id <= 0:
        raise HTTPException(status_code=400, detail="telegram_id is required")
    await log_admin_action(db, admin, "request_remove_admin_id", details={"telegram_id": telegram_id, "note": "ADMIN_TELEGRAM_IDS must be updated in environment"})
    await db.commit()
    return {"ok": True}


@app.post("/admin/api/admins/rotate-secret")
async def admin_rotate_secret(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await log_admin_action(db, admin, "request_rotate_admin_secret", details={"note": "ADMIN_SECRET rotation requires environment redeploy"})
    await db.commit()
    return {"status": "manual_rotation_required"}


@app.get("/admin/api/settings")
async def admin_get_settings(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    defaults = {
        "app_name": "Wordy",
        "support_contact_text": "",
        "free_daily_learned_words_limit": str(FREE_DAILY_LEARNED_WORD_LIMIT),
        "free_daily_game_limit": str(FREE_DAILY_GAME_LIMIT),
        "default_level": "A1",
        "default_categories_behavior": "manual",
        "maintenance_mode": "false",
    }
    result = {}
    for key, default in defaults.items():
        result[key] = await get_app_setting_value(db, key, default)
    result["maintenance_mode"] = str(result["maintenance_mode"]).lower() in {"1", "true", "yes", "on"}
    result["fake_payments_enabled"] = fake_payments_enabled()
    result["telegram_stars_payments_enabled"] = bool(os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN"))
    return result


@app.patch("/admin/api/settings")
async def admin_update_settings(
    payload: AdminSettingsPatch,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        await set_app_setting_value(db, key, "true" if value is True else "false" if value is False else str(value))
    await log_admin_action(db, admin, "update_app_settings", details={key: ("***" if "secret" in key else value) for key, value in data.items()})
    await db.commit()
    return await admin_get_settings(admin, db)


@app.get("/admin/api/logs")
async def admin_logs(
    action: str | None = None,
    admin_filter: str | None = Query(default=None, alias="admin"),
    target_user_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> dict:
    stmt = select(AdminAuditLog)
    if action:
        stmt = stmt.where(AdminAuditLog.action == action)
    if admin_filter:
        stmt = stmt.where(AdminAuditLog.admin_identifier.ilike(f"%{admin_filter}%"))
    if target_user_id:
        stmt = stmt.where(AdminAuditLog.target_user_id == target_user_id)
    if date_from:
        stmt = stmt.where(AdminAuditLog.created_at >= date_from)
    if date_to:
        stmt = stmt.where(AdminAuditLog.created_at <= date_to)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.execute(
            stmt.order_by(AdminAuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars()
    return {
        "items": [
            {
                "id": row.id,
                "admin_identifier": row.admin_identifier,
                "action": row.action,
                "target_user_id": row.target_user_id,
                "details": row.details,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def csv_response(filename: str, rows: list[dict]) -> Response:
    output = io.StringIO()
    fieldnames = list(rows[0].keys()) if rows else ["empty"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/admin/api/export/users.csv")
async def admin_export_users(
    ids: str | None = None,
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> Response:
    stmt = select(User).order_by(User.id)
    if ids:
        selected_ids = [int(item) for item in ids.split(",") if item.strip().isdigit()]
        stmt = stmt.where(User.id.in_(selected_ids) if selected_ids else text("false"))
    users = list(await db.scalars(stmt))
    rows = [await admin_user_summary(db, user.id) for user in users]
    await log_admin_action(db, admin, "export_users", details={"count": len(rows)})
    await db.commit()
    return csv_response("wordy-users.csv", rows)


@app.get("/admin/api/export/payments.csv")
async def admin_export_payments(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rows = [
        {
            "id": payment.id,
            "user_id": user.id,
            "telegram_id": user.telegram_id,
            "plan": payment.plan,
            "amount_stars": payment.amount_stars,
            "currency": payment.currency,
            "status": payment.status,
            "provider": payment.provider,
            "charge_id": payment.telegram_payment_charge_id,
            "created_at": payment.created_at.isoformat(),
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
        }
        for payment, user in (
            await db.execute(
                select(Payment, User).join(User, User.id == Payment.user_id).order_by(Payment.created_at.desc())
            )
        ).all()
    ]
    await log_admin_action(db, admin, "export_payments", details={"count": len(rows)})
    await db.commit()
    return csv_response("wordy-payments.csv", rows)


@app.get("/admin/api/export/words.csv")
async def admin_export_words(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rows = [
        {
            "id": word.id,
            "english": word.english,
            "russian": word.russian,
            "transcription": word.transcription,
            "example": word.example,
            "category": word.category,
            "level": word.level,
            "is_disabled": word.is_disabled,
        }
        for word in list(await db.scalars(select(Word).order_by(Word.category, Word.level, Word.english)))
    ]
    await log_admin_action(db, admin, "export_words", details={"count": len(rows)})
    await db.commit()
    return csv_response("wordy-words.csv", rows)


@app.get("/admin/api/export/stats.csv")
async def admin_export_stats(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rows = [
        {
            "user_id": user_id,
            "reviewed_words_count": reviewed,
            "games_played": games,
            "best_score": best,
            "correct_answers": correct,
            "wrong_answers": wrong,
        }
        for user_id, reviewed, games, best, correct, wrong in (
            await db.execute(
                select(
                    UserStats.user_id,
                    UserStats.reviewed_words_count,
                    UserStats.games_played,
                    UserStats.best_score,
                    UserStats.correct_answers,
                    UserStats.wrong_answers,
                ).order_by(UserStats.user_id)
            )
        ).all()
    ]
    await log_admin_action(db, admin, "export_user_stats", details={"count": len(rows)})
    await db.commit()
    return csv_response("wordy-user-stats.csv", rows)


@app.get("/admin/api/export/learned.csv")
async def admin_export_learned(
    admin: str = Depends(get_admin_identifier),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rows = [
        {
            "user_id": user_id,
            "telegram_id": telegram_id,
            "word_id": word_id,
            "english": english,
            "russian": russian,
            "category": category,
            "level": level,
            "status": status,
            "updated_at": updated_at.isoformat(),
        }
        for user_id, telegram_id, word_id, english, russian, category, level, status, updated_at in (
            await db.execute(
                select(
                    User.id,
                    User.telegram_id,
                    Word.id,
                    Word.english,
                    Word.russian,
                    Word.category,
                    Word.level,
                    UserWordProgress.status,
                    UserWordProgress.updated_at,
                )
                .join(UserWordProgress, UserWordProgress.user_id == User.id)
                .join(Word, Word.id == UserWordProgress.word_id)
                .order_by(UserWordProgress.updated_at.desc())
            )
        ).all()
    ]
    await log_admin_action(db, admin, "export_learned_words", details={"count": len(rows)})
    await db.commit()
    return csv_response("wordy-learned-words.csv", rows)


@app.get("/state", response_model=UserStateOut)
async def get_state(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserStateOut:
    settings = await get_settings(db, user)
    return UserStateOut(category=settings.current_category, level=settings.current_level)


@app.put("/state")
async def save_state(
    payload: UserStateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await patch_me_settings(
        SettingsPatch(current_category=payload.category, current_level=payload.level),
        user,
        db,
    )
    return {"ok": True}
