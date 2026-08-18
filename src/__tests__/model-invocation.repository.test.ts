import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ModelInvocationRepository } from '../repositories/model-invocation.repository';

describe('ModelInvocationRepository', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env['XAI_API_KEY'];
  const originalFixture = process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'model-invoke-'));
    delete process.env['XAI_API_KEY'];
    delete process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env['XAI_API_KEY'];
    else process.env['XAI_API_KEY'] = originalKey;
    if (originalFixture === undefined) {
      delete process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
    } else {
      process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'] = originalFixture;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it('prefers a fixture file over a live provider', async () => {
    const path = join(tmp, 'body.json');
    writeFileSync(path, '{"result":"insufficient-evidence"}');
    process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'] = path;
    process.env['XAI_API_KEY'] = 'xai-test';
    global.fetch = jest.fn();
    const repo = new ModelInvocationRepository();
    const result = await repo.invoke({
      provider: 'xAI',
      model: 'grok-4.6',
      prompt: 'SYNTHETIC_PROMPT_MUST_NOT_REACH_NETWORK',
    });
    expect(result).toEqual({
      ok: true,
      text: '{"result":"insufficient-evidence"}',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is unavailable without a key, for another provider, or a mismatched model', async () => {
    const repo = new ModelInvocationRepository();
    await expect(
      repo.invoke({
        provider: 'xAI',
        model: 'grok-4.6',
        prompt: 'SYNTHETIC',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'unavailable' });
    process.env['XAI_API_KEY'] = 'xai-test';
    global.fetch = jest.fn();
    await expect(
      repo.invoke({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        prompt: 'SYNTHETIC',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'unavailable' });
    await expect(
      repo.invoke({
        provider: 'xAI',
        model: 'gpt-5',
        prompt: 'SYNTHETIC',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts Responses API shape with grok-4.6 and high reasoning', async () => {
    process.env['XAI_API_KEY'] = 'xai-test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'resp-synthetic',
        model: 'grok-4.6',
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '{"result":"observations"}' },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;
    const repo = new ModelInvocationRepository();
    const result = await repo.invoke({
      provider: 'xAI',
      model: 'grok-4.6',
      prompt: 'SYNTHETIC_PROMPT',
      temperature: 0,
    });
    expect(result).toEqual({
      ok: true,
      text: '{"result":"observations"}',
      modelVersion: 'grok-4.6',
      providerRequestId: 'resp-synthetic',
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.x.ai/v1/responses');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer xai-test');
    const body = JSON.parse(init.body as string) as {
      model: string;
      input: string;
      reasoning_effort: string;
      store: boolean;
      search_parameters?: { mode: string };
      temperature: number;
      tools?: unknown;
    };
    expect(body.model).toBe('grok-4.6');
    expect(body.input).toBe('SYNTHETIC_PROMPT');
    expect(body.reasoning_effort).toBe('high');
    expect(body.store).toBe(false);
    expect(body.search_parameters).toBeUndefined();
    expect(body.temperature).toBe(0);
    expect(body.tools).toBeUndefined();
  });

  it('maps refused, timeout, and empty success without leaking the prompt', async () => {
    process.env['XAI_API_KEY'] = 'xai-test';
    const repo = new ModelInvocationRepository();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as unknown as typeof fetch;
    const refused = await repo.invoke({
      provider: 'xAI',
      model: 'grok-4.6',
      prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
    });
    expect(refused).toEqual({ ok: false, failureClass: 'refused' });
    expect(JSON.stringify(refused)).not.toContain('SECRET_PROMPT');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
    }) as unknown as typeof fetch;
    await expect(
      repo.invoke({
        provider: 'xAI',
        model: 'grok-4.6',
        prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'invalid-output' });

    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    ) as unknown as typeof fetch;
    await expect(
      repo.invoke({
        provider: 'xAI',
        model: 'grok-4.6',
        prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'timeout' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: [] }),
    }) as unknown as typeof fetch;
    await expect(
      repo.invoke({
        provider: 'xAI',
        model: 'grok-4.6',
        prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'invalid-output' });
  });
});
