import { SYSTEM, SCHEMA, USER_TEXT, coerceTranscription, IDENTIFY_SYSTEM, identifyUserText, coerceIdentification } from './prompt.js';

/**
 * Any endpoint speaking OpenAI's /chat/completions with image_url content:
 * OpenCode Zen, OpenRouter, Groq, Together, or a local llama.cpp / LM Studio /
 * Ollama server. Deliberately plain `fetch` rather than the `openai` SDK — one
 * fewer dependency, and nothing here needs more than a POST.
 */
export function create({ apiKey, model, baseUrl, id = 'openai-compatible', keySource = null, timeoutMs }) {
  const base = (baseUrl ?? 'https://opencode.ai/zen/v1').replace(/\/+$/, '');

  return {
    id,
    model,
    baseUrl: base,
    keySource,
    // A local model needs no key, so a base URL alone is enough to be configured.
    configured: () => Boolean(model && (apiKey || /localhost|127\.0\.0\.1/.test(base))),

    // `signal` lets a caller racing several models cancel the losers.
    async transcribe(imageBuffer, mediaType, { signal } = {}) {
      const dataUrl = `data:${mediaType};base64,${imageBuffer.toString('base64')}`;

      const body = {
        model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [
            { type: 'text', text: USER_TEXT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ]},
        ],
        // Ask for structured output; providers that do not support it ignore
        // the field, and coerceTranscription picks up the pieces.
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'transcription', strict: true, schema: SCHEMA },
        },
      };

      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        // Unset for local models, which can take minutes on a laptop.
        ...(timeoutMs || signal
          ? { signal: AbortSignal.any([timeoutMs && AbortSignal.timeout(timeoutMs), signal].filter(Boolean)) }
          : {}),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        let message = detail.slice(0, 300);
        try {
          const j = JSON.parse(detail);
          message = (Array.isArray(j) ? j[0] : j)?.error?.message ?? message;   // Gemini wraps it in an array
        } catch {}
        // Surface the provider's own words: "free tier can only be used in
        // OpenCode" and "no payment method" are answers, not mysteries.
        throw Object.assign(new Error(`${model}: ${message}`), { status: res.status });
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('no transcription returned');

      return { ...coerceTranscription(content), model, usage: json.usage };
    },

    // Text only: what each unknown label term names (packages/canon/src/identify.js).
    // Timed by the caller's signal alone: the photo timeout above is for a user
    // waiting on a screen, and this runs on into the cache in the background.
    async identifyTerms(terms, { market, signal } = {}) {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model, temperature: 0, max_tokens: 2048,
          messages: [{ role: 'system', content: IDENTIFY_SYSTEM }, { role: 'user', content: identifyUserText(terms, market) }],
          response_format: { type: 'json_object' },
        }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw Object.assign(new Error(`${model}: identification failed (${res.status})`), { status: res.status });
      const json = await res.json();
      return { model, items: coerceIdentification(json?.choices?.[0]?.message?.content), usage: json.usage };
    },
  };
}
