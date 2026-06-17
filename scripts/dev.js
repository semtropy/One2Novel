import { spawn } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const processes = [];

function start(name, args, cwd) {
  // Use process.execPath (node) to run pnpm via its JS entry point
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
      cleanup();
    }
  });

  processes.push(child);
  return child;
}

function cleanup() {
  for (const p of processes) {
    try { p.kill("SIGKILL"); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

console.log("Starting One2Novel...\n");

// Find pnpm location and run
let pnpmCmd = "pnpm";
try {
  // Prefer local pnpm
  pnpmCmd = new URL("../node_modules/.bin/pnpm.cmd", import.meta.url).pathname;
} catch {}

// Start server first
start("server", [pnpmCmd, "--filter", "@one2novel/server", "dev"], ROOT);

// Give server time to start, then start client
await new Promise((r) => setTimeout(r, 4000));

console.log("\n═══════════════════════════════════════");
console.log("  One2Novel");
console.log("═══════════════════════════════════════");
console.log("  Server : http://localhost:7456");
console.log("  Client : http://localhost:7457");
console.log("═══════════════════════════════════════\n");

start("client", [pnpmCmd, "--filter", "@one2novel/client", "dev"], ROOT);
