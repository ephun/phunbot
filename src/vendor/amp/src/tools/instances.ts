import { lookupState } from "@neuralnexus/ampapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";
import { withTrace, type Logger } from "../logger.js";
import { instanceIdField, jsonContent } from "./shared.js";

export function registerInstanceTools(
  server: McpServer,
  amp: AmpClient,
  log: Logger,
  allowWrites: boolean,
): void {
  const resolveInstance = async (instanceId: string) => {
    const instance = (await amp.listInstances()).find((item) => item.InstanceID === instanceId);
    if (!instance) throw new Error(`AMP instance not found: ${instanceId}`);
    return instance;
  };
  const waitForChildStatus = async (instanceId: string, attempts: number) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await amp.withInstance(instanceId, async (inst) => inst.Core.GetStatus());
      }
      catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw lastError ?? new Error(`AMP child did not become available: ${instanceId}`);
  };
  const ensureChildAvailable = async (instanceId: string) => {
    let instance = await resolveInstance(instanceId);
    if (!instance.Running) {
      await amp.withController(async (c) => c.ADSModule.StartInstance(instance.InstanceName));
    }
    try {
      return await waitForChildStatus(instanceId, 30);
    }
    catch {
      instance = await resolveInstance(instanceId);
      await amp.withController(async (c) => c.ADSModule.RestartInstance(instance.InstanceName));
      return waitForChildStatus(instanceId, 60);
    }
  };
  server.registerTool(
    "amp_list_instances",
    {
      title: "List AMP instances",
      description:
        "Enumerate all instances managed by the AMP controller. Returns InstanceID, name, module type, running state, and parent target for each game-server instance.",
      inputSchema: {},
    },
    withTrace(log, "amp_list_instances", async () => {
      const instances = await amp.listInstances();
      return jsonContent(
        instances.map((i) => ({
          InstanceID: i.InstanceID,
          InstanceName: i.InstanceName,
          FriendlyName: i.FriendlyName,
          Module: i.Module,
          ModuleDisplayName: i.ModuleDisplayName,
          Running: i.Running,
          AppState: lookupState(i.AppState),
          Suspended: i.Suspended,
          Target: i.TargetFriendlyName,
        })),
      );
    }),
  );

  server.registerTool(
    "amp_get_instance_status",
    {
      title: "Get instance status",
      description:
        "Get state, uptime, and metrics (CPU, RAM, players) for a single AMP instance. Pass an InstanceID from amp_list_instances.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_get_instance_status", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => {
        const status = await inst.Core.GetStatus();
        return jsonContent({ ...status, StateName: lookupState(status.State) });
      }),
    ),
  );

  server.registerTool(
    "amp_get_active_users",
    {
      title: "Get active users",
      description:
        "List currently connected users / players for one AMP instance. Returns a map of session UID to username.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_get_active_users", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.GetUserList())),
    ),
  );

  if (!allowWrites) return;

  server.registerTool(
    "amp_start_instance",
    {
      title: "Start instance",
      description: "Start a stopped AMP instance.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_start_instance", async ({ instanceId }) => {
      const status = await ensureChildAvailable(instanceId);
      const state = lookupState(status.State);
      if (state === "Sleeping" || state === "Stopped") {
        return amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.Start()));
      }
      return jsonContent({ Status: true, Reason: `Application already ${state}` });
    }),
  );

  server.registerTool(
    "amp_force_restart_wrapper",
    {
      title: "Force restart AMP wrapper",
      description: "Restart an unavailable AMP child wrapper through ADS. Pass the exact AMP InstanceName in instanceId; intended for control-plane recovery only.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_force_restart_wrapper", async ({ instanceId }) =>
      amp.withController(async (c) => jsonContent(await c.ADSModule.RestartInstance(instanceId))),
    ),
  );

  server.registerTool(
    "amp_stop_instance",
    {
      title: "Stop instance",
      description: "Stop a running AMP instance gracefully.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_stop_instance", async ({ instanceId }) => {
      const instance = await resolveInstance(instanceId);
      return amp.withController(async (c) => jsonContent(await c.ADSModule.StopInstance(instance.InstanceName)));
    }),
  );

  server.registerTool(
    "amp_restart_instance",
    {
      title: "Restart instance",
      description: "Restart an AMP instance (stop then start).",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_restart_instance", async ({ instanceId }) => {
      const status = await ensureChildAvailable(instanceId);
      const state = lookupState(status.State);
      if (state === "Sleeping" || state === "Stopped") {
        return amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.Start()));
      }
      return amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.Restart()));
    }),
  );
}
