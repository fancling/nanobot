import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AffectiveStatePage } from "@/components/AffectiveStatePage";
import { fetchAffectiveState } from "@/lib/api";
import type { NanobotClient } from "@/lib/nanobot-client";
import type { AffectiveStatePayload } from "@/lib/types";
import { ClientProvider } from "@/providers/ClientProvider";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  fetchAffectiveState: vi.fn(),
}));

const client = {} as NanobotClient;
const payload: AffectiveStatePayload = {
  available: true,
  enabled: true,
  period: "2026-09-04T12:00:00+09:00",
  valid_until: "2026-09-04T18:00:00+09:00",
  dimensions: {
    valence: { value: "gloomy", description: "Mochi's mood feels low and somewhat pessimistic." },
    arousal: { value: "depleted", description: "Mochi's energy feels depleted and slow-moving." },
    dominance: { value: "uncertain", description: "Mochi's current stance feels hesitant and less assured." },
    affiliation: { value: "distant", description: "Mochi feels distant and guarded in this interaction." },
    curiosity: { value: "disengaged", description: "Mochi has little appetite for unfamiliar ideas right now." },
    expressiveness: { value: "closed", description: "Mochi's expression feels closed-off and emotionally minimal." },
  },
  context_text: "[AFFECTIVE STATE]\n\nThese descriptions are part of the agent's current internal state.\nAllow them to subtly shape how the agent responds, rather than treating\nthem as facts to mention or explicit roleplaying instructions.\n\nMochi's mood feels low and somewhat pessimistic.\nMochi's energy feels depleted and slow-moving.",
  environment: {
    season: "autumn",
    day_period: "afternoon",
    weather: {
      condition: "rain",
      weather_code: 61,
      temperature_c: 18,
      precipitation_mm: 1.2,
      cloud_cover_percent: 90,
      wind_speed_kmh: 12,
      observed_at: "2026-09-04T11:40:00Z",
      stale: true,
      provider: "open-meteo",
    },
  },
  history: [{
    period: "2026-09-04T06:00:00+09:00",
    valid_until: "2026-09-04T12:00:00+09:00",
    state: {
      valence: "neutral",
      arousal: "steady",
      dominance: "balanced",
      affiliation: "receptive",
      curiosity: "interested",
      expressiveness: "measured",
    },
    environment: { season: "autumn", day_period: "morning" },
    changed_dimensions: ["arousal"],
    initial: false,
  }],
};

function page() {
  return <ClientProvider client={client} token="test-token">
    <AffectiveStatePage active onBackToChat={() => {}} />
  </ClientProvider>;
}

beforeEach(() => {
  vi.mocked(fetchAffectiveState).mockReset().mockResolvedValue(payload);
});

describe("AffectiveStatePage", () => {
  it("shows all six discrete dimensions, environment and exact context", async () => {
    render(page());
    expect(await screen.findByText("Gloomy")).toBeInTheDocument();
    for (const label of ["Mood", "Energy", "Stance", "Affiliation", "Curiosity", "Expression"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Autumn")).toBeInTheDocument();
    expect(screen.getByText("Rain")).toBeInTheDocument();
    expect(screen.getByText(/cached conditions were used/)).toBeInTheDocument();
    expect(screen.getByTestId("affective-context")).toHaveTextContent(
      "[AFFECTIVE STATE] These descriptions are part of the agent's current internal state. Allow them to subtly shape how the agent responds, rather than treating them as facts to mention or explicit roleplaying instructions. Mochi's mood feels low and somewhat pessimistic. Mochi's energy feels depleted and slow-moving.",
    );
    expect(screen.getByRole("link", { name: "Weather data by Open-Meteo" })).toHaveAttribute(
      "href", "https://open-meteo.com/",
    );
    expect(screen.getByText("State history")).toBeInTheDocument();
    expect(screen.getByTestId("affective-history")).toHaveTextContent("Energy: Steady");
  });

  it("can retry a failed read", async () => {
    vi.mocked(fetchAffectiveState).mockRejectedValueOnce(new Error("offline"));
    render(page());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Gloomy")).toBeInTheDocument());
    expect(fetchAffectiveState).toHaveBeenCalledTimes(2);
  });
});
