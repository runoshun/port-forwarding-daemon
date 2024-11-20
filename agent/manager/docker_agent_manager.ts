import * as log from "../../lib/logging.ts";
import { DockerDetector } from "../../lib/detector/docker.ts";
import { SocketForwarder } from "../../lib/forwarder/socket.ts";
import { deleteSshForwarding } from "../../lib/forwarder/ssh.ts";
import * as settings from "../../lib/settings.ts";
import { install_deno_cmd } from "../../lib/deno_install.ts";
import { dirname } from "jsr:@std/path@1.0.8/dirname";

export class DockerAgentManager {
	private agents = new Set<string>();

	private readonly dockerDetector: DockerDetector;
	private readonly managerServerForwarder: SocketForwarder | undefined =
		undefined;

	constructor(
		managerServerUrl: string,
		enableManagerForwarder: boolean = true,
	) {
		const managerServerPort = parseInt(new URL(managerServerUrl).port);
		const managerServerForDockerPort = enableManagerForwarder
			? managerServerPort + 1
			: managerServerPort;
		const managerServerForDockerUrl = `http://host.docker.internal:${managerServerForDockerPort}`;

		// Setup Docker container monitoring
		this.dockerDetector = new DockerDetector(
			(container) => {
				log.info(`New container detected: ${container.name}`);
				this.startAgent(container.id, managerServerForDockerUrl);
			},
			async (container) => {
				log.info(`Container stopped: ${container.id}`);
				this.agents.delete(container.id);
				await deleteSshForwarding(managerServerUrl, { tag: container.id });
			},
			settings.DOCKER_CONTAINER_LABEL,
		);

		if (enableManagerForwarder) {
			this.managerServerForwarder = new SocketForwarder({
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
		const urlArgs = forwardUrl ? [forwardUrl] : [];
		const runCmd = new Deno.Command("docker", {
			args: [
				"exec",
				containerId,
				`${settings.DENO_INSTALL_PATH}/bin/deno`,
				"run",
				"-A",
				settings.MAIN_SCRIPT_PATH,
				settings.COMMANDS.DOCKER,
				...urlArgs,
			],
		}).spawn();
		runCmd.unref();
		this.agents.add(containerId);
	}

	private async copyAgentScript(containerId: string) {
		const mkdirCmd = new Deno.Command("docker", {
			args: [
				"exec",
				containerId,
				"mkdir",
				"-p",
				dirname(settings.MAIN_SCRIPT_PATH),
			],
		}).spawn();
		await mkdirCmd.status;

		const copyCmd = new Deno.Command("docker", {
			args: [
				"cp",
				settings.MAIN_SCRIPT_PATH,
				`${containerId}:${settings.MAIN_SCRIPT_PATH}`,
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
				"bash",
				"-c",
				install_deno_cmd(settings.DENO_INSTALL_PATH),
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

	async stopAll() {
		for (const containerId of this.agents.values()) {
			this.runAgentScript(containerId);
			this.agents.delete(containerId);
		}
		this.dockerDetector.stop();
		if (this.managerServerForwarder) {
			await this.managerServerForwarder.stop();
		}
	}
}
