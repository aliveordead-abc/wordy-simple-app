import secrets
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class PaymentSession:
    payment_id: str
    provider: str
    plan: str


class PaymentProvider(Protocol):
    source: str

    def create_checkout(self, user_id: int, plan: str) -> PaymentSession:
        ...

    def confirm(self, payment_id: str) -> bool:
        ...


class FakePaymentProvider:
    source = "fake"

    def create_checkout(self, user_id: int, plan: str) -> PaymentSession:
        payment_id = f"fake_{user_id}_{plan}_{secrets.token_urlsafe(16)}"
        return PaymentSession(payment_id=payment_id, provider=self.source, plan=plan)

    def confirm(self, payment_id: str) -> bool:
        return payment_id.startswith("fake_")


class AtmosPaymentProvider:
    source = "atmos"

    def create_checkout(self, user_id: int, plan: str) -> PaymentSession:
        raise NotImplementedError("Atmos payments are intentionally not integrated yet.")

    def confirm(self, payment_id: str) -> bool:
        raise NotImplementedError("Atmos payments are intentionally not integrated yet.")


fake_payment_provider = FakePaymentProvider()
