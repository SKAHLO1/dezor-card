import { env } from './env';

/**
 * Turns a developer's deliverable reference into a compact text digest that the AI arbiter
 * can reason over. Three resolution paths in order of preference:
 *   1. GitHub repo URL  -> rich digest (README + file tree + recent commits)
 *   2. Other public URL -> HTTP fetch + text extraction (HTML stripped, JSON/text passed through)
 *   3. Unreachable      -> URL string + a clear "could not fetch" marker
 *
 * The returned `quality` field tells the caller (and the buyer / admin) how trustworthy
 * the digest is — a verdict produced from a `quality: 'empty'` digest is essentially "AI
 * couldn't see the work" and should be treated as low-confidence by definition.
 */

const GH_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCHED_BYTES = 12_000;

export type DigestQuality = 'github-full' | 'http-fetched' | 'unreachable' | 'empty';

export interface SubmissionDigest {
  digest: string;
  isGithub: boolean;
  resolved: boolean;
  quality: DigestQuality;
  /** Bytes of actual deliverable content (post-extraction) the AI saw — 0 means it saw only the URL. */
  contentBytes: number;
  /** Why the digest is what it is — surface in the UI so reviewers know what the AI was given. */
  note: string;
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'trustiework-arbiter',
  };
  if (env.github.token) headers.authorization = `Bearer ${env.github.token}`;
  return headers;
}

/** Parse `owner` + `repo` out of a GitHub URL, if the string is one. */
function parseRepo(input: string): { owner: string; repo: string } | null {
  const m = input
    .trim()
    .match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function ghJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${GH_API}${path}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function ghText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { ...ghHeaders(), accept: 'application/vnd.github.raw' } });
  if (!res.ok) return null;
  return res.text();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch an arbitrary public URL and return extracted text content. Returns `null` on any
 * failure (timeout, non-2xx, binary content). Caller decides what to put in the digest.
 */
async function fetchUrlText(url: string): Promise<{ text: string; contentType: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'trustiework-arbiter',
        accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.1',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    if (raw.length === 0) return null;
    let text: string;
    if (/html|xml/i.test(contentType)) text = stripHtml(raw);
    else if (/json|text|javascript|markdown/i.test(contentType)) text = raw;
    else return null; // probably binary — don't feed garbage to Gemini
    return { text: text.slice(0, MAX_FETCHED_BYTES), contentType };
  } catch {
    return null;
  }
}

/** Build a digest for a deliverable. See SubmissionDigest for the per-field meaning. */
export async function buildSubmissionDigest(submissionUrl: string): Promise<SubmissionDigest> {
  const url = submissionUrl.trim();
  if (!url) {
    return {
      digest: '(no submission URL provided)',
      isGithub: false,
      resolved: false,
      quality: 'empty',
      contentBytes: 0,
      note: 'No deliverable URL was provided.',
    };
  }

  const repo = parseRepo(url);

  // --- Path 1: GitHub repo ---
  if (repo) {
    const meta = await ghJson<{
      full_name: string;
      description: string | null;
      language: string | null;
      default_branch: string;
      pushed_at: string;
      stargazers_count: number;
    }>(`/repos/${repo.owner}/${repo.repo}`);

    if (!meta) {
      // Repo is private, gone, or we hit the GitHub rate limit. Fall through to a generic
      // fetch attempt — sometimes the URL still serves a public page (e.g. github.io site).
      const fallback = await fetchUrlText(url);
      if (fallback) {
        const digest = `GitHub repo ${repo.owner}/${repo.repo} could not be read via the API (private, missing, or rate-limited). Fetched HTML instead:\n\n${fallback.text}`;
        return {
          digest,
          isGithub: true,
          resolved: true,
          quality: 'http-fetched',
          contentBytes: fallback.text.length,
          note: 'GitHub API unreachable; fell back to HTML scrape.',
        };
      }
      return {
        digest: `GitHub repository ${repo.owner}/${repo.repo} could not be read (private, missing, or rate-limited).`,
        isGithub: true,
        resolved: false,
        quality: 'unreachable',
        contentBytes: 0,
        note:
          'GitHub returned an error for this repo. Most common causes: private repo, deleted repo, or hitting the public-API rate limit (set GITHUB_TOKEN to raise it).',
      };
    }

    const [readme, tree, commits] = await Promise.all([
      ghText(`${GH_API}/repos/${repo.owner}/${repo.repo}/readme`),
      ghJson<{ tree: { path: string; type: string }[]; truncated: boolean }>(
        `/repos/${repo.owner}/${repo.repo}/git/trees/${meta.default_branch}?recursive=1`,
      ),
      ghJson<{ commit: { message: string; author: { date: string } } }[]>(
        `/repos/${repo.owner}/${repo.repo}/commits?per_page=15`,
      ),
    ]);

    const fileList = (tree?.tree ?? [])
      .filter((n) => n.type === 'blob')
      .map((n) => n.path)
      .slice(0, 200);

    const commitLines = (commits ?? [])
      .map((c) => `- ${c.commit.author.date.slice(0, 10)}  ${c.commit.message.split('\n')[0]}`)
      .join('\n');

    const readmeText = (readme ?? '(no README)').slice(0, 6000);
    const digest = [
      `GitHub repository: ${meta.full_name}`,
      `Description: ${meta.description ?? '(none)'}`,
      `Primary language: ${meta.language ?? '(unknown)'}  |  Stars: ${meta.stargazers_count}  |  Last push: ${meta.pushed_at}`,
      '',
      `Files (${fileList.length}${tree?.truncated ? '+' : ''}):`,
      fileList.join('\n') || '(no files found)',
      '',
      `Recent commits:`,
      commitLines || '(no commits found)',
      '',
      `README:`,
      readmeText,
    ].join('\n');

    return {
      digest,
      isGithub: true,
      resolved: true,
      quality: 'github-full',
      contentBytes: readmeText.length + fileList.join('\n').length + commitLines.length,
      note: `Indexed ${fileList.length} files${tree?.truncated ? '+' : ''}, ${(commits ?? []).length} recent commits, and the README (${readmeText.length} chars).`,
    };
  }

  // --- Path 2: arbitrary public URL ---
  const fetched = await fetchUrlText(url);
  if (fetched) {
    return {
      digest: `Deliverable URL (not a GitHub repo): ${url}\nContent-Type: ${fetched.contentType}\n\nExtracted content:\n${fetched.text}`,
      isGithub: false,
      resolved: true,
      quality: 'http-fetched',
      contentBytes: fetched.text.length,
      note: `Fetched ${fetched.text.length} characters of ${fetched.contentType || 'unknown content'} from the URL.`,
    };
  }

  // --- Path 3: unreachable ---
  return {
    digest: `Deliverable URL (could not fetch): ${url}\n(The AI has no content to analyze beyond the URL itself.)`,
    isGithub: false,
    resolved: false,
    quality: 'unreachable',
    contentBytes: 0,
    note:
      'The submitted URL was unreachable, returned a non-2xx status, served binary content, or timed out. The AI verdict will be very low confidence. Ask the developer for a GitHub repo or a publicly accessible page.',
  };
}
