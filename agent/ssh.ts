import { PortDetector } from "../lib/detector/port.ts";
import { BaseAgent } from "./base.ts";

import * as log from "../lib/logging.ts";
import { addSshForwarding, deleteSshForwarding } from "../lib/forwarder/ssh.ts";
import { DockerAgentManager } from "./manager/docker_agent_manager.ts";

export class SSHRemoteAgent extends BaseAgent {
  private readonly portDetector: PortDetector;
  private readonly dockerAgentManager: DockerAgentManager | undefined =
    undefined;

  constructor(
    private forwardingManagerUrl: string,
    enableDockerDetection: boolean,
  ) {
    super("SSH-AGENT", "/tmp/ssh_remote_agent.pid");
    this.portDetector = new PortDetector(
      async (port: number) => {
        log.info(`New port detected: ${port}`);

        try {
          await addSshForwarding(this.forwardingManagerUrl, {
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
          await deleteSshForwarding(this.forwardingManagerUrl, {
            remotePort: port,
          });
        } catch (error) {
          log.error("Failed to send stop forwarding request:", error);
        }
      },
    );

    if (enableDockerDetection) {
      this.dockerAgentManager = new DockerAgentManager(
        this.forwardingManagerUrl,
        true,
      );
    }
  }

  override async start(): Promise<void> {
    await super.start();
    this.portDetector.start();
    if (this.dockerAgentManager) {
      this.dockerAgentManager.start();
    }
  }

  override async stop(): Promise<void> {
    this.portDetector.stop();
    if (this.dockerAgentManager) {
      this.dockerAgentManager.stopAll();
    }
    await super.stop();
  }
}
