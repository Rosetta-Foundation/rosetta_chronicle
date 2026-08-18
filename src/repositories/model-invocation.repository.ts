import { existsSync, readFileSync } from 'fs';
import { injectable } from 'inversify';
import { ModelInvokeRequest, ModelInvokeResult } from '../types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const LIVE_PROVIDER = 'anthropic';
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TOKENS = 4096;

interface MessagesResponse {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Model transport for machine interpretation.
 *
 * Resource access only. Returns text or a typed failure. Does not
 * validate observation schema, persist secrets, or log prompts.
 *
 * Completion order: fixture file, then one live Anthropic HTTP call
 * when `--provider anthropic` and `ANTHROPIC_API_KEY` are set.
 * Shape follows sdlc-workflow `IModelRepository` / Messages API
 * (ADR-0003). Chronicle does not depend on that package and does
 * not vendor an SDK.
 */
export interface IModelInvocationRepository {
  invoke(request: ModelInvokeRequest): Promise<ModelInvokeResult>;
}

/**
 * Fixture, Anthropic Messages HTTP, or unavailable. No vendor SDK.
 */
@injectable()
export class ModelInvocationRepository implements IModelInvocationRepository {
  /** @inheritDoc */
  async invoke(request: ModelInvokeRequest): Promise<ModelInvokeResult> {
    const fixture = process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
    if (fixture && existsSync(fixture)) {
      return { ok: true, text: readFileSync(fixture, 'utf-8') };
    }
    if (request.provider.trim().toLowerCase() !== LIVE_PROVIDER) {
      return { ok: false, failureClass: 'unavailable' };
    }
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      return { ok: false, failureClass: 'unavailable' };
    }
    return this.invokeAnthropic(request, apiKey);
  }

  /**
   * One Messages API request. Never logs the prompt or response body.
   */
  private async invokeAnthropic(
    request: ModelInvokeRequest,
    apiKey: string,
  ): Promise<ModelInvokeResult> {
    let response: Response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: MAX_TOKENS,
          ...(request.temperature != null
            ? { temperature: request.temperature }
            : {}),
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, failureClass: 'timeout' };
      }
      return { ok: false, failureClass: 'unavailable' };
    }
    if (!response.ok) {
      return {
        ok: false,
        failureClass: this.failureClassForStatus(response.status),
      };
    }
    let payload: MessagesResponse;
    try {
      payload = (await response.json()) as MessagesResponse;
    } catch {
      return { ok: false, failureClass: 'invalid-output' };
    }
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && block.text != null)
      .map((block) => block.text as string)
      .join('');
    if (!text) {
      return { ok: false, failureClass: 'invalid-output' };
    }
    const requestId =
      response.headers.get('request-id') ??
      response.headers.get('anthropic-request-id') ??
      payload.id;
    return {
      ok: true,
      text,
      ...(payload.model ? { modelVersion: payload.model } : {}),
      ...(requestId ? { providerRequestId: requestId } : {}),
    };
  }

  private failureClassForStatus(
    status: number,
  ): 'unavailable' | 'timeout' | 'refused' {
    if (status === 408 || status === 504) return 'timeout';
    if (status === 400 || status === 401 || status === 403 || status === 422) {
      return 'refused';
    }
    return 'unavailable';
  }
}
