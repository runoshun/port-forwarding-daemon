import * as fs from "jsr:@std/fs";
import { parseArgs } from "jsr:@std/cli";
import { PortWatcher } from "./lib/port_watcher.ts";
import { Forwarder } from "./lib/socat.ts";
import { addSshForwarding, deleteSshForwarding } from "./lib/ssh_forwarding.ts";
import * as log from "./lib/logging.ts";

log.init("AGENT_DOCKER");

const args = parseArgs(Deno.args, {
	string: ["forward-url", "pid-file"],
	default: {
		"pid-file": "/tmp/agent_docker.pid",
	},
});

const pidFile = args["pid-file"];

if (fs.existsSync(pidFile)) {
	const pid = parseInt(Deno.readTextFileSync(pidFile));
	log.info(`Killing previous process: ${pid}`);
	Deno.kill(pid, "SIGKILL");
}

if (!args["forward-url"]) {
	log.debug("Forward URL is not provided, exiting...");
	Deno.exit(0);
}

const forwardUrl = args["forward-url"];
const forwarders = new Map<
	number,
	{
		forwarder: Forwarder;
		sourcePort: number;
	}
>();

const containerIp = (() => {
	const p = new Deno.Command("hostname", { args: ["-i"] }).outputSync();
	return new TextDecoder().decode(p.stdout).trim();
})();

const containerId = (() => {
	const p = Deno.readTextFileSync("/proc/1/cpuset").split("/")[1];
	return p.substring(0, 12);
})();

// Watch for new ports
const watcher = new PortWatcher(
	async (port: number) => {
		log.info(`New container port detected: ${port}`);

		const sourcePort = Math.floor(Math.random() * 10000) + 20000;
		try {
			// Create a new forwarder for this port
			const forwarder = new Forwarder({
				sourceType: "tcp",
				sourceAddress: containerIp,
				sourcePort: sourcePort,
				targetType: "tcp",
				targetAddress: "localhost",
				targetPort: port,
			});

			forwarder.start();
			forwarders.set(port, { forwarder, sourcePort });

			// Notify to the management server
			await addSshForwarding(forwardUrl, {
				localPort: port,
				remoteHost: containerIp,
				remotePort: sourcePort,
				tag: containerId,
			});
		} catch (error) {
			log.error("Failed to setup port forwarding:", error);
		}
	},
	async (port: number) => {
		log.info(`Container port closed: ${port}`);
		try {
			// Stop the forwarder
			const entry = forwarders.get(port);
			if (entry) {
				await entry.forwarder.stop();
				forwarders.delete(port);

				// Notify the management server
				await deleteSshForwarding(forwardUrl, {
					remotePort: entry.sourcePort,
					remoteHost: containerIp,
				});
			}
		} catch (error) {
			log.error("Failed to stop port forwarding:", error);
		}
	},
	20000,
);

log.info(`Docker port watcher started, forward server: ${forwardUrl}`);
watcher.start();
Deno.writeTextFileSync(pidFile, Deno.pid.toString());

// Cleanup on exit
const cleanup = async () => {
	watcher.stop();
	for (const entry of forwarders.values()) {
		await entry.forwarder.stop();
	}
	Deno.exit(0);
};

Deno.addSignalListener("SIGINT", cleanup);
Deno.addSignalListener("SIGTERM", cleanup);

// Keep the process running
await new Promise(() => {});
