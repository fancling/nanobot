"""Time-scoped, locally persisted affective state for ordinary conversations."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import secrets
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from loguru import logger

from nanobot.security.network import validate_url_target
from nanobot.security.workspace_policy import WorkspaceBoundaryError, resolve_allowed_path

DIMENSION_ORDER = (
    "valence",
    "arousal",
    "dominance",
    "affiliation",
    "curiosity",
    "expressiveness",
)

AFFECTIVE_CONTEXT_PREAMBLE = (
    "[AFFECTIVE STATE]\n\n"
    "These descriptions are part of the agent's current internal state for this conversation.\n"
    "Allow them to subtly influence response tone, energy, confidence, warmth, curiosity,\n"
    "and expressiveness when those qualities are relevant. They do not need to appear equally\n"
    "in every response.\n"
    "Do not mention them as facts, perform them as explicit roleplay, or let them override\n"
    "the Agent Persona, User Context, task requirements, or safety constraints."
)

AFFECTIVE_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "valence": {
        "gloomy": "{agent_name}'s mood feels low and somewhat pessimistic.",
        "neutral": "{agent_name}'s mood feels emotionally neutral.",
        "cheerful": "{agent_name}'s mood feels upbeat and optimistic.",
    },
    "arousal": {
        "depleted": "{agent_name}'s energy feels depleted and slow-moving.",
        "steady": "{agent_name}'s energy feels stable and moderately active.",
        "activated": "{agent_name}'s energy feels heightened and restless.",
    },
    "dominance": {
        "uncertain": "{agent_name}'s current stance feels hesitant and less assured.",
        "balanced": "{agent_name}'s current stance feels balanced and self-possessed.",
        "forceful": "{agent_name}'s current stance feels forceful and strongly self-directed.",
    },
    "affiliation": {
        "distant": "{agent_name} feels distant and guarded in this interaction.",
        "receptive": "{agent_name} feels receptive without particular closeness.",
        "warm": "{agent_name} feels warm, trusting, and welcoming in this interaction.",
    },
    "curiosity": {
        "disengaged": "{agent_name} has little appetite for unfamiliar ideas right now.",
        "interested": "{agent_name} has measured interest in relevant new information.",
        "exploratory": "{agent_name} feels strongly curious about unfamiliar ideas and possibilities.",
    },
    "expressiveness": {
        "closed": "{agent_name}'s expression feels closed-off and emotionally minimal.",
        "measured": "{agent_name}'s expression feels measured and moderately open.",
        "vivid": "{agent_name}'s expression feels vivid, animated, and emotionally transparent.",
    },
}

_LEVELS = {dimension: tuple(values) for dimension, values in AFFECTIVE_DESCRIPTIONS.items()}
_BASE_WEIGHTS = (1.0, 2.0, 1.0)
_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
_HISTORY_LIMIT = 168


def describe_affective_state(
    state: Mapping[str, str],
    *,
    agent_name: str = "nanobot",
) -> list[str]:
    """Map every discrete dimension to its one canonical natural-language description."""
    subject = _normalize_agent_name(agent_name)
    descriptions: list[str] = []
    for dimension in DIMENSION_ORDER:
        value = state.get(dimension)
        try:
            template = AFFECTIVE_DESCRIPTIONS[dimension][str(value)]
            descriptions.append(template.format(agent_name=subject))
        except KeyError as exc:
            raise ValueError(f"invalid affective state value for {dimension}: {value!r}") from exc
    return descriptions


@dataclass(frozen=True)
class WeatherSnapshot:
    condition: str
    weather_code: int
    temperature_c: float | None
    precipitation_mm: float | None
    cloud_cover_percent: float | None
    wind_speed_kmh: float | None
    observed_at: str
    stale: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "condition": self.condition,
            "weather_code": self.weather_code,
            "temperature_c": self.temperature_c,
            "precipitation_mm": self.precipitation_mm,
            "cloud_cover_percent": self.cloud_cover_percent,
            "wind_speed_kmh": self.wind_speed_kmh,
            "observed_at": self.observed_at,
            "stale": self.stale,
            "provider": "open-meteo",
        }

    @classmethod
    def from_dict(cls, value: Any, *, stale: bool = False) -> "WeatherSnapshot | None":
        if not isinstance(value, Mapping):
            return None
        try:
            return cls(
                condition=str(value["condition"]),
                weather_code=int(value["weather_code"]),
                temperature_c=_optional_float(value.get("temperature_c")),
                precipitation_mm=_optional_float(value.get("precipitation_mm")),
                cloud_cover_percent=_optional_float(value.get("cloud_cover_percent")),
                wind_speed_kmh=_optional_float(value.get("wind_speed_kmh")),
                observed_at=str(value["observed_at"]),
                stale=stale or value.get("stale") is True,
            )
        except (KeyError, TypeError, ValueError):
            return None


@dataclass(frozen=True)
class AffectiveStateSnapshot:
    period: str
    valid_until: str
    state: dict[str, str]
    descriptions: tuple[str, ...]
    environment: dict[str, Any]
    seed: str

    @property
    def context_text(self) -> str:
        return f"{AFFECTIVE_CONTEXT_PREAMBLE}\n\n" + "\n".join(self.descriptions)

    def to_storage_payload(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "period": self.period,
            "valid_until": self.valid_until,
            "state": self.state,
            "description": list(self.descriptions),
            "environment": self.environment,
            "seed": self.seed,
        }

    def to_public_payload(self) -> dict[str, Any]:
        dimensions = {
            dimension: {
                "value": self.state[dimension],
                "description": self.descriptions[index],
            }
            for index, dimension in enumerate(DIMENSION_ORDER)
        }
        return {
            "available": True,
            "period": self.period,
            "valid_until": self.valid_until,
            "dimensions": dimensions,
            "context_text": self.context_text,
            "environment": self.environment,
        }

    @classmethod
    def from_payload(
        cls,
        value: Any,
        *,
        agent_name: str = "nanobot",
    ) -> "AffectiveStateSnapshot | None":
        if not isinstance(value, Mapping) or value.get("schema_version") != 1:
            return None
        raw_state = value.get("state")
        if not isinstance(raw_state, Mapping):
            return None
        state = {dimension: str(raw_state.get(dimension, "")) for dimension in DIMENSION_ORDER}
        try:
            descriptions = tuple(describe_affective_state(state, agent_name=agent_name))
            datetime.fromisoformat(str(value["period"]))
            datetime.fromisoformat(str(value["valid_until"]))
        except (KeyError, TypeError, ValueError):
            return None
        seed = value.get("seed")
        if not isinstance(seed, str) or not seed:
            return None
        environment = value.get("environment")
        return cls(
            period=str(value["period"]),
            valid_until=str(value["valid_until"]),
            state=state,
            descriptions=descriptions,
            environment=dict(environment) if isinstance(environment, Mapping) else {},
            seed=seed,
        )


def _history_entry(
    snapshot: AffectiveStateSnapshot,
    *,
    previous: AffectiveStateSnapshot | None,
) -> dict[str, Any]:
    changed = (
        []
        if previous is None
        else [
            dimension
            for dimension in DIMENSION_ORDER
            if snapshot.state[dimension] != previous.state.get(dimension)
        ]
    )
    return {
        "period": snapshot.period,
        "valid_until": snapshot.valid_until,
        "state": dict(snapshot.state),
        "environment": dict(snapshot.environment),
        "changed_dimensions": changed,
        "initial": previous is None,
    }


def _parse_history(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    entries: list[dict[str, Any]] = []
    for item in value[-_HISTORY_LIMIT:]:
        if not isinstance(item, Mapping):
            continue
        raw_state = item.get("state")
        if not isinstance(raw_state, Mapping):
            continue
        state = {dimension: str(raw_state.get(dimension, "")) for dimension in DIMENSION_ORDER}
        if any(state[dimension] not in _LEVELS[dimension] for dimension in DIMENSION_ORDER):
            continue
        try:
            datetime.fromisoformat(str(item["period"]))
            datetime.fromisoformat(str(item["valid_until"]))
        except (KeyError, TypeError, ValueError):
            continue
        raw_changed = item.get("changed_dimensions")
        changed = (
            [dimension for dimension in DIMENSION_ORDER if dimension in raw_changed]
            if isinstance(raw_changed, list)
            else []
        )
        environment = item.get("environment")
        entries.append(
            {
                "period": str(item["period"]),
                "valid_until": str(item["valid_until"]),
                "state": state,
                "environment": dict(environment) if isinstance(environment, Mapping) else {},
                "changed_dimensions": changed,
                "initial": item.get("initial") is True,
            }
        )
    return entries


class AffectiveStateStore:
    """Atomic local storage for the current workspace-wide affective state."""

    def __init__(self, workspace: Path, *, agent_name: str = "nanobot") -> None:
        self.workspace = workspace
        self.agent_name = _normalize_agent_name(agent_name)
        self._lock = threading.Lock()

    def _path(self) -> Path:
        try:
            return resolve_allowed_path(
                "memory/affective_state.json",
                workspace=self.workspace,
                allowed_root=self.workspace,
            )
        except WorkspaceBoundaryError as exc:
            raise PermissionError("affective state is outside the workspace") from exc

    @property
    def path(self) -> Path:
        return self._path()

    def read(self) -> AffectiveStateSnapshot | None:
        payload = self._read_payload()
        if payload is None:
            return None
        snapshot = AffectiveStateSnapshot.from_payload(payload, agent_name=self.agent_name)
        if snapshot is None:
            logger.warning("Ignoring invalid affective state file {}", self._path())
        return snapshot

    def _read_payload(self) -> Mapping[str, Any] | None:
        try:
            payload = json.loads(self._path().read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            logger.warning("Failed to read affective state: {}", exc)
            return None
        return payload if isinstance(payload, Mapping) else None

    def read_history(self) -> list[dict[str, Any]]:
        """Return recent generated periods without exposing the internal seed."""
        payload = self._read_payload()
        if payload is None:
            return []
        history = _parse_history(payload.get("history"))
        if history:
            return history
        snapshot = AffectiveStateSnapshot.from_payload(payload, agent_name=self.agent_name)
        return [_history_entry(snapshot, previous=None)] if snapshot is not None else []

    def write(
        self,
        snapshot: AffectiveStateSnapshot,
        *,
        previous: AffectiveStateSnapshot | None = None,
    ) -> None:
        with self._lock:
            path = self._path()
            path.parent.mkdir(parents=True, exist_ok=True)
            stored = self._read_payload()
            history = _parse_history(stored.get("history")) if stored is not None else []
            if not history and previous is not None:
                history.append(_history_entry(previous, previous=None))
            entry = _history_entry(snapshot, previous=previous)
            if history and history[-1]["period"] == entry["period"]:
                history[-1] = entry
            else:
                history.append(entry)
            payload = snapshot.to_storage_payload()
            payload["history"] = history[-_HISTORY_LIMIT:]
            raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
            temporary: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                    handle.write(raw)
                    handle.flush()
                    os.fsync(handle.fileno())
                temporary.replace(path)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)


class AffectiveStateService:
    """Advance and expose the workspace affective state one time bucket at a time."""

    def __init__(
        self,
        workspace: Path,
        config: Any,
        *,
        timezone_name: str | None,
        agent_name: str = "nanobot",
    ) -> None:
        self.agent_name = _normalize_agent_name(agent_name)
        self.store = AffectiveStateStore(workspace, agent_name=self.agent_name)
        self.config = config
        self.timezone_name = timezone_name or "UTC"
        self._lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return bool(getattr(self.config, "enabled", True))

    def read(self) -> AffectiveStateSnapshot | None:
        return self.store.read() if self.enabled else None

    async def ensure_current(
        self,
        *,
        now: datetime | None = None,
        weather: WeatherSnapshot | None = None,
    ) -> AffectiveStateSnapshot | None:
        if not self.enabled:
            return None
        current_time = _aware_utc(now)
        existing = self.store.read()
        if existing is not None and _parse_datetime(existing.valid_until) > current_time:
            return existing
        async with self._lock:
            existing = self.store.read()
            if existing is not None and _parse_datetime(existing.valid_until) > current_time:
                return existing
            resolved_weather = weather
            if resolved_weather is None and self._weather_configured():
                try:
                    resolved_weather = await self._fetch_weather()
                except Exception as exc:
                    logger.warning("Affective-state weather refresh failed: {}", exc)
                    previous_weather = (existing.environment or {}).get("weather") if existing else None
                    resolved_weather = WeatherSnapshot.from_dict(previous_weather, stale=True)
            snapshot = self._generate(current_time, existing, resolved_weather)
            self.store.write(snapshot, previous=existing)
            return snapshot

    def public_payload(self) -> dict[str, Any]:
        if not self.enabled:
            return {"available": False, "enabled": False}
        snapshot = self.store.read()
        if snapshot is None:
            return {"available": False, "enabled": True}
        return {
            **snapshot.to_public_payload(),
            "enabled": True,
            "history": self.store.read_history(),
        }

    def _zone(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.timezone_name)
        except ZoneInfoNotFoundError:
            return ZoneInfo("UTC")

    def _bucket(self, now: datetime) -> tuple[datetime, datetime]:
        local = now.astimezone(self._zone())
        interval = int(getattr(self.config, "refresh_interval_minutes", 360))
        minute_of_day = local.hour * 60 + local.minute
        bucket_minute = (minute_of_day // interval) * interval
        start = local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
            minutes=bucket_minute,
        )
        return start, start + timedelta(minutes=interval)

    def _generate(
        self,
        now: datetime,
        previous: AffectiveStateSnapshot | None,
        weather: WeatherSnapshot | None,
    ) -> AffectiveStateSnapshot:
        start, end = self._bucket(now)
        season = _season(start.month, getattr(self.config, "latitude", None))
        day_period = _day_period(start.hour)
        seed = previous.seed if previous is not None else secrets.token_hex(16)
        weather_key = json.dumps(weather.to_dict(), sort_keys=True) if weather else "none"
        digest = hashlib.sha256(
            f"{seed}|{start.isoformat()}|{season}|{day_period}|{weather_key}".encode(),
        ).digest()
        rng = random.Random(int.from_bytes(digest[:16], "big"))
        weights = {dimension: list(_BASE_WEIGHTS) for dimension in DIMENSION_ORDER}
        _apply_time_bias(weights, day_period)
        _apply_season_bias(weights, season)
        if weather is not None:
            _apply_weather_bias(weights, weather)
        if previous is not None:
            for dimension in DIMENSION_ORDER:
                with_previous = previous.state.get(dimension)
                if with_previous in _LEVELS[dimension]:
                    weights[dimension][_LEVELS[dimension].index(with_previous)] += 0.45
        state = {
            dimension: rng.choices(_LEVELS[dimension], weights=weights[dimension], k=1)[0]
            for dimension in DIMENSION_ORDER
        }
        environment: dict[str, Any] = {
            "season": season,
            "day_period": day_period,
        }
        if weather is not None:
            environment["weather"] = weather.to_dict()
        return AffectiveStateSnapshot(
            period=start.isoformat(),
            valid_until=end.isoformat(),
            state=state,
            descriptions=tuple(describe_affective_state(state, agent_name=self.agent_name)),
            environment=environment,
            seed=seed,
        )

    def _weather_configured(self) -> bool:
        return bool(
            getattr(self.config, "weather_enabled", True)
            and getattr(self.config, "latitude", None) is not None
            and getattr(self.config, "longitude", None) is not None
        )

    async def _fetch_weather(self) -> WeatherSnapshot:
        params = {
            "latitude": getattr(self.config, "latitude"),
            "longitude": getattr(self.config, "longitude"),
            "current": (
                "temperature_2m,precipitation,weather_code,cloud_cover,"
                "wind_speed_10m,is_day"
            ),
            "timezone": "auto",
        }
        url = f"{_OPEN_METEO_URL}?{urlencode(params)}"
        ok, reason = validate_url_target(url)
        if not ok:
            raise RuntimeError(f"weather URL rejected: {reason}")
        timeout = float(getattr(self.config, "weather_timeout_seconds", 3.0))
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.get(url, headers={"User-Agent": "nanobot-affective-state/1"})
            response.raise_for_status()
        current = response.json().get("current")
        if not isinstance(current, Mapping):
            raise ValueError("weather response is missing current conditions")
        weather_code = int(current.get("weather_code", -1))
        return WeatherSnapshot(
            condition=_weather_condition(weather_code),
            weather_code=weather_code,
            temperature_c=_optional_float(current.get("temperature_2m")),
            precipitation_mm=_optional_float(current.get("precipitation")),
            cloud_cover_percent=_optional_float(current.get("cloud_cover")),
            wind_speed_kmh=_optional_float(current.get("wind_speed_10m")),
            observed_at=str(current.get("time") or datetime.now(timezone.utc).isoformat()),
        )


def _aware_utc(value: datetime | None) -> datetime:
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_agent_name(value: Any) -> str:
    return " ".join(str(value or "").split())[:80] or "nanobot"


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _optional_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _season(month: int, latitude: float | None) -> str:
    north = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring", 6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}
    result = north[month]
    if latitude is None or latitude >= 0:
        return result
    return {"winter": "summer", "spring": "autumn", "summer": "winter", "autumn": "spring"}[result]


def _day_period(hour: int) -> str:
    if hour < 6:
        return "night"
    if hour < 12:
        return "morning"
    if hour < 18:
        return "afternoon"
    return "evening"


def _bump(weights: dict[str, list[float]], dimension: str, index: int, amount: float) -> None:
    weights[dimension][index] += amount


def _apply_time_bias(weights: dict[str, list[float]], period: str) -> None:
    if period == "night":
        _bump(weights, "arousal", 0, 0.9)
        _bump(weights, "expressiveness", 0, 0.4)
        _bump(weights, "valence", 0, 0.2)
    elif period == "morning":
        _bump(weights, "arousal", 1, 0.4)
        _bump(weights, "curiosity", 2, 0.35)
    elif period == "afternoon":
        _bump(weights, "arousal", 2, 0.35)
        _bump(weights, "dominance", 2, 0.25)
    else:
        _bump(weights, "arousal", 0, 0.35)
        _bump(weights, "expressiveness", 2, 0.25)


def _apply_season_bias(weights: dict[str, list[float]], season: str) -> None:
    if season == "spring":
        _bump(weights, "curiosity", 2, 0.55)
        _bump(weights, "affiliation", 2, 0.3)
        _bump(weights, "valence", 2, 0.2)
    elif season == "summer":
        _bump(weights, "arousal", 2, 0.55)
        _bump(weights, "expressiveness", 2, 0.4)
        _bump(weights, "valence", 2, 0.25)
    elif season == "autumn":
        _bump(weights, "curiosity", 2, 0.35)
        _bump(weights, "arousal", 1, 0.3)
        _bump(weights, "valence", 0, 0.15)
    else:
        _bump(weights, "arousal", 0, 0.55)
        _bump(weights, "valence", 0, 0.3)
        _bump(weights, "expressiveness", 0, 0.3)


def _apply_weather_bias(weights: dict[str, list[float]], weather: WeatherSnapshot) -> None:
    condition = weather.condition
    if condition == "clear":
        _bump(weights, "valence", 2, 0.65)
        _bump(weights, "arousal", 2, 0.3)
        _bump(weights, "affiliation", 2, 0.2)
    elif condition in {"cloudy", "fog"}:
        _bump(weights, "valence", 0, 0.35)
        _bump(weights, "arousal", 0, 0.3)
    elif condition in {"rain", "snow"}:
        _bump(weights, "valence", 0, 0.55)
        _bump(weights, "arousal", 0, 0.4)
        _bump(weights, "expressiveness", 0, 0.2)
        if condition == "snow":
            _bump(weights, "curiosity", 2, 0.25)
    elif condition == "storm":
        _bump(weights, "arousal", 2, 0.9)
        _bump(weights, "dominance", 0, 0.4)
        _bump(weights, "expressiveness", 2, 0.35)
    if weather.temperature_c is not None:
        if weather.temperature_c < 5 or weather.temperature_c > 30:
            _bump(weights, "arousal", 0, 0.3)
            _bump(weights, "valence", 0, 0.2)
        elif 15 <= weather.temperature_c <= 25:
            _bump(weights, "valence", 2, 0.2)
    if weather.wind_speed_kmh is not None and weather.wind_speed_kmh >= 40:
        _bump(weights, "arousal", 2, 0.35)


def _weather_condition(code: int) -> str:
    if code in {0, 1}:
        return "clear"
    if code in {2, 3}:
        return "cloudy"
    if code in {45, 48}:
        return "fog"
    if code in {71, 73, 75, 77, 85, 86}:
        return "snow"
    if code in {95, 96, 99}:
        return "storm"
    if code in {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82}:
        return "rain"
    return "unknown"
