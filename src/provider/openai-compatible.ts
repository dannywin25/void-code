import OpenAI from "openai";
import { Provider, ChatParams, ChatResult } from "./types.js";
import { StreamAssembler, StreamDelta } from "./assemble.js";

interface ProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
}

// 流式分片的最小形状（与 openai chunk 兼容）
interface StreamChunk {
  choices: Array<{ delta?: StreamDelta }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

type StreamFactory = (params: ChatParams) => Promise<AsyncIterable<StreamChunk>>;

export class OpenAICompatibleProvider implements Provider {
  private readonly streamFactory: StreamFactory;

  constructor(private opts: ProviderOptions, streamFactory?: StreamFactory) {
    const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 3 });
    this.streamFactory =
      streamFactory ??
      (async (params) =>
        (await client.chat.completions.create(
          {
            model: opts.model,
            messages: params.messages as any,
            tools: params.tools.length ? (params.tools as any) : undefined,
            max_tokens: opts.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: params.signal }
        )) as unknown as AsyncIterable<StreamChunk>);
  }

  async chat(params: ChatParams): Promise<ChatResult> {
    const stream = await this.streamFactory(params);
    const assembler = new StreamAssembler();
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta) assembler.addDelta(delta, params.onTextDelta);
      if (chunk.usage) assembler.setUsage(chunk.usage);
    }
    return assembler.result();
  }
}
