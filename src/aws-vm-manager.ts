/**
 * AWS VM Manager - Provisions and manages Windows EC2 instances for Claude agents
 *
 * Uses AWS SDK v3 to:
 * - Launch Windows Server instances
 * - Bootstrap with Claude Code CLI
 * - Run commands via SSM
 * - Monitor instance health
 */

import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstanceStatusCommand,
  CreateTagsCommand,
  waitUntilInstanceRunning,
  waitUntilInstanceStopped,
  _InstanceType,
} from '@aws-sdk/client-ec2';

import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from '@aws-sdk/client-ssm';

// Configuration from environment
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

// Windows Server 2022 AMIs by region (with SSM agent pre-installed)
const WINDOWS_AMIS: Record<string, string> = {
  'us-east-1': 'ami-0be0e902919675894',  // Windows Server 2022 Base
  'us-east-2': 'ami-0c1704bac156af62c',
  'us-west-1': 'ami-0e5d865c678e78624',
  'us-west-2': 'ami-0f5daaa3a7fb3378b',
  'eu-west-1': 'ami-0694d931cee176e7d',
  'eu-central-1': 'ami-0c0d3776ef525d5dd',
};

// Instance types for different sizes
const INSTANCE_TYPES: Record<string, _InstanceType> = {
  small: 't3.small',    // 2 vCPU, 2GB - $0.035/hr (good for 1-2 agents)
  medium: 't3.medium',  // 2 vCPU, 4GB - $0.070/hr (good for 2-3 agents)
  large: 't3.large',    // 2 vCPU, 8GB - $0.138/hr (good for 4-5 agents)
  xlarge: 't3.xlarge',  // 4 vCPU, 16GB - $0.276/hr (good for 6-8 agents)
};

// Bootstrap script to install Claude CLI on Windows
const BOOTSTRAP_SCRIPT = `
<powershell>
# Enable TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Create agent directory
$AgentDir = "C:\\AgentHub"
New-Item -ItemType Directory -Force -Path $AgentDir
Set-Location $AgentDir

# Install Node.js via Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install nodejs-lts -y
refreshenv

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Clone the agent-coord-mcp repo
git clone https://github.com/Piston-Labs/agent-coord-mcp.git
Set-Location agent-coord-mcp
npm install

# Create config directory
$ConfigDir = "$env:USERPROFILE\\.claude"
New-Item -ItemType Directory -Force -Path $ConfigDir

# Write environment variables
$EnvFile = "$AgentDir\\.env"
@"

"@ | Out-File -FilePath $EnvFile -Encoding utf8

# Create startup script
$StartupScript = @"
Set-Location C:\\AgentHub\\agent-coord-mcp
node agent-spawn-service-v2.cjs
"@
$StartupScript | Out-File -FilePath "$AgentDir\\start-agent-service.ps1" -Encoding utf8

# Signal completion
Write-Output "Bootstrap complete" | Out-File -FilePath "$AgentDir\\bootstrap-complete.txt"
</powershell>
`;

export interface VMConfig {
  size: 'small' | 'medium' | 'large' | 'xlarge';
  region?: string;
  tags?: Record<string, string>;
  securityGroupId?: string;
  subnetId?: string;
  keyName?: string;
  iamInstanceProfile?: string;
}

export interface VMInstance {
  instanceId: string;
  publicIp: string | null;
  privateIp: string | null;
  state: string;
  launchTime: Date;
  instanceType: string;
  region: string;
}

export class AWSVMManager {
  private ec2: EC2Client;
  private ssm: SSMClient;
  private region: string;

  constructor(region?: string) {
    this.region = region || AWS_REGION;

    const credentials = AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        }
      : undefined;

