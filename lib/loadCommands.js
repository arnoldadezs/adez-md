// lib/loadCommands.js — scans the commands/ folder and loads every command module

const fs = require("fs");
const path = require("path");

function loadCommands() {
  const commands = new Map();
  const dir = path.join(__dirname, "..", "commands");

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const cmd = require(path.join(dir, file));

    if (!cmd?.name || typeof cmd.execute !== "function") {
      console.warn(`[WARN] Skipping invalid command file: ${file}`);
      continue;
    }

    commands.set(cmd.name.toLowerCase(), cmd);
    if (Array.isArray(cmd.aliases)) {
      for (const alias of cmd.aliases) commands.set(alias.toLowerCase(), cmd);
    }
  }

  return commands;
}

module.exports = { loadCommands };
