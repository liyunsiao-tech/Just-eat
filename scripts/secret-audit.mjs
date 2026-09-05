import { execFileSync } from "node:child_process";

const mode = process.argv[2] || "--staged";

const secretPrefixes = {
  openAi: ["s", "k", "-"].join(""),
  google: ["A", "I", "z", "a"].join(""),
  github: ["gh", "p", "_"].join(""),
  githubPat: ["github", "_", "pat", "_"].join(""),
  slack: ["xox", "b", "-"].join(""),
};

const contentPatterns = [
  { label: "OpenAI-style key", pattern: new RegExp(`(?:^|[^A-Za-z0-9])${secretPrefixes.openAi}[A-Za-z0-9]{20,}`) },
  { label: "Google key", pattern: new RegExp(`${secretPrefixes.google}[A-Za-z0-9_-]{20,}`) },
  { label: "GitHub or Slack token", pattern: new RegExp(`(?:${secretPrefixes.github}|${secretPrefixes.githubPat}|${secretPrefixes.slack})[A-Za-z0-9_-]{16,}`) },
  { label: "private key material", pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/ },
  { label: "JWT-like token", pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { label: "credential assignment", pattern: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_\-/+]{20,}/i },
  { label: "GPS-like decimal", pattern: /(?<![\d.])-?\d{1,3}\.\d{4,}(?![\d.])/ },
];

const forbiddenPath = /(?:^|\/)(?:\.env(?!\.example$)|.*\.(?:pem|key|p12|pfx)|id_rsa)$/i;

function git(args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "buffer" });
}

function namesFromGit(args) {
  const output = git(args).toString("utf8");
  return output.split("\0").filter(Boolean);
}

function scanContent(name, content, findings) {
  if (content.includes("\0")) return;
  const text = content.toString("utf8");
  for (const { label, pattern } of contentPatterns) {
    if (pattern.test(text)) findings.push(`${name}: ${label}`);
  }
}

function scanFiles(names, read) {
  const findings = [];
  for (const name of names) {
    if (forbiddenPath.test(name)) findings.push(`${name}: forbidden credential-like path`);
    const content = read(name);
    if (content.length <= 1_000_000) scanContent(name, content, findings);
  }
  return findings;
}

function scanStaged() {
  const names = namesFromGit(["diff", "--cached", "--name-only", "-z"]);
  return scanFiles(names, (name) => git(["show", `:${name}`]));
}

function scanHistory() {
  const commits = git(["rev-list", "--all"]).toString("utf8").trim().split("\n").filter(Boolean);
  const findings = [];
  for (const commit of commits) {
    const names = namesFromGit(["ls-tree", "-r", "--name-only", "-z", commit]);
    const commitFindings = scanFiles(names, (name) => git(["show", `${commit}:${name}`]));
    findings.push(...commitFindings.map((finding) => `${commit.slice(0, 12)} ${finding}`));
  }
  return findings;
}

let findings;
try {
  if (mode === "--staged") findings = scanStaged();
  else if (mode === "--history") findings = scanHistory();
  else throw new Error("usage: node scripts/secret-audit.mjs --staged|--history");
} catch (error) {
  console.error(`Secret audit could not run: ${error.message}`);
  process.exit(2);
}

if (findings.length) {
  console.error("Secret audit FAILED:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`${mode} secret audit: PASS (${mode === "--history" ? "all commits" : "staged files"})`);
