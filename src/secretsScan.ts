import type { FileDiff } from './diffFilter';

export type SecretType =
  | 'openrouter-key'
  | 'anthropic-key'
  | 'api-key-sk'
  | 'github-token'
  | 'aws-access-key'
  | 'slack-token'
  | 'gcp-api-key'
  | 'jwt'
  | 'private-key'
  | 'env-file'
  | 'url-credentials'
  | 'keystore-file';

export interface Finding {
  readonly fileName: string;
  readonly type: SecretType;
}

/** Human-readable labels; never includes any matched secret value. */
export const SECRET_TYPE_LABELS: Readonly<Record<SecretType, string>> = {
  'openrouter-key': 'OpenRouter API key (sk-or-...)',
  'anthropic-key': 'Anthropic API key (sk-ant-...)',
  'api-key-sk': 'API key (sk-...)',
  'github-token': 'GitHub token (ghp_/github_pat_...)',
  'aws-access-key': 'AWS access key (AKIA/ASIA...)',
  'slack-token': 'Slack token (xox...)',
  'gcp-api-key': 'Google API key (AIza...)',
  jwt: 'JSON Web Token',
  'private-key': 'Private key block (PEM)',
  'env-file': '.env file',
  'url-credentials': 'credentials embedded in a URL',
  'keystore-file': 'keystore/certificate bundle',
};

interface ContentPattern {
  readonly type: SecretType;
  readonly regex: RegExp;
}

const CONTENT_PATTERNS: readonly ContentPattern[] = [
  { type: 'openrouter-key', regex: /\bsk-or-[A-Za-z0-9_-]{16,}\b/ },
  { type: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { type: 'api-key-sk', regex: /\bsk-(?!or-|ant-)[A-Za-z0-9_-]{20,}\b/ },
  { type: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { type: 'github-token', regex: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { type: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { type: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { type: 'gcp-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { type: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    type: 'private-key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    type: 'url-credentials',
    regex: /\b[a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^/\s:@]{1,100}:[^/\s@]{1,200}@/,
  },
];

function fileNameFindings(fileName: string): Finding[] {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1);
  const findings: Finding[] = [];
  if (/^\.env($|\.)/.test(base)) findings.push({ fileName, type: 'env-file' });
  if (/\.(jks|keystore|p12|pfx)$/i.test(base)) findings.push({ fileName, type: 'keystore-file' });
  return findings;
}

/**
 * Scans the diff for patterns that look like secrets. Findings never carry
 * the matched value, only the file and the secret category.
 */
export function scanDiff(files: readonly FileDiff[]): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const push = (fileName: string, type: SecretType): void => {
    const key = `${fileName}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ fileName, type });
  };
  for (const file of files) {
    for (const finding of fileNameFindings(file.fileName)) {
      push(finding.fileName, finding.type);
    }
    for (const line of file.chunk.split('\n')) {
      if (line.startsWith('diff --git ') || line.startsWith('index ')) continue;
      for (const pattern of CONTENT_PATTERNS) {
        if (pattern.regex.test(line)) push(file.fileName, pattern.type);
      }
    }
  }
  return findings;
}
