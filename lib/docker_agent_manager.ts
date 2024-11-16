import * as log from "./logging.ts";
import { DockerDetector } from "./docker_detector.ts";
import { Forwarder } from "./socat.ts";
import { deleteSshForwarding } from "./ssh_forwarding.ts";

export class DockerAgentManager {
	private agents = new Set<string>();
	private readonly DOCKER_SCRIPT_PATH = "/tmp/docker_server.ts";
	private readonly DENO_INSTALL_PATH = "/tmp/deno";
	private readonly DOCKER_LABEL = "auto.port.forwarding.enabled";

	private readonly dockerDetector: DockerDetector;
	private readonly managerServerForwarder: Forwarder | undefined = undefined;

	constructor(
		dockerServerCode: string,
		managerServerUrl: string,
		enableManagerForwarder: boolean = true,
	) {
		const managerServerPort = parseInt(new URL(managerServerUrl).port);
		const managerServerForDockerPort = enableManagerForwarder
			? managerServerPort + 1
			: managerServerPort;
		const managerServerForDockerUrl = `http://host.docker.internal:${managerServerForDockerPort}`;

		Deno.writeTextFileSync(this.DOCKER_SCRIPT_PATH, dockerServerCode);

		// Setup Docker container monitoring
		this.dockerDetector = new DockerDetector(
			this.DOCKER_LABEL,
			(container) => {
				log.info(`New container detected: ${container.name}`);
				this.startAgent(container.id, managerServerForDockerUrl);
			},
			async (container) => {
				log.info(`Container stopped: ${container.id}`);
				this.stopAgent(container.id);
				await deleteSshForwarding(managerServerUrl, { tag: container.id });
			},
		);

		if (enableManagerForwarder) {
			this.managerServerForwarder = new Forwarder({
				sourceType: "tcp",
				sourcePort: managerServerForDockerPort,
				sourceAddress: "0.0.0.0",
				targetType: "tcp",
				targetPort: managerServerPort,
				targetAddress: "localhost",
			});
		}
	}

	start() {
		this.dockerDetector.start();
		if (this.managerServerForwarder) {
			this.managerServerForwarder.start();
		}
	}

	private runAgentScript(containerId: string, forwardUrl?: string) {
		const urlArgs = forwardUrl ? ["--forward-url", forwardUrl] : [];
		const runCmd = new Deno.Command("docker", {
			args: [
				"exec",
				containerId,
				`${this.DENO_INSTALL_PATH}/bin/deno`,
				"run",
				"-A",
				this.DOCKER_SCRIPT_PATH,
				...urlArgs,
			],
		}).spawn();
		runCmd.unref();
		this.agents.add(containerId);
	}

	private async copyAgentScript(containerId: string) {
		const copyCmd = new Deno.Command("docker", {
			args: [
				"cp",
				this.DOCKER_SCRIPT_PATH,
				`${containerId}:${this.DOCKER_SCRIPT_PATH}`,
			],
			stdout: "null",
		}).spawn();
		await copyCmd.status;
	}

	private async installDeno(containerId: string) {
		const installCmd = new Deno.Command("docker", {
			args: [
				"exec",
				containerId,
				"sh",
				"-c",
				`export DENO_INSTALL=${this.DENO_INSTALL_PATH} && curl -fsSL https://deno.land/install.sh | sh`,
			],
		}).spawn();
		await installCmd.status;
	}

	async startAgent(containerId: string, forwardUrl: string) {
		await this.copyAgentScript(containerId);
		await this.installDeno(containerId);
		this.runAgentScript(containerId, forwardUrl);
		this.agents.add(containerId);
	}

	stopAgent(containerId: string) {
		this.runAgentScript(containerId);
		this.agents.delete(containerId);
	}

	async stopAll() {
		for (const containerId of this.agents.values()) {
			this.stopAgent(containerId);
		}
		this.dockerDetector.stop();
		if (this.managerServerForwarder) {
			await this.managerServerForwarder.stop();
		}
	}
}
