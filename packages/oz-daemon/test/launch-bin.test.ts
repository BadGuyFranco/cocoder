import { describe, expect, it } from "vitest";
import { resolveLaunchBin } from "../src/launch-bin.js";

const HOME = "/install/cocoder";
const DEFAULT_BIN = "/install/cocoder/packages/cocoder-cli/bin/cocoder";

describe("resolveLaunchBin", () => {
  it("prefers COCODER_LAUNCH_BIN override when it exists", () => {
    const bin = resolveLaunchBin(HOME, { COCODER_LAUNCH_BIN: "/custom/cocoder" }, (p) => p === "/custom/cocoder");
    expect(bin).toBe("/custom/cocoder");
  });

  it("falls back to the cocoderHome-relative bin when no override", () => {
    const bin = resolveLaunchBin(HOME, {}, (p) => p === DEFAULT_BIN);
    expect(bin).toBe(DEFAULT_BIN);
  });

  it("ignores an override that does not exist and uses the relative bin", () => {
    const bin = resolveLaunchBin(HOME, { COCODER_LAUNCH_BIN: "/missing" }, (p) => p === DEFAULT_BIN);
    expect(bin).toBe(DEFAULT_BIN);
  });

  it("returns undefined (stub mode) when no bin exists", () => {
    const bin = resolveLaunchBin(HOME, {}, () => false);
    expect(bin).toBeUndefined();
  });
});
