import { env } from './env';

/**
 * Turns a developer's deliverable reference into a compact text digest that the AI arbiter
 * can reason over. GitHub repo links are expanded (metadata + README + file tree + recent
 * commits) via the public REST API; anything else is passed through verbatim.
 */

const GH_API = 'https://api.github.com';

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'satlock-arbiter',
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

/**
 * Build a digest for a deliverable. Returns the digest text plus whether it was a GitHub
 * repo we could actually read (used by callers to flag unverifiable submissions).
 */
export async function buildSubmissionDigest(
  submissionUrl: string,
): Promise<{ digest: string; isGithub: boolean; resolved: boolean }> {
  const repo = parseRepo(submissionUrl);
  if (!repo) {
    return { digest: `Deliverable reference (non-GitHub):\n${submissionUrl}`, isGithub: false, resolved: false };
  }

  const meta = await ghJson<{
    full_name: string;
    description: string | null;
    language: string | null;
    default_branch: string;
    pushed_at: string;
    stargazers_count: number;
  }>(`/repos/${repo.owner}/${repo.repo}`);

  if (!meta) {
    return {
      digest: `GitHub repository ${repo.owner}/${repo.repo} could not be read (private, missing, or rate-limited).`,
      isGithub: true,
      resolved: false,
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
    (readme ?? '(no README)').slice(0, 6000),
  ].join('\n');

  return { digest, isGithub: true, resolved: true };
}
