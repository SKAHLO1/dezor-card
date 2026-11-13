import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Exercises getVerdict's provider chain without touching the network: the Gemini SDK is
 * mocked and Groq's HTTP call goes through a stubbed global fetch. env.ts reads API keys at
 * import time, so each test sets the keys and re-imports the module.
 */

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const VERDICT_JSON = JSON.stringify({
  recommendation: 'complete',
  confidence: 0.9,
  rationale: 'All requirements are implemented.',
  checks: [{ requirement: 'Uses TypeScript', status: 'met', evidence: 'src/index.ts' }],
});

function groqResponse(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadArbiter(keys: { gemini?: string; groq?: string }) {
  process.env.GEMINI_API_KEY = keys.gemini ?? '';
  process.env.GROQ_API_KEY = keys.groq ?? '';
  vi.resetModules();
  return import('./arbiter');
}

const fetchMock = vi.fn();
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  generateContent.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
});

describe('getVerdict provider chain', () => {
  it('uses Gemini when it succeeds and never calls Groq', async () => {
    generateContent.mockResolvedValue({ text: VERDICT_JSON });
    const { getVerdict } = await loadArbiter({ gemini: 'g', groq: 'q' });
    const v = await getVerdict('spec', 'submission');
    expect(v.provider).toBe('gemini');
    expect(v.recommendation).toBe('complete');
    expect(v.checks[0].status).toBe('met');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to Groq when Gemini fails', async () => {
    generateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    fetchMock.mockResolvedValue(groqResponse(VERDICT_JSON));
    const { getVerdict } = await loadArbiter({ gemini: 'g', groq: 'q' });
    const v = await getVerdict('spec', 'submission');
    expect(v.provider).toBe('groq');
    expect(v.model).toBe('llama-3.3-70b-versatile');
    expect(v.confidence).toBe(0.9);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content).toContain('<<<SUBMISSION>>>');
    expect(init.headers.authorization).toBe('Bearer q');
  });

  it('falls back to Groq when Gemini returns unparseable output', async () => {
    generateContent.mockResolvedValue({ text: 'not json at all' });
    fetchMock.mockResolvedValue(groqResponse(VERDICT_JSON));
    const { getVerdict } = await loadArbiter({ gemini: 'g', groq: 'q' });
    expect((await getVerdict('spec', 'submission')).provider).toBe('groq');
  });

  it('retries Gemini once on a transient error before falling back', async () => {
    generateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({ text: VERDICT_JSON });
    const { getVerdict } = await loadArbiter({ gemini: 'g', groq: 'q' });
    const v = await getVerdict('spec', 'submission');
    expect(v.provider).toBe('gemini');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses Groq alone when only GROQ_API_KEY is set', async () => {
    fetchMock.mockResolvedValue(groqResponse(VERDICT_JSON));
    const { getVerdict } = await loadArbiter({ groq: 'q' });
    const v = await getVerdict('spec', 'submission', 'dispute');
    expect(v.provider).toBe('groq');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('throws with both errors when every provider fails', async () => {
    generateContent.mockRejectedValue(new Error('400 API key not valid'));
    fetchMock.mockResolvedValue(groqResponse('', 401));
    const { getVerdict } = await loadArbiter({ gemini: 'g', groq: 'q' });
    await expect(getVerdict('spec', 'submission')).rejects.toThrow(/Gemini: .*API key not valid.*Groq: Groq 401/);
  });

  it('returns a conservative incomplete verdict when no provider is configured', async () => {
    const { getVerdict } = await loadArbiter({});
    const v = await getVerdict('do a thing', 'I did a thing');
    expect(v.provider).toBe('none');
    expect(v.recommendation).toBe('incomplete');
    expect(v.confidence).toBe(0);
  });
});
