import { existsSync, readFileSync } from 'fs';
import { injectable } from 'inversify';
import { ModelInvokeRequest, ModelInvokeResult } from '../types';

/**
 * Model transport for machine interpretation.
 *
 * Resource access only. Returns text or a typed failure. Does not
 * validate observation schema, persist secrets, or log prompts.
 *
 * E4a does not vendor a provider SDK. A JSON fixture path in
 * `CHRONICLE_INTERPRET_MODEL_FIXTURE` is the only non-mock completion
 * path; otherwise the call is `unavailable`. Live adapters should
 * follow the existing `IModelRepository` convention in sdlc-workflow
 * (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) in a later PR.
 */
export interface IModelInvocationRepository {
  invoke(request: ModelInvokeRequest): Promise<ModelInvokeResult>;
}

/**
 * Default transport: fixture file or unavailable. No vendor SDK.
 */
@injectable()
export class ModelInvocationRepository implements IModelInvocationRepository {
  /** @inheritDoc */
  async invoke(request: ModelInvokeRequest): Promise<ModelInvokeResult> {
    void request;
    const fixture = process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
    if (fixture && existsSync(fixture)) {
      return { ok: true, text: readFileSync(fixture, 'utf-8') };
    }
    return { ok: false, failureClass: 'unavailable' };
  }
}
