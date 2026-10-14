import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ads: null as any }));

vi.mock("@neuralnexus/ampapi", () => ({
  ADS: vi.fn(function () {
    return mocks.ads;
  }),
}));

import { AmpClient } from "./amp-client.js";

const config = {
  baseUri: "https://amp.invalid/",
  username: "test-user",
  password: "test-password",
  allowWrites: true,
};

function makeAds() {
  return {
    relogInterval: 300_000,
    APILogin: vi.fn().mockResolvedValue({ success: true }),
    ADSModule: { GetInstances: vi.fn().mockResolvedValue([]) },
    InstanceLogin: vi.fn(),
  };
}

describe("AmpClient session handling", () => {
  beforeEach(() => {
    mocks.ads = makeAds();
  });

  it("disables the dependency's broken controller auto-relogin timer", async () => {
    const client = new AmpClient(config);
    await client.getController();
    expect(mocks.ads.relogInterval).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("disables the same auto-relogin timer on child instance handles", async () => {
    const child = { relogInterval: 300_000 };
    mocks.ads.ADSModule.GetInstances.mockResolvedValue([
      {
        FriendlyName: "ADS",
        InstanceId: "target-id",
        AvailableInstances: [
          {
            InstanceID: "instance-id",
            InstanceName: "KHQ_Test",
            Module: "Minecraft",
          },
        ],
      },
    ]);
    mocks.ads.InstanceLogin.mockResolvedValue(child);

    const client = new AmpClient(config);
    const instance = await client.getInstance("instance-id");

    expect(instance).toBe(child);
    expect(child.relogInterval).toBe(Number.MAX_SAFE_INTEGER);
  });
});
