import { describe, expect, it, vi } from "vitest";
import { registerOperationsTools } from "./operations.js";

const silentLog = {
  child: () => ({ info: () => undefined, error: () => undefined }),
} as any;

function captureTools(allowWrites: boolean, state = 0) {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  const server = {
    registerTool: (name: string, _definition: unknown, handler: (args: any) => Promise<any>) => {
      handlers.set(name, handler);
    },
  } as any;
  const restoreBackup = vi.fn().mockResolvedValue({ Status: true });
  const amp = {
    withController: vi.fn(),
    withInstance: vi.fn(async (_instanceId: string, fn: (instance: any) => Promise<any>) =>
      fn({
        Core: {
          GetStatus: vi.fn().mockResolvedValue({ State: state }),
        },
        LocalFileBackupPlugin: {
          RestoreBackup: restoreBackup,
        },
      }),
    ),
  } as any;
  registerOperationsTools(server, amp, silentLog, allowWrites);
  return { handlers, restoreBackup };
}

describe("AMP backup restore tool", () => {
  it("is hidden when writes are disabled", () => {
    const { handlers } = captureTools(false);
    expect(handlers.has("amp_restore_backup")).toBe(false);
  });

  it("restores one exact backup only while the application is stopped", async () => {
    const { handlers, restoreBackup } = captureTools(true, 0);
    const handler = handlers.get("amp_restore_backup");
    expect(handler).toBeTypeOf("function");
    await handler!({
      instanceId: "00000000-0000-0000-0000-000000000001",
      backupId: "00000000-0000-0000-0000-000000000002",
      deleteExistingData: false,
      confirmStopped: true,
    });
    expect(restoreBackup).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000002",
      false,
    );
  });

  it("refuses to restore a running application", async () => {
    const { handlers, restoreBackup } = captureTools(true, 20);
    await expect(
      handlers.get("amp_restore_backup")!({
        instanceId: "00000000-0000-0000-0000-000000000001",
        backupId: "00000000-0000-0000-0000-000000000002",
        deleteExistingData: false,
        confirmStopped: true,
      }),
    ).rejects.toThrow(/must be Stopped/);
    expect(restoreBackup).not.toHaveBeenCalled();
  });
});
