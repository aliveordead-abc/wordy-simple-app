import argparse
import json
import os
import urllib.error
import urllib.request


MINI_APP_URL = "https://englearn.boruz.uz"
BOT_COMMANDS = [
    {"command": "start", "description": "Открыть Wordy"},
    {"command": "help", "description": "Как пользоваться"},
    {"command": "premium", "description": "Premium"},
    {"command": "profile", "description": "Профиль"},
]


def load_env_file(path: str) -> None:
    if not path:
        return
    with open(path, "r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def bot_token() -> str:
    token = os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN or BOT_TOKEN is required")
    return token


def telegram_api(method: str, payload: dict | None = None) -> dict:
    url = f"https://api.telegram.org/bot{bot_token()}/{method}"
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise RuntimeError(f"{method} failed: {body}") from exc


def print_response(method: str, response: dict) -> None:
    print(f"{method}: {json.dumps(response, ensure_ascii=False, sort_keys=True)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure Wordy Telegram bot commands and menu button.")
    parser.add_argument("--env-file", default="", help="Optional env file containing TELEGRAM_BOT_TOKEN or BOT_TOKEN.")
    args = parser.parse_args()
    load_env_file(args.env_file)

    print_response("getMe", telegram_api("getMe"))
    print_response(
        "setChatMenuButton",
        telegram_api(
            "setChatMenuButton",
            {
                "menu_button": {
                    "type": "web_app",
                    "text": "Wordy",
                    "web_app": {"url": MINI_APP_URL},
                }
            },
        ),
    )
    print_response("setMyCommands", telegram_api("setMyCommands", {"commands": BOT_COMMANDS}))


if __name__ == "__main__":
    main()
