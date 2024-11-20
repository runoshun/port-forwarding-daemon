import { BaseAgent } from "./base.ts";
import { PortDetector } from "../lib/detector/port.ts";
import { SocketForwarder } from "../lib/forwarder/socket.ts";
import { addSshForwarding, deleteSshForwarding } from "../lib/forwarder/ssh.ts";
import * as log from "../lib/logging.ts";

export class DockerContainerAgent extends BaseAgent {
	private readonly watcher: PortDetector;
	private readonly forwarders = new Map<
		number,
		{ forwarder: SocketForwarder; sourcePort: number }
	>();
	private readonly containerIp: string;
	private readonly containerId: string;

	constructor(
		private readonly forwardUrl: string,
		minPort = 20000,
	) {
		super("DOCKER-CONTAINER", "/tmp/docker_container_agent.pid");

		// Get container IP
		this.containerIp = (() => {
			const p = new Deno.Command("hostname", { args: ["-i"] }).outputSync();
			return new TextDecoder().decode(p.stdout).trim();
		})();

		// Get container ID
		this.containerId = (() => {
			const p = Deno.readTextFileSync("/proc/1/cpuset").split("/")[1];
			return p.substring(0, 12);
		})();

		this.watcher = new PortDetector(
			async (port: number) => {
				log.info(`New container port detected: ${port}`);

				const sourcePort = Math.floor(Math.random() * 10000) + 20000;
				try {
					// Create a new forwarder for this port
					const forwarder = new SocketForwarder({
						sourceType: "tcp",
						sourceAddress: this.containerIp,
						sourcePort: sourcePort,
						targetType: "tcp",
						targetAddress: "localhost",
						targetPort: port,
					});

					forwarder.start();
					this.forwarders.set(port, { forwarder, sourcePort });

					// Notify to the management server
					await addSshForwarding(this.forwardUrl, {
						localPort: port,
						remoteHost: this.containerIp,
						remotePort: sourcePort,
						tag: this.containerId,
					});
				} catch (error) {
					log.error("Failed to setup port forwarding:", error);
				}
			},
			async (port: number) => {
				log.info(`Container port closed: ${port}`);
				try {
					// Stop the forwarder
					const entry = this.forwarders.get(port);
					if (entry) {
						await entry.forwarder.stop();
						this.forwarders.delete(port);

						// Notify the management server
						await deleteSshForwarding(this.forwardUrl, {
							remotePort: entry.sourcePort,
							remoteHost: this.containerIp,
						});
					}
				} catch (error) {
					log.error("Failed to stop port forwarding:", error);
				}
			},
			minPort,
		);
	}

	override async start(): Promise<void> {
		await super.start();
		log.info(
			`Docker container agent started, forward server: ${this.forwardUrl}`,
		);
		this.watcher.start();
	}

	override async stop(): Promise<void> {
		this.watcher.stop();
		for (const entry of this.forwarders.values()) {
			await entry.forwarder.stop();
		}
		await super.stop();
	}
}
