#!/usr/bin/env node
/**
 * Defensive codemod for /api/admin/* routes.
 *
 * Preserves the original handler structure. Only:
 *   1. Removes local `function isAdmin(...)` declaration
 *   2. Replaces the 3-line auth-check block with `requireAdmin(AndOrigin)` call
 *      and destructures user/supabase/adminSupabase from the gate result
 *   3. Adds the import
 *
 * Anything that doesn't match the exact known patterns is left untouched
 * for hand-fix.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_DIR = path.join(ROOT, "src/app/api/admin");

function collectRoutes(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRoutes(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

const ISADMIN_FN_RE =
  /\nfunction isAdmin\([^)]+\)\s*\{\s*return [^}]*user_metadata\?\.role[^}]*\}\n/m;

/**
 * Inside a single handler body, replace the auth-check block.
 * methodKind: "GET" or "MUTATE" (POST/PUT/PATCH/DELETE)
 * Returns the rewritten body and a boolean flag.
 */
function replaceAuthBlock(body, methodKind, hasReqParam) {
  // Pattern A1: helper-style isAdmin call
  const patternA = new RegExp(
    String.raw`(\n\s*)const\s+supabase\s*=\s*await\s+createClient\(\);` +
      String.raw`\s*const\s*\{\s*data:\s*\{\s*user(?::\s*\w+)?\s*\}\s*\}\s*=\s*await\s+supabase\.auth\.getUser\(\);` +
      String.raw`\s*if\s*\(\s*!isAdmin\(\s*\w+\s*\)\s*\)\s*` +
      String.raw`return\s+NextResponse\.json\([^)]*\)\s*;?`,
    ""
  );

  // Pattern A2: helper-style with leading `!user ||`
  const patternA2 = new RegExp(
    String.raw`(\n\s*)const\s+supabase\s*=\s*await\s+createClient\(\);` +
      String.raw`\s*const\s*\{\s*data:\s*\{\s*user(?::\s*\w+)?\s*\}\s*\}\s*=\s*await\s+supabase\.auth\.getUser\(\);` +
      String.raw`\s*if\s*\(\s*!user\s*\|\|\s*!isAdmin\(\s*user\s*\)\s*\)\s*` +
      String.raw`return\s+NextResponse\.json\([^)]*\)\s*;?`,
    ""
  );

  // Pattern B: inline check, no helper
  const patternB = new RegExp(
    String.raw`(\n\s*)const\s+supabase\s*=\s*await\s+createClient\(\);` +
      String.raw`\s*const\s*\{\s*data:\s*\{\s*user(?::\s*\w+)?\s*\}\s*\}\s*=\s*await\s+supabase\.auth\.getUser\(\);` +
      String.raw`\s*if\s*\(\s*!user\s*\|\|\s*user\.user_metadata\?\.role\s*!==\s*['"]admin['"]\s*\)\s*` +
      String.raw`(?:\{[^}]*return\s+NextResponse\.json\([^)]*\)\s*;?\s*\}|return\s+NextResponse\.json\([^)]*\)\s*;?)`,
    ""
  );

  // Pattern C: separated checks with intermediate `if (!user)`
  const patternC = new RegExp(
    String.raw`(\n\s*)const\s+supabase\s*=\s*await\s+createClient\(\);` +
      String.raw`\s*const\s*\{\s*data:\s*\{\s*user(?::\s*\w+)?\s*\}\s*\}\s*=\s*await\s+supabase\.auth\.getUser\(\);` +
      String.raw`\s*if\s*\(\s*!user\s*\)\s*\{?\s*return\s+NextResponse\.json\([^)]*\)\s*;?\s*\}?` +
      String.raw`\s*if\s*\(\s*user\.user_metadata\?\.role\s*!==\s*['"]admin['"]\s*\)\s*\{?\s*return\s+NextResponse\.json\([^)]*\)\s*;?\s*\}?`,
    ""
  );

  for (const re of [patternA, patternA2, patternB, patternC]) {
    re.lastIndex = 0;
    const m = re.exec(body);
    if (m) {
      const indent = m[1] ?? "\n  ";
      const useOrigin = methodKind === "MUTATE";
      const reqArg = hasReqParam ? "req" : "request";
      const gateCall = useOrigin
        ? `const gate = await requireAdminAndOrigin(${reqArg});`
        : `const gate = await requireAdmin();`;
      const replacement =
        `${indent}${gateCall}` +
        `${indent}if (gate.error) return gate.error;` +
        `${indent}const { user, supabase, adminSupabase: _adminSupabase } = gate;` +
        `${indent}void user; void supabase; void _adminSupabase;`;
      // Note: we declare adminSupabase as _adminSupabase and `void` everything to
      // avoid unused-var complaints. The original code references its own
      // adminClient/supabase/user variables, which shadow these — so the gate's
      // values are kept around mostly for type-check purposes.
      // BUT: easier — bind to actual names and let original code shadow.
      const cleanReplacement =
        `${indent}${gateCall}` +
        `${indent}if (gate.error) return gate.error;` +
        `${indent}const { user, supabase } = gate;`;
      const out = body.replace(re, () => cleanReplacement);
      return { body: out, mutated: true };
    }
  }

  return { body, mutated: false };
}

