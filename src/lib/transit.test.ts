import { describe, expect, it } from "vitest";
import { DESTINATIONS, HOME_AREAS, searchJourneys } from "./transit";

const input = {
  home: HOME_AREAS[0],
  destinationId: DESTINATIONS[0].id,
  date: "2026-10-27",
  arrivalTime: "10:00",
};
const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

describe("demonstration route search", () => {
  it("returns alternatives before the requested arrival with a correct total duration", () => {
    const journeys = searchJourneys(input);
    expect(journeys).toHaveLength(3);
    expect(journeys.some((journey) => journey.demandBus)).toBe(true);
    expect(journeys.some((journey) => !journey.demandBus)).toBe(true);
    for (const journey of journeys) {
      expect(minutes(journey.arrivalTime)).toBeLessThanOrEqual(600);
      expect(journey.durationMinutes).toBe(
        minutes(journey.arrivalTime) - minutes(journey.departureTime),
      );
      expect(journey.steps[0].departureTime).toBe(journey.departureTime);
      expect(journey.steps.at(-1)?.arrivalTime).toBe(journey.arrivalTime);
      expect(journey.transferCount).toBe(journey.demandBus ? 1 : 0);
    }
  });

  it("keeps each step in temporal and geographical order including the transfer wait", () => {
    for (const journey of searchJourneys(input)) {
      journey.steps.forEach((step, index) => {
        expect(minutes(step.arrivalTime) - minutes(step.departureTime)).toBe(
          step.durationMinutes,
        );
        if (index > 0) {
          const previous = journey.steps[index - 1];
          expect(previous.to).toBe(step.from);
          expect(minutes(step.departureTime)).toBeGreaterThanOrEqual(
            minutes(previous.arrivalTime),
          );
        }
      });
      const busIndex = journey.steps.findIndex((step) => step.type === "bus");
      expect(
        minutes(journey.steps[busIndex].departureTime) -
          minutes(journey.steps[busIndex - 1].arrivalTime),
      ).toBe(5);
    }
  });

  it("sorts by latest departure and generates stable, distinct identifiers", () => {
    const journeys = searchJourneys(input);
    expect(journeys.map((journey) => journey.id)).toEqual(
      searchJourneys(input).map((journey) => journey.id),
    );
    expect(new Set(journeys.map((journey) => journey.id)).size).toBe(
      journeys.length,
    );
    for (let index = 1; index < journeys.length; index += 1) {
      expect(minutes(journeys[index - 1].departureTime)).toBeGreaterThanOrEqual(
        minutes(journeys[index].departureTime),
      );
    }
  });

  it("distinguishes custom home coordinates while keeping renamed homes the same route", () => {
    const customHome = { ...input.home, id: "custom" };
    const original = searchJourneys({ ...input, home: customHome });
    const moved = searchJourneys({
      ...input,
      home: { ...customHome, lat: customHome.lat + 0.005 },
    });
    const renamed = searchJourneys({
      ...input,
      home: { ...customHome, label: "新しい呼び名" },
    });
    expect(original.map((journey) => journey.id)).toEqual(
      renamed.map((journey) => journey.id),
    );
    for (const route of original) {
      expect(moved.some((other) => other.id === route.id)).toBe(false);
    }
  });

  it("has no overnight service and never invents a departure before service starts", () => {
    expect(searchJourneys({ ...input, arrivalTime: "06:20" })).toEqual([]);
    for (const journey of searchJourneys({ ...input, arrivalTime: "07:30" })) {
      expect(minutes(journey.departureTime)).toBeGreaterThanOrEqual(390);
    }
    for (const journey of searchJourneys({ ...input, arrivalTime: "23:59" })) {
      const bus = journey.steps.find((step) => step.type === "bus")!;
      expect(minutes(bus.departureTime)).toBeLessThanOrEqual(1200);
    }
  });

  it("supports every destination and changes travel duration by home area", () => {
    for (const destination of DESTINATIONS) {
      const journeys = searchJourneys({
        ...input,
        destinationId: destination.id,
      });
      expect(journeys.length).toBeGreaterThan(0);
      expect(
        journeys.every((journey) => journey.destination.id === destination.id),
      ).toBe(true);
    }
    const near = searchJourneys(input).find((journey) => journey.demandBus)!;
    const far = searchJourneys({ ...input, home: HOME_AREAS[1] }).find(
      (journey) => journey.demandBus,
    )!;
    expect(far.durationMinutes).toBeGreaterThan(near.durationMinutes);
  });

  it.each(["25:00", "12:61", "9:00", "", "noon"])(
    "rejects malformed arrival time %s",
    (arrivalTime) => {
      expect(() => searchJourneys({ ...input, arrivalTime })).toThrow(
        "到着時刻",
      );
    },
  );

  it.each(["2026-02-29", "2026-13-01", "", "2026-1-01"])(
    "rejects invalid date %s",
    (date) => {
      expect(() => searchJourneys({ ...input, date })).toThrow("お出かけの日");
    },
  );

  it("accepts a valid leap date and rejects unknown destinations and invalid home coordinates", () => {
    expect(
      searchJourneys({ ...input, date: "2028-02-29" }).length,
    ).toBeGreaterThan(0);
    expect(() =>
      searchJourneys({ ...input, destinationId: "unknown" }),
    ).toThrow("目的地");
    expect(() =>
      searchJourneys({ ...input, home: { ...input.home, lat: Number.NaN } }),
    ).toThrow("ご自宅");
  });
});
