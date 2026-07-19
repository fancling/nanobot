"""Tests for WebUI websocket logging helpers."""

from __future__ import annotations

import logging

from nanobot.webui.websocket_logging import (
    OPENING_HANDSHAKE_FAILED_MESSAGE,
    UNEXPECTED_INTERNAL_ERROR_MESSAGE,
    WebSocketHandshakeNoiseFilter,
)


def _log_record(message: str, exc: BaseException) -> logging.LogRecord:
    return logging.LogRecord(
        name="websockets.server",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def test_websocket_handshake_noise_filter_suppresses_disconnects() -> None:
    filter_ = WebSocketHandshakeNoiseFilter()
    wrapped = RuntimeError("wrapped")
    wrapped.__cause__ = BrokenPipeError(32, "Broken pipe")

    assert not filter_.filter(_log_record(OPENING_HANDSHAKE_FAILED_MESSAGE, BrokenPipeError()))
    assert not filter_.filter(_log_record(OPENING_HANDSHAKE_FAILED_MESSAGE, wrapped))


def test_websocket_handshake_noise_filter_keeps_real_errors() -> None:
    filter_ = WebSocketHandshakeNoiseFilter()

    assert filter_.filter(_log_record(OPENING_HANDSHAKE_FAILED_MESSAGE, RuntimeError("boom")))
    assert filter_.filter(_log_record("connection handler failed", BrokenPipeError()))


def test_websocket_handshake_noise_filter_suppresses_websockets_eof_assert() -> None:
    from websockets.protocol import Protocol, Side

    filter_ = WebSocketHandshakeNoiseFilter()
    protocol = Protocol(side=Side.SERVER)
    protocol.eof_sent = True
    try:
        protocol.send_eof()
    except AssertionError as exc:
        eof_assert = exc
    else:  # pragma: no cover - defensive: this is the upstream behavior being filtered.
        raise AssertionError("send_eof did not raise")

    assert not filter_.filter(_log_record(UNEXPECTED_INTERNAL_ERROR_MESSAGE, eof_assert))
    assert not filter_.filter(_log_record(OPENING_HANDSHAKE_FAILED_MESSAGE, eof_assert))
    assert filter_.filter(_log_record(UNEXPECTED_INTERNAL_ERROR_MESSAGE, AssertionError()))