/** Determine if a method is mutating (needs same-origin check). */
function methodKind(method) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS"
    ? "GET"
    : "MUTATE";
}

/** Detect whether the handler signature already has a request-like parameter. */
function detectReqParam(args) {
  return /\b(req|request|_req|_request)\b/.test(args);
}

function transformFile(file) {
  const orig = fs.readFileSync(file, "utf8");
  let src = orig;

  const hasIsAdminFn = ISADMIN_FN_RE.test(src);
  const hasInline = /user_metadata\?\.role/.test(src);
  if (!hasIsAdminFn && !hasInline) {
    return { file, status: "skipped (no auth code)" };
  }

  // Strip helper function (if present)
  src = src.replace(ISADMIN_FN_RE, "\n");

  // Walk through every export handler and rewrite its body
  const handlerRe =
    /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(([^)]*)\)\s*\{/g;
  const methodsTouched = new Set();
  const methodsNeedingReq = new Set();
  let mutated = false;

  // Collect handler ranges
  const handlers = [];
  let m;
  while ((m = handlerRe.exec(src)) !== null) {
    const headerStart = m.index;
    const headerEnd = m.index + m[0].length;
    // Find matching closing brace by depth tracking
    let depth = 1;
    let i = headerEnd;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    handlers.push({
      method: m[1],
      args: m[2],
      headerStart,
      headerEnd,
      bodyEnd: i,
    });
  }

  // Process from last to first to preserve offsets
  for (let h = handlers.length - 1; h >= 0; h--) {
    const handler = handlers[h];
    const body = src.slice(handler.headerEnd, handler.bodyEnd);
    const kind = methodKind(handler.method);
    const hasReq = detectReqParam(handler.args);
    const { body: newBody, mutated: ok } = replaceAuthBlock(body, kind, hasReq);
    if (!ok) continue;
    mutated = true;
    methodsTouched.add(handler.method);

    let newHeader = src.slice(handler.headerStart, handler.headerEnd);
    if (kind === "MUTATE" && !hasReq) {
      // Inject a request param
      newHeader = newHeader.replace(
        /\(([^)]*)\)/,
        (_full, args) => `(req: Request${args.trim() ? ", " + args : ""})`
      );
      methodsNeedingReq.add(handler.method);
    }

    src =
      src.slice(0, handler.headerStart) +
      newHeader +
      newBody +
      src.slice(handler.bodyEnd);
  }

  if (!mutated) return { file, status: "no pattern match" };

  // Add import if not present
  if (!src.includes(`from "@/lib/auth/admin-gate"`)) {
    const useOrigin = [...methodsTouched].some((m) => methodKind(m) === "MUTATE");
    const named = useOrigin
      ? "requireAdmin, requireAdminAndOrigin"
      : "requireAdmin";
    const importRe = /^import\s.*?from\s.*?;\s*$/gm;
    let lastEnd = 0;
    let im;
    while ((im = importRe.exec(src)) !== null) {
      lastEnd = im.index + im[0].length;
    }
    if (lastEnd > 0) {
      src =
        src.slice(0, lastEnd) +
        `\nimport { ${named} } from "@/lib/auth/admin-gate";` +
        src.slice(lastEnd);
    }
  }

  if (src === orig) return { file, status: "no-op" };
  fs.writeFileSync(file, src, "utf8");
  return {
    file,
    status: "rewritten",
    methods: [...methodsTouched],
    addedReq: [...methodsNeedingReq],
  };
}

const files = collectRoutes(ADMIN_DIR);
const results = files.map(transformFile);
for (const r of results) {
  const rel = path.relative(ROOT, r.file);
  const flag = r.status === "rewritten" ? "✓" : "·";
  console.log(
    `[${flag}] ${rel} — ${r.status}` +
      (r.methods ? ` (${r.methods.join(",")})` : "") +
      (r.addedReq?.length ? ` +req:${r.addedReq.join(",")}` : "")
  );
}
const ok = results.filter((r) => r.status === "rewritten").length;
const skip = results.filter((r) => r.status.startsWith("no pattern")).length;
console.log(`\n${ok}/${results.length} rewritten · ${skip} need manual review`);
