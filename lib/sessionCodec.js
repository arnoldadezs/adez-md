// lib/sessionCodec.js — turns a Baileys auth folder into one "Session ID" string, and back

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PREFIX = "ADEZ~"; // marks this as an ADEZ MD session id

/**
 * Reads every *.json file in sessionDir (creds.json + key files),
 * bundles them, gzips, and base64-encodes into one string.
 */
function encodeSession(sessionDir) {
  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error("No session files found to encode");

  const bundle = {};
  for (const file of files) {
    bundle[file] = fs.readFileSync(path.join(sessionDir, file), "utf8");
  }

  const json = JSON.stringify(bundle);
  const gzipped = zlib.gzipSync(json);
  return PREFIX + gzipped.toString("base64");
}

/**
 * Reverses encodeSession: writes every file back out into targetDir
 * so useMultiFileAuthState(targetDir) can pick it up.
 */
function decodeSession(sessionId, targetDir) {
  const trimmed = sessionId.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("Invalid session ID: missing ADEZ~ prefix");
  }

  const b64 = trimmed.slice(PREFIX.length);
  const gzipped = Buffer.from(b64, "base64");
  const json = zlib.gunzipSync(gzipped).toString("utf8");
  const bundle = JSON.parse(json);

  fs.mkdirSync(targetDir, { recursive: true });
  for (const [filename, content] of Object.entries(bundle)) {
    fs.writeFileSync(path.join(targetDir, filename), content, "utf8");
  }
}

module.exports = { encodeSession, decodeSession, PREFIX };
