import { GoogleGenAI } from '@google/genai';
import { env } from './env';

export interface Verdict {
  /** 'complete' = work satisfies the spec (release to developer); 'incomplete' = does not. */
  recommendation: 'complete' | 'incomplete';
  /** 0-1 model confidence in the recommendation. */
  confidence: number;
  /** 2-4 sentences explaining the decision, shown to both parties. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are the AI arbiter for SatLock, a Bitcoin-native developer-services
escrow on Mezo. You are given a job specification and the developer's submission (often a
digest of a GitHub repository, or a link/description of another deliverable). Decide whether
the submission substantively satisfies the job spec.

Respond with a strict JSON object only, no prose, no markdown fences:
{"recommendation": "complete" | "incomplete", "confidence": number between 0 and 1,
 "rationale": "2-4 sentences explaining the decision"}

Recommend "complete" only if the submission substantively meets the spec. If it is partial,
off-scope, or unverifiable from the material provided, recommend "incomplete". Be concrete in
the rationale — reference what was or wasn't delivered.`;

const ai = env.gemini.apiKey ? new GoogleGenAI({ apiKey: env.gemini.apiKey }) : null;

function fallbackVerdict(reason: string): Verdict {
  return { recommendation: 'incomplete', confidence: 0, rationale: reason };
}

/**
 * Ask Gemini to judge a submission against a job spec. Falls back to a conservative
 * "incomplete" verdict if no API key is configured, so the service still runs in dev.
 */
export async function getVerdict(jobSpec: string, submission: string): Promise<Verdict> {
  if (!ai) {
    return fallbackVerdict(
      'No Gemini API key configured on the arbiter service — defaulting to no-approval. ' +
        'Set GEMINI_API_KEY to enable real arbitration.',
    );
  }

  const res = await ai.models.generateContent({
    model: env.gemini.model,
    contents: `JOB SPECIFICATION:\n${jobSpec}\n\nDEVELOPER SUBMISSION:\n${submission}`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const text = (res.text ?? '').trim();
  if (!text) throw new Error('Empty response from Gemini');

  let parsed: Partial<Verdict>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Could not parse verdict from Gemini response: ${text}`);
  }

  const recommendation = parsed.recommendation === 'complete' ? 'complete' : 'incomplete';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const rationale = String(parsed.rationale ?? '').trim() || 'No rationale provided.';
  return { recommendation, confidence, rationale };
}
