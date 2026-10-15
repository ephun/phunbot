// Conservative high-confidence credential shapes shared by evidence and memory.
// This is not a claim that arbitrary unlabeled secrets can be recognized.
const patterns = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|$)/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,})\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@[^\s/]+/i,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/i,
  /["']?\b(?:token|secret|password|client[_-]?secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?[^,\s}"']+/i,
];
export function containsCredential(text) {
  return (
    typeof text === "string" && patterns.some((pattern) => pattern.test(text))
  );
}
export function redactCredentialText(text) {
  return patterns.reduce(
    (result, pattern) =>
      result.replace(
        new RegExp(pattern.source, pattern.flags + "g"),
        "[REDACTED]",
      ),
    text,
  );
}
