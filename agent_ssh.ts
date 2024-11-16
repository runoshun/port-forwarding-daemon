import { PortWatcher } from "./lib/port_watcher.ts";

import * as log from "./lib/logging.ts";
import { addSshForwarding, deleteSshForwarding } from "./lib/ssh_forwarding.ts";
import { DockerAgentManager } from "./lib/docker_agent_manager.ts";

log.init("AGENT_SSH");

// dockerServerCode is defined in the combined bundle from main.ts
declare const dockerServerCode: string;

if (Deno.args.length !== 1) {
	console.error("Usage: deno run remote_server.ts <manager-server-url>");
	Deno.exit(1);
}

const managerServerUrl = Deno.args[0];

// Watch for new ports on the remote server
const watcher = new PortWatcher(
	async (port: number) => {
		log.info(`New port detected: ${port}`);

		try {
			await addSshForwarding(managerServerUrl, {
				localPort: port,
				remoteHost: "localhost",
				remotePort: port,
			});
		} catch (error) {
			log.error("Failed to send forwarding request:", error);
		}
	},
	async (port: number) => {
		log.info(`Port closed: ${port}`);
		try {
			await deleteSshForwarding(managerServerUrl, {
				remotePort: port,
			});
		} catch (error) {
			log.error("Failed to send stop forwarding request:", error);
		}
	},
);

const dockerAgentManager = new DockerAgentManager(
	dockerServerCode,
	managerServerUrl,
);

watcher.start();
dockerAgentManager.start();
log.info(`SSH agent started on remote, manager server: ${managerServerUrl}`);

// Cleanup on exit
const cleanup = async () => {
	watcher.stop();
	await dockerAgentManager.stopAll();
	log.info("Cleanup agent_ssh done, exiting...");
	Deno.exit(0);
};

Deno.addSignalListener("SIGINT", cleanup);
Deno.addSignalListener("SIGTERM", cleanup);
