import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const rootDirectory = process.cwd();
const standaloneDirectory = path.join(rootDirectory, ".next", "standalone");
const serverPath = findStandaloneServer(standaloneDirectory);

if (!serverPath) {
  throw new Error(`Built standalone server not found under ${standaloneDirectory}`);
}
const serverDirectory = path.dirname(serverPath);

const port = await reserveLoopbackPort();
const healthUrl = `http://127.0.0.1:${port}/api/health`;
const server = spawn(process.execPath, [serverPath], {
  cwd: serverDirectory,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput = appendBounded(serverOutput, chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput = appendBounded(serverOutput, chunk);
});

const stopForSignal = async (signal) => {
  await stopServer(server);
  process.exit(128 + (signal === "SIGINT" ? 2 : 15));
};
process.once("SIGINT", () => void stopForSignal("SIGINT"));
process.once("SIGTERM", () => void stopForSignal("SIGTERM"));

try {
  const result = await waitForHealthyResponse(healthUrl, server);
  console.log(
    `Verified ${healthUrl}: status=${result.status} cache-control=${result.cacheControl}`,
  );
} catch (error) {
  if (serverOutput) {
    console.error("Built server output:\n" + serverOutput);
  }
  throw error;
} finally {
  await stopServer(server);
}

async function reserveLoopbackPort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  const selectedPort = typeof address === "object" ? address?.port : undefined;
  listener.close();
  await once(listener, "close");

  if (!selectedPort) {
    throw new Error("Could not reserve a loopback port for the built server");
  }
  return selectedPort;
}

async function waitForHealthyResponse(url, child) {
  let lastError = new Error("Built server did not answer");

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Built server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json();
      const cacheControl = response.headers.get("cache-control") ?? "";

      if (response.status !== 200) {
        throw new Error(`Expected HTTP 200, received ${response.status}`);
      }
      if (body.status !== "ok") {
        throw new Error(`Expected JSON status ok, received ${String(body.status)}`);
      }
      if (!cacheControl.toLowerCase().includes("no-store")) {
        throw new Error(
          `Expected Cache-Control to contain no-store, received ${cacheControl || "<missing>"}`,
        );
      }

      return { status: body.status, cacheControl };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw new Error(`Built health check failed: ${lastError.message}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = once(child, "exit");
  child.kill("SIGTERM");
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, 5_000, "timeout");
  });
  const outcome = await Promise.race([exited.then(() => "exit"), timeout]);
  clearTimeout(timeoutId);

  if (outcome === "timeout" && child.exitCode === null && child.signalCode === null) {
    const killed = once(child, "exit");
    child.kill("SIGKILL");
    await killed;
  }
}

function appendBounded(current, chunk) {
  return (current + chunk.toString()).slice(-65_536);
}

function findStandaloneServer(directory) {
  if (!existsSync(directory)) {
    return undefined;
  }

  const directServer = path.join(directory, "server.js");
  if (existsSync(directServer)) {
    return directServer;
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") {
      continue;
    }
    const nestedServer = findStandaloneServer(path.join(directory, entry.name));
    if (nestedServer) {
      return nestedServer;
    }
  }

  return undefined;
}
