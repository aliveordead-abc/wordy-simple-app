from pydantic import BaseModel, Field


class TelegramUserOut(BaseModel):
    telegram_id: int
    username: str | None = None
    first_name: str
    last_name: str | None = None
    language_code: str | None = None

    model_config = {"from_attributes": True}


class SettingsOut(BaseModel):
    current_category: str = ""
    current_level: str = "A1"
    selected_category_ids: list[str] | None = None


class SubscriptionOut(BaseModel):
    is_premium: bool = False
    plan: str | None = None
    status: str = "free"
    started_at: str | None = None
    expires_at: str | None = None
    source: str | None = None
    limits: dict = Field(default_factory=dict)


class PremiumPlanOut(BaseModel):
    plan: str
    price_stars: int
    currency: str = "XTR"


class PremiumPlansOut(BaseModel):
    monthly: PremiumPlanOut
    yearly: PremiumPlanOut
    fake_payments_enabled: bool = False


class PremiumPricingPatch(BaseModel):
    monthly_price_stars: int = Field(ge=1)
    yearly_price_stars: int = Field(ge=1)


class TelegramStarsInvoiceIn(BaseModel):
    plan: str = Field(pattern="^(monthly|yearly)$")


class TelegramStarsInvoiceOut(BaseModel):
    payment_id: int
    plan: str
    amount_stars: int
    currency: str = "XTR"
    invoice_link: str


class MeOut(BaseModel):
    user: TelegramUserOut
    settings: SettingsOut
    subscription: SubscriptionOut


class CategoryOut(BaseModel):
    id: str
    name: str
    word_count: int = 0
    is_premium: bool = False
    is_locked_for_user: bool = False


class SettingsPatch(BaseModel):
    current_category: str | None = None
    selected_category_ids: list[str] | None = None
    current_level: str | None = Field(default=None, pattern="^(A1|A2|B1|B2|C1)$")


class WordOut(BaseModel):
    id: int
    english: str
    russian: str
    transcription: str
    example: str
    category: str
    level: str

    model_config = {"from_attributes": True}


class NextWordOut(BaseModel):
    word: WordOut | None = None
    learned_count: int
    available_count: int
    total_count: int
    all_learned: bool = False
    message: str | None = None


class LearnedIn(BaseModel):
    word_id: int
    known: bool = True


class ReviewIn(BaseModel):
    word_id: int
    remembered: bool


class GameResultIn(BaseModel):
    total_questions: int = Field(ge=0)
    correct_answers: int = Field(ge=0)
    wrong_answers: int = Field(ge=0)
    score: int = Field(ge=0)


class StatsOut(BaseModel):
    learned_words_count: int
    unknown_words_count: int
    reviewed_words_count: int
    games_played: int
    best_score: int
    correct_answers: int
    wrong_answers: int
    average_accuracy: int

    @property
    def learned_words(self) -> int:
        return self.learned_words_count

    @property
    def review_attempts(self) -> int:
        return self.reviewed_words_count

    @property
    def game_correct(self) -> int:
        return self.correct_answers

    @property
    def game_wrong(self) -> int:
        return self.wrong_answers

    model_config = {"from_attributes": True}


class UserStateOut(BaseModel):
    category: str = ""
    level: str = "A1"
    progress: dict = Field(default_factory=dict)
    training_stats: dict = Field(default_factory=dict)


class UserStateIn(BaseModel):
    category: str = ""
    level: str = "A1"
    progress: dict = Field(default_factory=dict)
    training_stats: dict = Field(default_factory=dict)


class AdminLoginIn(BaseModel):
    secret: str


class FakeCheckoutIn(BaseModel):
    plan: str = Field(pattern="^(monthly|yearly)$")


class FakeCheckoutOut(BaseModel):
    fake_payment_id: str
    plan: str
    provider: str = "fake"


class FakeConfirmIn(BaseModel):
    plan: str = Field(pattern="^(monthly|yearly)$")
    fake_payment_id: str


class AdminUserBulkActionIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=500)
    action: str = Field(pattern="^(ban|unban|reset_stats|reset_words|reset_settings|full_reset|grant_premium|revoke_premium)$")
    plan: str | None = Field(default=None, pattern="^(monthly|yearly)$")


class AdminPremiumGrantIn(BaseModel):
    plan: str = Field(default="monthly", pattern="^(monthly|yearly|custom)$")
    duration_days: int | None = Field(default=None, ge=1, le=3650)
    note: str | None = Field(default=None, max_length=1000)


class AdminWordIn(BaseModel):
    english: str = Field(min_length=1, max_length=255)
    russian: str = Field(min_length=1, max_length=255)
    transcription: str = ""
    example: str = ""
    category: str = Field(min_length=1, max_length=255)
    level: str = Field(pattern="^(A1|A2|B1|B2|C1)$")
    is_disabled: bool = False


class AdminCategoryPremiumPatch(BaseModel):
    is_premium: bool


class AdminCategoryBulkPremiumPatch(BaseModel):
    categories: list[str] = Field(min_length=1, max_length=500)
    is_premium: bool


class AdminSettingsPatch(BaseModel):
    app_name: str | None = None
    support_contact_text: str | None = None
    free_daily_learned_words_limit: int | None = Field(default=None, ge=0)
    free_daily_game_limit: int | None = Field(default=None, ge=0)
    default_level: str | None = Field(default=None, pattern="^(A1|A2|B1|B2|C1)$")
    default_categories_behavior: str | None = None
    maintenance_mode: bool | None = None
