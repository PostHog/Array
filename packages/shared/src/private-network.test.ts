import { describe, expect, it } from "vitest";
import { isPrivateIpv4Octets } from "./private-network";

describe("isPrivateIpv4Octets", () => {
  it.each([
    [0, 1, "this network"],
    [127, 0, "loopback"],
    [10, 0, "RFC1918 10/8"],
    [172, 16, "RFC1918 172.16/12 lower bound"],
    [172, 31, "RFC1918 172.16/12 upper bound"],
    [192, 168, "RFC1918 192.168/16"],
    [169, 254, "link-local"],
    [100, 64, "CGNAT lower bound"],
    [100, 127, "CGNAT upper bound"],
    [198, 18, "benchmarking lower bound"],
    [198, 19, "benchmarking upper bound"],
  ])("treats %d.%d.x.x (%s) as private", (a, b) => {
    expect(isPrivateIpv4Octets(a, b)).toBe(true);
  });

  it.each([
    [8, 8, "public DNS"],
    [1, 1, "public DNS"],
    [172, 15, "just below RFC1918 172.16/12"],
    [172, 32, "just above RFC1918 172.16/12"],
    [100, 63, "just below CGNAT"],
    [100, 128, "just above CGNAT"],
    [198, 17, "just below benchmarking"],
    [198, 20, "just above benchmarking"],
  ])("treats %d.%d.x.x (%s) as public", (a, b) => {
    expect(isPrivateIpv4Octets(a, b)).toBe(false);
  });
});
