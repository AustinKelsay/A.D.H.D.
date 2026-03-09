// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";

import { createDefaultEndpoints, resolveServiceBaseUrl } from "./app-config";

describe("createDefaultEndpoints", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  test("uses local defaults when metadata is absent", () => {
    const endpoints = createDefaultEndpoints();
    expect(endpoints[0].baseUrl).toBe("http://127.0.0.1:8787");
    expect(endpoints[1].baseUrl).toBe("http://127.0.0.1:8788");
    expect(resolveServiceBaseUrl("host")).toBe("http://127.0.0.1:8787");
    expect(resolveServiceBaseUrl("federation")).toBe("http://127.0.0.1:8788");
  });

  test("respects metadata overrides", () => {
    document.head.innerHTML = `
      <meta name="adhd-host-base-url" content="http://localhost:9001/" />
      <meta name="adhd-federation-base-url" content="http://localhost:9002/" />
    `;

    const endpoints = createDefaultEndpoints();
    expect(endpoints[0].baseUrl).toBe("http://localhost:9001");
    expect(endpoints[1].baseUrl).toBe("http://localhost:9002");
  });
});
