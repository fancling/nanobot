"""Tool registry for dynamic tool management."""

import json
from typing import Any

from nanobot.agent.tools.base import Tool


class ToolRegistry:
    """
    Registry for agent tools.

    Allows dynamic registration and execution of tools.
    """

    def __init__(self):
        self._tools: dict[str, Tool] = {}
        self._cached_definitions: list[dict[str, Any]] | None = None

    def register(self, tool: Tool) -> None:
        """Register a tool."""
        self._tools[tool.name] = tool
        self._cached_definitions = None

    def unregister(self, name: str) -> None:
        """Unregister a tool by name."""
        self._tools.pop(name, None)
        self._cached_definitions = None

    def get(self, name: str) -> Tool | None:
        """Get a tool by name."""
        return self._tools.get(name)

    @staticmethod
    def _lookup_key(name: str) -> str:
        """Normalize names for suggestions only; never for execution."""
        return "".join(ch.lower() for ch in name if ch.isalnum())

    def _suggest_name(self, name: str) -> str | None:
        key = self._lookup_key(str(name or ""))
        if not key:
            return None
        matches = [
            registered
            for registered in self._tools
            if self._lookup_key(registered) == key
        ]
        if len(matches) == 1:
            return matches[0]
        return None

    def has(self, name: str) -> bool:
        """Check if a tool is registered."""
        return name in self._tools

    @staticmethod
    def _schema_name(schema: dict[str, Any]) -> str:
        """Extract a normalized tool name from either OpenAI or flat schemas."""
        fn = schema.get("function")
        if isinstance(fn, dict):
            name = fn.get("name")
            if isinstance(name, str):
                return name
        name = schema.get("name")
        return name if isinstance(name, str) else ""

    def get_definitions(self) -> list[dict[str, Any]]:
        """Get tool definitions with stable ordering for cache-friendly prompts.

        Built-in tools are sorted first as a stable prefix, then MCP tools are
        sorted and appended.  The result is cached until the next
        register/unregister call.
        """
        if self._cached_definitions is not None:
            return self._cached_definitions

        definitions = [tool.to_schema() for tool in self._tools.values()]
        builtins: list[dict[str, Any]] = []
        mcp_tools: list[dict[str, Any]] = []
        for schema in definitions:
            name = self._schema_name(schema)
            if name.startswith("mcp_"):
                mcp_tools.append(schema)
            else:
                builtins.append(schema)

        builtins.sort(key=self._schema_name)
        mcp_tools.sort(key=self._schema_name)
        self._cached_definitions = builtins + mcp_tools
        return self._cached_definitions

    def prepare_call(
        self,
        name: str,
        params: Any,
    ) -> tuple[Tool | None, Any, str | None]:
        """Resolve, cast, and validate one tool call."""
        tool = self._tools.get(name)
        if not tool:
            suggestion = self._suggest_name(str(name))
            hint = f" Did you mean '{suggestion}'? Tool names must match exactly." if suggestion else ""
            return None, params, (
                f"Error: Tool '{name}' not found.{hint} Available: {', '.join(self.tool_names)}"
            )

        params = self._coerce_params(tool, params)
        if not isinstance(params, dict):
            return tool, params, (
                f"Error: Tool '{name}' parameters must be a JSON object, got "
                f"{type(params).__name__}. Use named parameters like "
                'tool_name(param1="value1", param2="value2") matching the tool schema.'
            )

        cast_params = tool.cast_params(params)
        errors = tool.validate_params(cast_params)
        if errors:
            return tool, cast_params, (
                f"Error: Invalid parameters for tool '{name}': " + "; ".join(errors)
            )
        return tool, cast_params, None

    @classmethod
    def _coerce_argument_value(cls, value: Any) -> Any:
        if value is None:
            return {}
        if not isinstance(value, str):
            return value

        stripped = value.strip()
        if not stripped:
            return {}

        if not stripped.startswith(("{", "[")):
            return value

        try:
            parsed = json.loads(stripped)
        except Exception:
            return value

        return parsed

    @classmethod
    def _coerce_params(cls, tool: Tool, params: Any) -> Any:
        params = cls._coerce_argument_value(params)
        return cls._unwrap_arguments_payload(tool, params)

    @classmethod
    def _unwrap_arguments_payload(cls, tool: Tool, params: Any) -> Any:
        if not isinstance(params, dict) or set(params) != {"arguments"}:
            return params
        properties = (tool.parameters or {}).get("properties", {})
        if isinstance(properties, dict) and "arguments" in properties:
            return params
        return cls._coerce_argument_value(params.get("arguments"))

    async def execute(self, name: str, params: Any) -> Any:
        """Execute a tool by name with given parameters."""
        hint = "\n\n[Analyze the error above and try a different approach.]"
        tool, params, error = self.prepare_call(name, params)
        if error:
            return error + hint

        try:
            assert tool is not None  # guarded by prepare_call()
            result = await tool.execute(**params)
            if isinstance(result, str) and result.startswith("Error"):
                return result + hint
            return result
        except Exception as e:
            return f"Error executing {name}: {str(e)}" + hint

    @property
    def tool_names(self) -> list[str]:
        """Get list of registered tool names."""
        return list(self._tools.keys())

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools


class FilteredToolRegistry(ToolRegistry):
    """View of a tool registry restricted by exact tool names."""

    def __init__(
        self,
        base: ToolRegistry,
        *,
        allowlist: list[str] | tuple[str, ...] | None = None,
        denylist: list[str] | tuple[str, ...] | None = None,
        enabled: bool = True,
    ):
        self._base = base
        self._allowlist = {name for name in (allowlist or []) if name}
        self._denylist = {name for name in (denylist or []) if name}
        self._enabled = enabled
        self._cached_definitions: list[dict[str, Any]] | None = None

    def register(self, tool: Tool) -> None:
        self._base.register(tool)
        self._cached_definitions = None

    def unregister(self, name: str) -> None:
        self._base.unregister(name)
        self._cached_definitions = None

    def _is_allowed(self, name: str) -> bool:
        if not self._enabled:
            return False
        if self._allowlist and name not in self._allowlist:
            return False
        return name not in self._denylist

    def get(self, name: str) -> Tool | None:
        if not self._is_allowed(name):
            return None
        return self._base.get(name)

    def has(self, name: str) -> bool:
        return self._is_allowed(name) and self._base.has(name)

    def get_definitions(self) -> list[dict[str, Any]]:
        if self._cached_definitions is not None:
            return self._cached_definitions
        self._cached_definitions = [
            schema
            for schema in self._base.get_definitions()
            if self._is_allowed(self._schema_name(schema))
        ]
        return self._cached_definitions

    def prepare_call(
        self,
        name: str,
        params: Any,
    ) -> tuple[Tool | None, Any, str | None]:
        if not self._is_allowed(name):
            return None, params, (
                f"Error: Tool '{name}' is not enabled for this workframe profile. "
                f"Available: {', '.join(self.tool_names)}"
            )
        return self._base.prepare_call(name, params)

    async def execute(self, name: str, params: Any) -> Any:
        if not self._is_allowed(name):
            hint = "\n\n[Analyze the error above and try a different approach.]"
            return (
                f"Error: Tool '{name}' is not enabled for this workframe profile. "
                f"Available: {', '.join(self.tool_names)}"
            ) + hint
        return await self._base.execute(name, params)

    @property
    def tool_names(self) -> list[str]:
        return [name for name in self._base.tool_names if self._is_allowed(name)]

    def __len__(self) -> int:
        return len(self.tool_names)

    def __contains__(self, name: str) -> bool:
        return self.has(name)
