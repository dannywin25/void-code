import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("缺少 GLM_API_KEY 时抛出可读错误", () => {
    expect(() => loadConfig({})).toThrow(/GLM_API_KEY/);
  });

  it("有 key 时返回默认配置", () => {
    const cfg = loadConfig({ GLM_API_KEY: "k" });
    expect(cfg.apiKey).toBe("k");
    expect(cfg.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(cfg.model).toBe("glm-4-flash");
    expect(cfg.maxIterations).toBe(25);
  });

  it("环境变量可覆盖默认值", () => {
    const cfg = loadConfig({ GLM_API_KEY: "k", GLM_MODEL: "glm-4-air", VOID_MAX_ITERATIONS: "10" });
    expect(cfg.model).toBe("glm-4-air");
    expect(cfg.maxIterations).toBe(10);
  });

  it("压缩阈值默认值与 env 覆盖", () => {
    const def = loadConfig({ GLM_API_KEY: "k" });
    expect(def.compactThreshold).toBe(8000);
    expect(def.compactKeepRecent).toBe(6);
    const ov = loadConfig({ GLM_API_KEY: "k", VOID_COMPACT_THRESHOLD: "100", VOID_COMPACT_KEEP_RECENT: "2" });
    expect(ov.compactThreshold).toBe(100);
    expect(ov.compactKeepRecent).toBe(2);
  });
});
