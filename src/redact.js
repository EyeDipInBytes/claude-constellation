// Secret scrubber. Every piece of text that leaves a file and enters the
// graph passes through here, so a shared page never carries a credential.

const MARK = '‹redacted›';

// Name fragments around a keyword are bounded ({0,32}), never `*`: an unbounded
// run on both sides of the keyword backtracks on long word runs (a 18 KB file of
// "password-" took 50 s). The text before the keyword stays as it is, so the
// keyword can start the match.
const QUOTED = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|"[^\n]*|'[^\n]*`;

const PATTERNS = [
  // Private key blocks, and a block cut before its END line (marker, newline, payload)
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,16384}?-----END [A-Z ]*PRIVATE KEY-----/g, MARK],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[ \t]*\r?\n[A-Za-z0-9+/=\s:,-]*/g, MARK],
  // Provider-shaped tokens
  [/\bsk-[A-Za-z0-9_-]{16,}/g, MARK],
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g, MARK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, MARK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MARK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, MARK],
  [/\b(?:rk|pk|sk|whsec)_(?:live|test)_[A-Za-z0-9]{10,}/g, MARK],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, MARK],
  [/\bnpm_[A-Za-z0-9]{30,}/g, MARK],
  // JSON web tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, MARK],
  // Authorization headers: Digest carries fields to the end of the line; other schemes one value
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?digest)[ \t]+[^\n]*/gi, `$1 ${MARK}`],
  [
    /(\bauthorization["']?[ \t]*[:=][ \t]*["']?)(?:(bearer|basic|token|digest|negotiate)[ \t]+)?([^\s"'`,;]+)/gi,
    (all, lead, scheme, value) => (isReference(value) ? all : `${lead}${scheme ? scheme + ' ' : ''}${MARK}`),
  ],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g, `$1 ${MARK}`],
  [/\b(bearer|basic|token)\s+(?=[A-Za-z._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${MARK}`],
  // Password assignments: any value, any length; quoted values whole (escapes too),
  // unquoted values to the next space, YAML block values (| or >) with their lines
  [
    new RegExp(
      String.raw`((?:passw(?:or)?d|passphrase|pwd)[\w.-]{0,32}["']?[ \t]*[:=][ \t]*)` +
        String.raw`([|>][+-]?[0-9]?[ \t]*\r?\n(?:[ \t]+[^\n]*(?:\n|$))+|${QUOTED}|[^\s"'` + '`' + String.raw`]+)`,
      'gi',
    ),
    (all, lead, value) => (isReference(unquote(value)) ? all : `${lead}${MARK}`),
  ],
  // Command-line credentials: --token X, --oauth2-bearer X, --password "a b", --api-key=X
  [
    new RegExp(
      String.raw`((?:^|\s)--?[\w-]{0,32}(?:token|bearer|secret|passw(?:or)?d|api[_-]?key|credential)[\w-]{0,32}(?:[ \t]+|=))` +
        String.raw`(${QUOTED}|[^\s"'` + '`' + String.raw`]+)`,
      'gim',
    ),
    (all, lead, value) => (isReference(unquote(value)) || value.startsWith('-') ? all : `${lead}${MARK}`),
  ],
  // curl -u user:pass, --user user:pass, --user=user:pass
  [/((?:^|\s)(?:-u|--user)(?:[ \t]+|=)["']?[^\s:"']{1,64}:)[^\s"']+/gm, `$1${MARK}`],
  // Credential query parameters: ?key=, &access_token=, &sig=, &code=
  [
    /([?&][\w.-]{0,32}(?:key|token|secret|sig|signature|passw(?:or)?d|pwd|auth|code|credential)[\w.-]{0,32}=)([^&#\s"'`]+)/gi,
    (all, lead, value) => (isReference(value) ? all : `${lead}${MARK}`),
  ],
  // URLs with credentials: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/:@]{1,128}:[^\s/@]{1,256}@/gi, `$1${MARK}@`],
  // key=value or key: value where the key names a secret
  [
    /((?:api[_-]?key|access[_-]?key|secret|token|passw(?:or)?d|pwd|credential|private[_-]?key|auth)[\w.-]{0,32}["']?\s*[:=]\s*)(["']?)([^\s"'`,;]{6,})\2/gi,
    (all, lead, q, value) => (looksLikeWord(value) ? all : `${lead}${q}${MARK}${q}`),
  ],
  // Long opaque strings: 40+ chars of base64/hex with mixed classes
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, (s) => (isOpaque(s) ? MARK : s)],
];

function unquote(v) {
  return v.replace(/^["']/, '').replace(/["']$/, '');
}

function isReference(v) {
  // A pointer to a secret, not the secret: ${VAR}, $VAR, process.env.X, <placeholder>,
  // or a value this filter already replaced whole
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v)) return true;
  if (/^(?:process\.env|os\.environ|env)[.[]/.test(v)) return true;
  if (/^<[^>\s]+>$/.test(v)) return true;
  if (v === MARK) return true;
  return false;
}

function looksLikeWord(v) {
  // Keep plain words and references: "token: required", "secret = process.env.X", "${VAR}"
  if (/^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(v)) return true;
  if (/^(?:Bearer|Basic|Token)$/i.test(v)) return true;
  if (/^(?:process\.env|os\.environ|env)[.[]/.test(v)) return true;
  if (/^[a-z]+(?:[-_][a-z]+)*$/.test(v) && v.length < 40) return true;
  if (/^<[^>]+>$/.test(v) || /^\[[^\]]+\]$/.test(v)) return true;
  if (v === MARK) return true;
  return false;
}

function isOpaque(s) {
  const core = s.replace(/=+$/, '');
  if (/^[a-f0-9]{40,}$/i.test(core)) return true; // long hex: keys, hashes
  if (core.includes('/') && core.split('/').filter(Boolean).length > 2) return false; // a path
  const parts = core.split(/[-_]/).filter(Boolean);
  if (parts.length >= 3 && parts.every((p) => p.length <= 15 && /^[A-Za-z]+\d{0,4}$/.test(p))) return false; // joined words
  const hasDigit = /\d/.test(core);
  const hasLetter = /[A-Za-z]/.test(core);
  return hasDigit && hasLetter;
}

export function redactSecrets(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function makeTildify(home) {
  const variants = new Set([home]);
  try {
    // macOS resolves /var to /private/var, /tmp to /private/tmp
    if (home.startsWith('/private/')) variants.add(home.slice('/private'.length));
    else variants.add('/private' + home);
  } catch {
    /* ignore */
  }
  const list = [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
  return (s) => {
    if (s == null) return s;
    let out = String(s);
    for (const h of list) {
      if (!h || h === '/') continue;
      out = out.split(h + '/').join('~/');
      if (out === h) out = '~';
      out = out.replace(new RegExp(escapeRe(h) + '(?=$|[\\s"\'`)])', 'g'), '~');
    }
    return out;
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const REDACTED_MARK = MARK;
