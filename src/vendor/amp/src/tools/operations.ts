import { z } from "zod";
import { lookupState } from "@neuralnexus/ampapi";
import type { UUID } from "@neuralnexus/ampapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";
import { withTrace, type Logger } from "../logger.js";
import { instanceIdField, jsonContent } from "./shared.js";

export function registerOperationsTools(
  server: McpServer,
  amp: AmpClient,
  log: Logger,
  allowWrites: boolean,
): void {
  // --- Read-only ---------------------------------------------------------

  server.registerTool(
    "amp_get_host_status",
    {
      title: "Get AMP host status",
      description:
        "Get state, uptime, and metrics (CPU, RAM) for the AMP controller host machine itself (not a game-server instance).",
      inputSchema: {},
    },
    withTrace(log, "amp_get_host_status", async () =>
      amp.withController(async (c) => {
        const status = await c.Core.GetStatus();
        return jsonContent({ ...status, StateName: lookupState(status.State) });
      }),
    ),
  );

  server.registerTool(
    "amp_get_running_tasks",
    {
      title: "Get running tasks",
      description:
        "List currently-running tasks on one AMP instance (backups, updates, etc.) with progress percentage. Useful for polling whether amp_take_backup or amp_update_application has finished.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_get_running_tasks", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.GetTasks())),
    ),
  );

  server.registerTool(
    "amp_get_update_info",
    {
      title: "Get application update info",
      description:
        "Check whether a game-server update is available for one AMP instance. Returns the available version, build, and release notes URL.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_get_update_info", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.GetUpdateInfo())),
    ),
  );

  server.registerTool(
    "amp_get_config",
    {
      title: "Get instance configuration value",
      description:
        "Read one AMP configuration node from an instance. Use the full setting node returned by AMP, for example MinecraftModule.Minecraft.LevelName.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        node: z.string().min(1).describe("Full AMP configuration node name."),
      },
    },
    withTrace(log, "amp_get_config", async ({ instanceId, node }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.GetConfig(node))),
    ),
  );

  server.registerTool(
    "amp_list_backups",
    {
      title: "List backups",
      description:
        "List all local backups for one AMP instance (most-recent first per AMP's ordering). Returns whatever shape AMP's LocalFileBackupPlugin reports.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_list_backups", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) =>
        jsonContent(await inst.LocalFileBackupPlugin.GetBackups()),
      ),
    ),
  );

  // --- Gated writes ------------------------------------------------------

  if (!allowWrites) return;

  server.registerTool(
    "amp_set_config",
    {
      title: "Set instance configuration value",
      description:
        "Set one writable AMP configuration node and verify it by reading the value back. Sleep the application first when the setting requires a restart.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        node: z.string().min(1).describe("Full AMP configuration node name."),
        value: z.string().describe("New value, encoded as AMP expects for the setting."),
      },
    },
    withTrace(log, "amp_set_config", async ({ instanceId, node, value }) =>
      amp.withInstance(instanceId, async (inst) => {
        const before = await inst.Core.GetConfig(node);
        if (before.ReadOnly) throw new Error(`AMP configuration node is read-only: ${node}`);
        const result = await inst.Core.SetConfig(node, value);
        if (result && typeof result === "object" && "Status" in result && result.Status === false) {
          throw new Error(`AMP rejected configuration change for ${node}: ${result.Reason ?? "unknown reason"}`);
        }
        const after = await inst.Core.GetConfig(node);
        if (String(after.CurrentValue) !== value) {
          throw new Error(`AMP configuration read-back mismatch for ${node}`);
        }
        return jsonContent({ node, changed: String(before.CurrentValue) !== value, verified: true });
      }),
    ),
  );

  server.registerTool(
    "amp_take_backup",
    {
      title: "Take a backup",
      description:
        "Trigger a backup of one AMP instance. The call returns when the backup TASK has been queued; use amp_get_running_tasks to poll progress.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        title: z.string().min(1).describe("Title for the backup (shown in AMP UI)."),
        description: z
          .string()
          .optional()
          .describe("Free-form description. Defaults to a note that the backup was taken via amp-mcp-server."),
        sticky: z
          .boolean()
          .optional()
          .describe("If true, the backup is exempt from AMP's retention pruning. Default false."),
      },
    },
    withTrace(log, "amp_take_backup", async ({ instanceId, title, description, sticky }) =>
      amp.withInstance(instanceId, async (inst) =>
        jsonContent(
          await inst.LocalFileBackupPlugin.TakeBackup(
            title,
            description ?? "Triggered via amp-mcp-server",
            sticky ?? false,
          ),
        ),
      ),
    ),
  );

  server.registerTool(
    "amp_restore_backup",
    {
      title: "Restore an AMP backup",
      description:
        "Restore one exact local backup to an application that is already Stopped. Intended for disposable restore-test instances and guarded recovery only; never target a running production application.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        backupId: z.uuid().describe("Exact backup UUID returned by amp_list_backups."),
        deleteExistingData: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, AMP removes existing instance data before restoring. Default false."),
        confirmStopped: z
          .literal(true)
          .describe("Explicit acknowledgement that the target application must already be Stopped."),
      },
    },
    withTrace(
      log,
      "amp_restore_backup",
      async ({ instanceId, backupId, deleteExistingData, confirmStopped }) =>
        amp.withInstance(instanceId, async (inst) => {
          if (confirmStopped !== true) throw new Error("restore requires confirmStopped=true");
          const status = await inst.Core.GetStatus();
          const state = lookupState(status.State);
          if (state !== "Stopped") {
            throw new Error(`AMP backup restore target must be Stopped; current state is ${state}`);
          }
          return jsonContent(
            await inst.LocalFileBackupPlugin.RestoreBackup(
              backupId as UUID,
              deleteExistingData ?? false,
            ),
          );
        }),
    ),
  );

  server.registerTool(
    "amp_update_application",
    {
      title: "Update application",
      description:
        "Apply a pending game-server update on one AMP instance. Long-running — use amp_get_running_tasks to poll for completion.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_update_application", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.UpdateApplication())),
    ),
  );

  server.registerTool(
    "amp_end_user_session",
    {
      title: "End user session",
      description:
        "Disconnect a user session from one AMP instance (the universal kick — works across modules). Pass the session UID from amp_get_active_users (the keys of that map). For Minecraft this terminates the player's connection.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        sessionId: z
          .string()
          .describe("Session UID (the key in the amp_get_active_users map, NOT the username)."),
      },
    },
    withTrace(log, "amp_end_user_session", async ({ instanceId, sessionId }) =>
      amp.withInstance(instanceId, async (inst) => {
        // Core.EndUserSession is typed Id: UUID; runtime accepts any session string.
        await inst.Core.EndUserSession(sessionId as unknown as UUID);
        return jsonContent({ ok: true, sessionId });
      }),
    ),
  );

  server.registerTool(
    "amp_sleep_instance",
    {
      title: "Sleep instance",
      description:
        "Put one AMP instance into a sleep state (resumable more quickly than a full Stop). Not all modules support this — falls back to a stop if not.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_sleep_instance", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.Sleep())),
    ),
  );
}
