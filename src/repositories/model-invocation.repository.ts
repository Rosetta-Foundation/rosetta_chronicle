import { existsSync, readFileSync } from 'fs';
import { injectable } from 'inversify';
import { ModelInvokeRequest, ModelInvokeResult } from '../types';

const XAI_URL = 'https://api.x.ai/v1/responses';
const LIVE_PROVIDER = 'xai';
const REASONING_EFFORT = 'high';
const REQUEST_TIMEOUT_MS = 45_000;

interface ResponsesOutputContent {
  type?: string;
  text?: string;
}

interface ResponsesOutputItem {
  type?: string;
  content?: ResponsesOutputContent[];
}

interface ResponsesBody {
  id?: string;
  model?: string;
  output_text?: string;
  output?: ResponsesOutputItem[];
}

/**
 * Model transport for machine interpretation.
 *
 * Resource access only. Returns text or a typed failure. Does not
 * validate observation schema, persist secrets, or log prompts.
 *
 * Completion order: fixture file, then one xAI Responses HTTP call
 * when `--provider` is xAI and `XAI_API_KEY` is set. No vendor SDK.
 * Search and tool use are off. `store` is false so the request is
 * not kept as a retrievable xAI response.
 */
export interface IModelInvocationRepository {
  invoke(request: ModelInvokeRequest): Promise<ModelInvokeResult>;
}

/**
 * Fixture, xAI Responses HTTP, or unavailable. No vendor SDK.
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
    const apiKey = process.env['XAI_API_KEY'];
    if (!apiKey) {
      return { ok: false, failureClass: 'unavailable' };
    }
    return this.invokeXai(request, apiKey);
  }

  /**
   * One Responses API request. Never logs the prompt or response body.
   */
  private async invokeXai(
    request: ModelInvokeRequest,
    apiKey: string,
  ): Promise<ModelInvokeResult> {
    let response: Response;
    try {
      response = await fetch(XAI_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          input: request.prompt,
          reasoning_effort: REASONING_EFFORT,
          store: false,
          search_parameters: { mode: 'off' },
          ...(request.temperature != null
            ? { temperature: request.temperature }
            : {}),
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
    let payload: ResponsesBody;
    try {
      payload = (await response.json()) as ResponsesBody;
    } catch {
      return { ok: false, failureClass: 'invalid-output' };
    }
    const text = this.responseText(payload);
    if (!text) {
      return { ok: false, failureClass: 'invalid-output' };
    }
    return {
      ok: true,
      text,
      ...(payload.model ? { modelVersion: payload.model } : {}),
      ...(payload.id ? { providerRequestId: payload.id } : {}),
    };
  }

  private responseText(payload: ResponsesBody): string {
    if (payload.output_text) return payload.output_text;
    const parts: string[] = [];
    for (const item of payload.output ?? []) {
      for (const block of item.content ?? []) {
        if (block.type === 'output_text' && block.text) {
          parts.push(block.text);
        }
      }
    }
    return parts.join('');
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
