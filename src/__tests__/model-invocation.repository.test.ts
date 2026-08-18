import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ModelInvocationRepository } from '../repositories/model-invocation.repository';

describe('ModelInvocationRepository', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env['ANTHROPIC_API_KEY'];
  const originalFixture = process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'model-invoke-'));
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['CHRONICLE_INTERPRET_MODEL_FIXTURE'];
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = originalKey;
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
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    global.fetch = jest.fn();
    const repo = new ModelInvocationRepository();
    const result = await repo.invoke({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      prompt: 'SYNTHETIC_PROMPT_MUST_NOT_REACH_NETWORK',
    });
    expect(result).toEqual({
      ok: true,
      text: '{"result":"insufficient-evidence"}',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is unavailable without a key or for a second provider', async () => {
    const repo = new ModelInvocationRepository();
    await expect(
      repo.invoke({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        prompt: 'SYNTHETIC',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'unavailable' });
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    await expect(
      repo.invoke({
        provider: 'openai',
        model: 'gpt-x',
        prompt: 'SYNTHETIC',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'unavailable' });
  });

  it('maps a Messages response to text, modelVersion, and request id', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name === 'request-id' ? 'req-synthetic' : null,
      },
      json: async () => ({
        id: 'msg-synthetic',
        model: 'claude-sonnet-4-5-20250929',
        content: [
          { type: 'text', text: '{"result":"observations"}' },
          { type: 'tool_use' },
        ],
      }),
    }) as unknown as typeof fetch;
    const repo = new ModelInvocationRepository();
    const result = await repo.invoke({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      prompt: 'SYNTHETIC_PROMPT',
      temperature: 0,
    });
    expect(result).toEqual({
      ok: true,
      text: '{"result":"observations"}',
      modelVersion: 'claude-sonnet-4-5-20250929',
      providerRequestId: 'req-synthetic',
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    const body = JSON.parse(init.body as string) as {
      model: string;
      temperature: number;
      messages: Array<{ role: string }>;
    };
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.temperature).toBe(0);
    expect(body.messages[0]?.role).toBe('user');
  });

  it('maps refused, timeout, and empty success without leaking the prompt', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    const repo = new ModelInvocationRepository();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as unknown as typeof fetch;
    const refused = await repo.invoke({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
    });
    expect(refused).toEqual({ ok: false, failureClass: 'refused' });
    expect(JSON.stringify(refused)).not.toContain('SECRET_PROMPT');

    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    ) as unknown as typeof fetch;
    await expect(
      repo.invoke({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'timeout' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ content: [] }),
    }) as unknown as typeof fetch;
    await expect(
      repo.invoke({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        prompt: 'SECRET_PROMPT_MUST_NOT_LEAK',
      }),
    ).resolves.toEqual({ ok: false, failureClass: 'invalid-output' });
  });
});
