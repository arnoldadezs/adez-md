// index.js — single entry point for hosting platforms (Render/Railway/Heroku/etc.)
// Boots ONE combined server (pair + deploy) on ONE port, as those platforms require.

console.log("Starting ADEZ MD...");

require("./server");
