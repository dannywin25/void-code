export interface Config {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
  maxIterations: number;
  compactThreshold: number;
  compactKeepRecent: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少环境变量 GLM_API_KEY。请到 https://open.bigmodel.cn 注册获取免费 API Key，然后设置：export GLM_API_KEY=你的key"
    );
  }
  return {
    apiKey,
    baseURL: env.GLM_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    model: env.GLM_MODEL ?? "glm-4-flash",
    maxTokens: Number(env.GLM_MAX_TOKENS ?? 4096),
    maxIterations: Number(env.VOID_MAX_ITERATIONS ?? 25),
    compactThreshold: Number(env.VOID_COMPACT_THRESHOLD ?? 8000),
    compactKeepRecent: Number(env.VOID_COMPACT_KEEP_RECENT ?? 6),
  };
}
