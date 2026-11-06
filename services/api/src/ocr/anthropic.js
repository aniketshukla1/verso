import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, SCHEMA, USER_TEXT, coerceTranscription } from './prompt.js';

const DEFAULT_MODEL = 'claude-sonnet-5';

// Per docs/PLAN.md §04: the cheaper model for high-volume extraction, the
// expensive one reserved for comparison synthesis.
//
// Serves both Anthropic directly (apiKey, x-api-key header) and gateways that
// speak the same Messages API but authenticate with a bearer token — OpenCode
// Zen is one (authToken + baseUrl). `id` names the route in /health.
export function create({ apiKey, authToken, model, baseUrl, id = 'anthropic', keySource = null }) {
  const name = model ?? DEFAULT_MODEL;
  let client = null;

  return {
    id,
    model: name,
    baseUrl: baseUrl ?? null,
    keySource,
    configured: () => Boolean(apiKey || authToken || process.env.ANTHROPIC_AUTH_TOKEN),

    async transcribe(imageBuffer, mediaType) {
      if (!client) {
        client = new Anthropic({
          // Explicit nulls stop the SDK falling back to ANTHROPIC_API_KEY from
          // the environment and sending a second, wrong credential to a gateway.
          ...(authToken ? { authToken, apiKey: null } : apiKey ? { apiKey } : {}),
          ...(baseUrl ? { baseURL: baseUrl } : {}),
        });
      }

      const res = await client.messages.create({
        model: name,
        max_tokens: 4096,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
            { type: 'text', text: USER_TEXT },
          ],
        }],
      });

      if (res.stop_reason === 'refusal') {
        throw Object.assign(new Error('transcription declined'), { code: 'refusal' });
      }
      const block = res.content.find(b => b.type === 'text');
      if (!block) throw new Error('no transcription returned');

      return { ...coerceTranscription(block.text), model: name, usage: res.usage };
    },
  };
}