    this.ec2 = new EC2Client({ region: this.region, credentials });
    this.ssm = new SSMClient({ region: this.region, credentials });
  }

  /**
   * Launch a new Windows EC2 instance for Claude agents
   */
  async launchInstance(config: VMConfig): Promise<VMInstance> {
    const ami = WINDOWS_AMIS[this.region];
    if (!ami) {
      throw new Error(`No Windows AMI configured for region ${this.region}`);
    }

    const instanceType = INSTANCE_TYPES[config.size];
    if (!instanceType) {
      throw new Error(`Invalid size: ${config.size}`);
    }

    // Build instance parameters
    const params: any = {
      ImageId: ami,
      InstanceType: instanceType,
      MinCount: 1,
      MaxCount: 1,
      UserData: Buffer.from(BOOTSTRAP_SCRIPT).toString('base64'),
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: `agent-hub-${Date.now()}` },
            { Key: 'Purpose', Value: 'claude-agent-host' },
            { Key: 'ManagedBy', Value: 'agent-coord-mcp' },
            ...(config.tags ? Object.entries(config.tags).map(([k, v]) => ({ Key: k, Value: v })) : []),
          ],
        },
      ],
      // Enable SSM for remote command execution
      MetadataOptions: {
        HttpTokens: 'required',
        HttpEndpoint: 'enabled',
      },
    };

    // Optional parameters
    if (config.securityGroupId) {
      params.SecurityGroupIds = [config.securityGroupId];
    }
    if (config.subnetId) {
      params.SubnetId = config.subnetId;
    }
    if (config.keyName) {
      params.KeyName = config.keyName;
    }
    if (config.iamInstanceProfile) {
      params.IamInstanceProfile = { Name: config.iamInstanceProfile };
    }

    // Launch the instance
    const command = new RunInstancesCommand(params);
    const result = await this.ec2.send(command);

    const instance = result.Instances?.[0];
    if (!instance || !instance.InstanceId) {
      throw new Error('Failed to launch instance');
    }

    // Wait for instance to be running
    await waitUntilInstanceRunning(
      { client: this.ec2, maxWaitTime: 300 },
      { InstanceIds: [instance.InstanceId] }
    );

    // Get updated instance info with IP
    const info = await this.getInstanceInfo(instance.InstanceId);
    return info;
  }

  /**
   * Get detailed information about an instance
   */
  async getInstanceInfo(instanceId: string): Promise<VMInstance> {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });

    const result = await this.ec2.send(command);
    const instance = result.Reservations?.[0]?.Instances?.[0];

    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    return {
      instanceId: instance.InstanceId!,
      publicIp: instance.PublicIpAddress || null,
      privateIp: instance.PrivateIpAddress || null,
      state: instance.State?.Name || 'unknown',
      launchTime: instance.LaunchTime || new Date(),
      instanceType: instance.InstanceType || 'unknown',
      region: this.region,
    };
  }

  /**
   * List all agent hub instances
   */
  async listInstances(): Promise<VMInstance[]> {
    const command = new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:ManagedBy', Values: ['agent-coord-mcp'] },
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    });

    const result = await this.ec2.send(command);
    const instances: VMInstance[] = [];

    for (const reservation of result.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        instances.push({
          instanceId: instance.InstanceId!,
          publicIp: instance.PublicIpAddress || null,
          privateIp: instance.PrivateIpAddress || null,
          state: instance.State?.Name || 'unknown',
          launchTime: instance.LaunchTime || new Date(),
          instanceType: instance.InstanceType || 'unknown',
          region: this.region,
        });
      }
    }

    return instances;
  }

  /**
   * Start a stopped instance
   */
  async startInstance(instanceId: string): Promise<void> {
    const command = new StartInstancesCommand({
      InstanceIds: [instanceId],
    });

    await this.ec2.send(command);
    await waitUntilInstanceRunning(
      { client: this.ec2, maxWaitTime: 300 },
      { InstanceIds: [instanceId] }
    );
  }

  /**
   * Stop a running instance
   */
  async stopInstance(instanceId: string): Promise<void> {
    const command = new StopInstancesCommand({
      InstanceIds: [instanceId],
    });

    await this.ec2.send(command);
    await waitUntilInstanceStopped(
      { client: this.ec2, maxWaitTime: 300 },
      { InstanceIds: [instanceId] }
    );
  }

  /**
   * Terminate an instance
   */
  async terminateInstance(instanceId: string): Promise<void> {
    const command = new TerminateInstancesCommand({
      InstanceIds: [instanceId],
    });

    await this.ec2.send(command);
  }

  /**
   * Run a command on the instance via SSM
   */
  async runCommand(instanceId: string, commands: string[]): Promise<string> {
    const sendCommand = new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: 'AWS-RunPowerShellScript',
      Parameters: {
        commands,
      },
    });

    const result = await this.ssm.send(sendCommand);
    const commandId = result.Command?.CommandId;

    if (!commandId) {
      throw new Error('Failed to send command');
    }

    // Wait for command to complete and get output
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const getInvocation = new GetCommandInvocationCommand({
        CommandId: commandId,
        InstanceId: instanceId,
      });

      try {
        const invocation = await this.ssm.send(getInvocation);
        const status = invocation.Status;

        if (status === 'Success') {
          return invocation.StandardOutputContent || '';
        } else if (status === 'Failed' || status === 'Cancelled' || status === 'TimedOut') {
          throw new Error(`Command failed: ${invocation.StandardErrorContent}`);
        }
      } catch (err: any) {
        if (err.name !== 'InvocationDoesNotExist') {
          throw err;
        }
      }

      attempts++;
    }

    throw new Error('Command timed out');
  }

  /**
   * Spawn a Claude agent on the instance
   */
  async spawnAgent(instanceId: string, soulId?: string, task?: string): Promise<{ agentId: string }> {
    const agentId = `agent-${Date.now().toString(36)}`;

    // Build the spawn command
    let spawnCmd = `
      Set-Location C:\\AgentHub\\agent-coord-mcp
      $env:ANTHROPIC_API_KEY = (Get-Content C:\\AgentHub\\.env | Select-String "ANTHROPIC_API_KEY").ToString().Split("=")[1]
    `;

    if (soulId) {
      // Fetch soul bundle and inject
      spawnCmd += `
        $response = Invoke-RestMethod -Uri "https://agent-coord-mcp.vercel.app/api/souls?action=get-bundle&soulId=${soulId}"
        $bundle = $response.bundle | ConvertTo-Json -Depth 10
        $bundle | Out-File -FilePath "C:\\AgentHub\\soul-injection.json"
        Start-Process powershell -ArgumentList "-Command", "Set-Location C:\\AgentHub\\agent-coord-mcp; Get-Content C:\\AgentHub\\soul-injection.json | claude --dangerously-skip-permissions --mcp-config mcp-config.json"
      `;
    } else {
      spawnCmd += `
        Start-Process powershell -ArgumentList "-Command", "Set-Location C:\\AgentHub\\agent-coord-mcp; claude --dangerously-skip-permissions --mcp-config mcp-config.json"
      `;
    }

    await this.runCommand(instanceId, [spawnCmd]);

    return { agentId };
  }

  /**
   * Check if bootstrap is complete on an instance
   */
  async isBootstrapComplete(instanceId: string): Promise<boolean> {
    try {
      const output = await this.runCommand(instanceId, [
        'Test-Path C:\\AgentHub\\bootstrap-complete.txt',
      ]);
      return output.trim().toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Set the Anthropic API key on the instance
   */
  async setApiKey(instanceId: string, apiKey: string): Promise<void> {
    await this.runCommand(instanceId, [
      `Add-Content -Path C:\\AgentHub\\.env -Value "ANTHROPIC_API_KEY=${apiKey}"`,
    ]);
  }

  /**
   * Get instance health/metrics
   */
  async getInstanceHealth(instanceId: string): Promise<{
    status: string;
    cpuUtilization?: number;
    memoryUsage?: number;
    agentCount?: number;
  }> {
    try {
      const info = await this.getInstanceInfo(instanceId);

      if (info.state !== 'running') {
        return { status: info.state };
      }

      // Get metrics from instance
      const output = await this.runCommand(instanceId, [
        '$cpu = (Get-Counter "\\Processor(_Total)\\% Processor Time").CounterSamples.CookedValue',
        '$mem = (Get-Counter "\\Memory\\% Committed Bytes In Use").CounterSamples.CookedValue',
        '$agents = (Get-Process claude -ErrorAction SilentlyContinue | Measure-Object).Count',
        '@{cpu=$cpu; mem=$mem; agents=$agents} | ConvertTo-Json',
      ]);

      const metrics = JSON.parse(output);

      return {
        status: 'running',
        cpuUtilization: metrics.cpu,
        memoryUsage: metrics.mem,
        agentCount: metrics.agents,
      };
    } catch (err) {
      return { status: 'error' };
    }
  }
}

// Export singleton instance
export const awsVMManager = new AWSVMManager();
