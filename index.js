// index.js — single entry point for hosting platforms (Render/Railway/Heroku/etc.)
// Boots ONE combined server (pair + deploy) on ONE port, as those platforms require.

// Without these, an uncaught error kills the process with NO log output on some
// hosts (you just see "Application exited early" and nothing else). These make
// sure the real error always gets printed before the process goes down.
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled rejection:", reason);
  process.exit(1);
});

console.log("Starting ADEZ MD...");

require("./server");
