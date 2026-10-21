import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

export const name = "token-ledger";
export const inject = ["webServer"];

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const ROUTE = "/plugins/token-ledger/summary";
const CACHE_MS = 1500;

/** Decode every zstd frame of one session log into JSON records. */
function readRecords(buffer) {
  const offsets = [];
  let at = 0;
  while ((at = buffer.indexOf(MAGIC, at)) !== -1) {
    offsets.push(at);
    at += 4;
  }
  const parts = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length;
    try {
      parts.push(zstdDecompressSync(buffer.subarray(start, end)).toString("utf8"));
    } catch {
      // A truncated tail frame is expected while a session is still writing.
    }
  }
  const records = [];
  for (const line of parts.join("").split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore a half-written trailing line.
    }
  }
  return records;
}

/** Recursively collect every session log under the sessions root. */
async function findLogs(root) {
  const found = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/^session\.v\d+\.jsonl\.zstd$/.test(entry.name)) found.push(path);
    }
  };
  await walk(root);
  return found;
}

/**
 * Fold one session log into per-request usage rows.
 *
 * Provider and model are read from the assistant message's own source, which
 * every adapter stamps — the session-level model/selection log only exists for
 * top-level sessions, so relying on it would silently drop subagent traffic.
 */
function foldSession(path, records) {
  const header = records.find((record) => record.type === "session");
  if (header === undefined) return undefined;
  const requests = [];
  let unmetered = 0;
  for (const record of records) {
    if (record.type !== "assistant/message") continue;
    const usage = record.data?.usage;
    if (usage === undefined) {
      unmetered += 1;
      continue;
    }
    const source = record.data?.message?.source ?? {};
    requests.push({
      session: header.id,
      parent: header.parentSession ?? null,
      isSubagent: header.origin === "subagent",
      cwd: header.cwd ?? "",
      time: record.time,
      provider: source.provider ?? "unknown",
      model: source.model ?? "unknown",
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      cacheRead: usage.cacheReadTokens ?? 0,
      cacheWrite: usage.cacheWriteTokens ?? 0,
      reasoning: usage.reasoningTokens ?? 0,
    });
  }
  return { requests, unmetered };
}

/** Sum one bucket of usage counters. */
function add(bucket, request) {
  bucket.requests += 1;
  bucket.input += request.input;
  bucket.output += request.output;
  bucket.cacheRead += request.cacheRead;
  bucket.cacheWrite += request.cacheWrite;
  bucket.reasoning += request.reasoning;
}

/** Create an empty usage bucket. */
function emptyBucket() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

/** Aggregate every request into the shapes the panel renders. */
function summarize(requests) {
  const byProvider = {};
  const byModel = {};
  const byDay = {};
  const bySession = {};
  const totals = emptyBucket();
  for (const request of requests) {
    add(totals, request);
    const provider = (byProvider[request.provider] ??= emptyBucket());
    add(provider, request);
    const modelKey = request.provider + "/" + request.model;
    const model = (byModel[modelKey] ??= { ...emptyBucket(), provider: request.provider, model: request.model });
    add(model, request);
    const day = new Date(request.time).toLocaleDateString("sv-SE");
    add((byDay[day] ??= emptyBucket()), request);
    const session = (bySession[request.session] ??= {
      ...emptyBucket(),
      session: request.session,
      parent: request.parent,
      isSubagent: request.isSubagent,
      cwd: request.cwd,
      first: request.time,
      last: request.time,
      providers: {},
    });
    add(session, request);
    session.first = Math.min(session.first, request.time);
    session.last = Math.max(session.last, request.time);
    session.providers[request.provider] = true;
  }
  const billed = totals.input + totals.cacheRead + totals.cacheWrite + totals.output;
  return {
    totals: { ...totals, billed },
    byProvider,
    byModel,
    byDay,
    bySession,
    sessions: Object.keys(bySession).length,
    generatedAt: Date.now(),
  };
}

/** Read every session log and return one aggregated snapshot. */
async function collect(sessionsRoot) {
  const logs = await findLogs(sessionsRoot);
  const requests = [];
  let unmetered = 0;
  for (const path of logs) {
    let buffer;
    try {
      buffer = await readFile(path);
    } catch {
      continue;
    }
    const folded = foldSession(path, readRecords(buffer));
    if (folded === undefined) continue;
    unmetered += folded.unmetered;
    for (const request of folded.requests) requests.push(request);
  }
  return { ...summarize(requests), unmetered };
}

/** Send a JSON response. */
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function apply(ctx, config) {
  const sessionsRoot = config?.sessionsRoot ?? join(homedir(), ".dsh", "sessions");
  let cached;
  let cachedAt = 0;
  let inFlight;

  const snapshot = async () => {
    if (cached !== undefined && Date.now() - cachedAt < CACHE_MS) return cached;
    if (inFlight !== undefined) return inFlight;
    inFlight = collect(sessionsRoot)
      .then((value) => {
        cached = value;
        cachedAt = Date.now();
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: ROUTE,
        handler: async (req, res) => {
          if (req.method !== "GET") {
            res.statusCode = 405;
            res.end();
            return;
          }
          try {
            sendJson(res, 200, await snapshot());
          } catch (error) {
            sendJson(res, 500, { error: String(error) });
          }
        },
      }),
    "token-ledger: usage summary route",
  );
}
