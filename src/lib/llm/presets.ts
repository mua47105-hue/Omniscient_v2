// LLM Provider Presets — pre-configured templates for common providers.
//
// Users can add any of these with one click + their API key. Each preset
// includes the provider's baseUrl, recommended models, free-tier limits,
// and a help link for getting an API key.

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  apiKeyPlaceholder: string;
  notes: string;
  helpUrl: string;
  envVar?: string; // the HF Secret env var name that overrides this provider's key
  models: {
    modelId: string;
    displayName: string;
    contextWindow: number;
    freeTierRpm: number;
  }[];
  free: boolean; // true = no API key needed (Pollinations)
  popular: boolean; // show at top of the presets list
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'Pollinations',
    baseUrl: 'https://text.pollinations.ai/openai',
    apiKeyPlaceholder: 'free-no-key-needed',
    notes: 'Completely free, NO API key required. Always available. Default for the Lazy Brain. Model: openai (gpt-oss-20b).',
    helpUrl: 'https://pollinations.ai',
    envVar: '',
    free: true,
    popular: true,
    models: [
      { modelId: 'openai', displayName: 'OpenAI (gpt-oss-20b)', contextWindow: 128000, freeTierRpm: 60 },
    ],
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyPlaceholder: 'sk-or-v1-...',
    notes: 'Aggregates 100+ models from OpenAI, Anthropic, Google, Meta, etc. Free tier available. Pay-as-you-go.',
    helpUrl: 'https://openrouter.ai/keys',
    envVar: 'OPENROUTER_API_KEY',
    free: false,
    popular: true,
    models: [
      { modelId: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 50 },
      { modelId: 'google/gemini-2.0-flash-exp:free', displayName: 'Gemini 2.0 Flash (free)', contextWindow: 1048576, freeTierRpm: 20 },
      { modelId: 'deepseek/deepseek-chat', displayName: 'DeepSeek V3', contextWindow: 64000, freeTierRpm: 50 },
    ],
  },
  {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyPlaceholder: 'gsk_...',
    notes: 'Ultra-fast inference (500+ tok/s). Free tier: 30 RPM, 14k tokens/min. Best for real-time analysis.',
    helpUrl: 'https://console.groq.com/keys',
    envVar: 'GROQ_API_KEY',
    free: false,
    popular: true,
    models: [
      { modelId: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile', contextWindow: 128000, freeTierRpm: 30 },
      { modelId: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', contextWindow: 128000, freeTierRpm: 60 },
    ],
  },
  {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyPlaceholder: 'AIza...',
    notes: 'Google Gemini. Free tier: 15 RPM, 1M tokens/min. 1M context window on Flash.',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    envVar: 'GEMINI_API_KEY',
    free: false,
    popular: true,
    models: [
      { modelId: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1048576, freeTierRpm: 15 },
      { modelId: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro', contextWindow: 1048576, freeTierRpm: 5 },
    ],
  },
  {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyPlaceholder: '...',
    notes: 'Mistral AI. Free tier: 1 RPM, 500k tokens/month. Good for European data residency.',
    helpUrl: 'https://console.mistral.ai/api-keys/',
    envVar: 'MISTRAL_API_KEY',
    free: false,
    popular: false,
    models: [
      { modelId: 'mistral-large-latest', displayName: 'Mistral Large', contextWindow: 128000, freeTierRpm: 1 },
      { modelId: 'mistral-small-latest', displayName: 'Mistral Small', contextWindow: 32000, freeTierRpm: 1 },
    ],
  },
  {
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyPlaceholder: 'nvapi-...',
    notes: 'NVIDIA NIM. Free tier: 1000 credits/month. Hosts Llama, Mistral, Qwen models on NVIDIA infra.',
    helpUrl: 'https://build.nvidia.com',
    envVar: 'NVIDIA_NIM_API_KEY',
    free: false,
    popular: false,
    models: [
      { modelId: 'meta/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 40 },
      { modelId: 'qwen/qwen2.5-72b-instruct', displayName: 'Qwen 2.5 72B', contextWindow: 32768, freeTierRpm: 40 },
    ],
  },
  {
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyPlaceholder: 'csk-...',
    notes: 'Cerebras — fastest inference (2000+ tok/s). Free tier available. Limited model selection.',
    helpUrl: 'https://cloud.cerebras.ai',
    envVar: 'CEREBRAS_API_KEY',
    free: false,
    popular: false,
    models: [
      { modelId: 'llama-3.3-70b', displayName: 'Llama 3.3 70B', contextWindow: 128000, freeTierRpm: 20 },
      { modelId: 'llama3.1-8b', displayName: 'Llama 3.1 8B', contextWindow: 128000, freeTierRpm: 50 },
    ],
  },
  {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyPlaceholder: '...',
    notes: 'Together AI. $5 free credit. Hosts 200+ open-source models. Pay-as-you-go.',
    helpUrl: 'https://api.together.ai/settings/api-keys',
    envVar: '',
    free: false,
    popular: false,
    models: [
      { modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Turbo', contextWindow: 128000, freeTierRpm: 60 },
      { modelId: 'Qwen/Qwen2.5-72B-Instruct-Turbo', displayName: 'Qwen 2.5 72B', contextWindow: 32768, freeTierRpm: 60 },
    ],
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyPlaceholder: 'sk-...',
    notes: 'DeepSeek API. Very cheap ($0.27/M tokens). Excellent reasoning models.',
    helpUrl: 'https://platform.deepseek.com/api_keys',
    envVar: '',
    free: false,
    popular: false,
    models: [
      { modelId: 'deepseek-chat', displayName: 'DeepSeek V3', contextWindow: 64000, freeTierRpm: 60 },
      { modelId: 'deepseek-reasoner', displayName: 'DeepSeek R1 (reasoning)', contextWindow: 64000, freeTierRpm: 60 },
    ],
  },
  {
    name: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyPlaceholder: 'xai-...',
    notes: 'xAI Grok. $25 free credit per month. Real-time X/Twitter data access.',
    helpUrl: 'https://console.x.ai',
    envVar: 'XAI_API_KEY',
    free: false,
    popular: false,
    models: [
      { modelId: 'grok-3', displayName: 'Grok 3', contextWindow: 131072, freeTierRpm: 30 },
      { modelId: 'grok-3-mini', displayName: 'Grok 3 Mini', contextWindow: 131072, freeTierRpm: 30 },
    ],
  },
];

/** Get a preset by provider name (case-insensitive). */
export function getPresetByName(name: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
}
