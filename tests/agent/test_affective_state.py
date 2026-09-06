"""Tests for time-scoped affective state generation and persistence."""

from datetime import datetime, timezone

import pytest

from nanobot.agent.affective_state import (
    AFFECTIVE_CONTEXT_PREAMBLE,
    AFFECTIVE_DESCRIPTIONS,
    DIMENSION_ORDER,
    AffectiveStateService,
    WeatherSnapshot,
    _apply_weather_bias,
    _season,
    describe_affective_state,
)
from nanobot.config.schema import AffectiveStateConfig


def test_mapping_is_complete_unique_and_has_three_discrete_values() -> None:
    assert tuple(AFFECTIVE_DESCRIPTIONS) == DIMENSION_ORDER
    descriptions = [
        description
        for dimension in DIMENSION_ORDER
        for description in AFFECTIVE_DESCRIPTIONS[dimension].values()
    ]
    assert all(len(AFFECTIVE_DESCRIPTIONS[dimension]) == 3 for dimension in DIMENSION_ORDER)
    assert len(descriptions) == 18
    assert len(set(descriptions)) == 18


def test_description_mapping_is_ordered_and_rejects_unknown_values() -> None:
    state = {
        "valence": "gloomy",
        "arousal": "depleted",
        "dominance": "uncertain",
        "affiliation": "distant",
        "curiosity": "disengaged",
        "expressiveness": "closed",
    }
    descriptions = describe_affective_state(state, agent_name="Mochi")
    assert descriptions[0] == "Mochi's mood feels low and somewhat pessimistic."
    assert descriptions[-1] == "Mochi's expression feels closed-off and emotionally minimal."
    with pytest.raises(ValueError, match="invalid affective state value for valence"):
        describe_affective_state(
            {**state, "valence": "slightly-sad"},
            agent_name="Mochi",
        )


@pytest.mark.asyncio
async def test_state_is_stable_within_bucket_and_advances_after_expiry(tmp_path) -> None:
    service = AffectiveStateService(
        tmp_path,
        AffectiveStateConfig(refresh_interval_minutes=360, weather_enabled=False),
        timezone_name="Asia/Tokyo",
    )
    first = await service.ensure_current(now=datetime(2026, 9, 4, 1, tzinfo=timezone.utc))
    same = await service.ensure_current(now=datetime(2026, 9, 4, 2, tzinfo=timezone.utc))
    advanced = await service.ensure_current(now=datetime(2026, 9, 4, 7, tzinfo=timezone.utc))

    assert first is not None and same is not None and advanced is not None
    assert first == same
    assert advanced.period != first.period
    assert advanced.seed == first.seed
    assert service.store.path == tmp_path / "memory" / "affective_state.json"

    reloaded = AffectiveStateService(
        tmp_path,
        AffectiveStateConfig(weather_enabled=False),
        timezone_name="Asia/Tokyo",
    ).read()
    assert reloaded == advanced


@pytest.mark.asyncio
async def test_public_payload_exposes_categories_but_not_seed(tmp_path) -> None:
    service = AffectiveStateService(
        tmp_path,
        AffectiveStateConfig(weather_enabled=False),
        timezone_name="UTC",
        agent_name="Mochi",
    )
    snapshot = await service.ensure_current(now=datetime(2026, 1, 5, tzinfo=timezone.utc))
    assert snapshot is not None
    payload = service.public_payload()
    assert payload["available"] is True
    assert "seed" not in payload
    assert tuple(payload["dimensions"]) == DIMENSION_ORDER
    assert payload["context_text"] == snapshot.context_text
    assert payload["context_text"].startswith(AFFECTIVE_CONTEXT_PREAMBLE + "\n\n")
    assert "for this conversation" in payload["context_text"]
    assert "tone, energy, confidence, warmth, curiosity" in payload["context_text"]
    assert "They do not need to appear equally" in payload["context_text"]
    assert "let them override" in payload["context_text"]
    assert all("Mochi" in line for line in snapshot.descriptions)


@pytest.mark.asyncio
async def test_current_agent_name_is_rendered_without_regenerating_values(tmp_path) -> None:
    config = AffectiveStateConfig(weather_enabled=False)
    first = AffectiveStateService(
        tmp_path,
        config,
        timezone_name="UTC",
        agent_name="Mochi",
    )
    original = await first.ensure_current(now=datetime(2026, 1, 5, tzinfo=timezone.utc))

    renamed = AffectiveStateService(
        tmp_path,
        config,
        timezone_name="UTC",
        agent_name="Kumo",
    ).read()

    assert original is not None and renamed is not None
    assert renamed.state == original.state
    assert renamed.seed == original.seed
    assert all("Kumo" in line for line in renamed.descriptions)
    assert all("Mochi" not in line for line in renamed.descriptions)


def test_season_uses_configured_hemisphere() -> None:
    assert _season(1, 35.0) == "winter"
    assert _season(1, -35.0) == "summer"
    assert _season(9, None) == "autumn"


def test_weather_changes_discrete_choice_weights() -> None:
    clear_weights = {dimension: [1.0, 2.0, 1.0] for dimension in DIMENSION_ORDER}
    rain_weights = {dimension: [1.0, 2.0, 1.0] for dimension in DIMENSION_ORDER}
    common = {
        "weather_code": 0,
        "temperature_c": 20.0,
        "precipitation_mm": 0.0,
        "cloud_cover_percent": 0.0,
        "wind_speed_kmh": 5.0,
        "observed_at": "2026-09-04T00:00:00Z",
    }
    _apply_weather_bias(clear_weights, WeatherSnapshot(condition="clear", **common))
    _apply_weather_bias(
        rain_weights,
        WeatherSnapshot(condition="rain", **{**common, "weather_code": 61}),
    )
    assert clear_weights["valence"][2] > rain_weights["valence"][2]
    assert rain_weights["valence"][0] > clear_weights["valence"][0]
    assert rain_weights["expressiveness"][0] > clear_weights["expressiveness"][0]


def test_weather_coordinates_must_be_configured_together() -> None:
    with pytest.raises(ValueError, match="latitude and longitude"):
        AffectiveStateConfig(latitude=35.0)


def test_refresh_interval_must_form_non_overlapping_daily_buckets() -> None:
    assert AffectiveStateConfig(refresh_interval_minutes=180).refresh_interval_minutes == 180
    with pytest.raises(ValueError, match="divide evenly into one day"):
        AffectiveStateConfig(refresh_interval_minutes=1000)
