import { ADS } from "@neuralnexus/ampapi";
import type { CommonAPI, IADSInstance, Instance, LoginResult, UUID } from "@neuralnexus/ampapi";
import type { AmpConfig } from "./config.js";

export interface FlatInstance extends Instance {
  TargetFriendlyName: string;
  TargetId: UUID;
}

// Heuristic: AMPAPI's apiCall throws Error("API call failed: <Title>: <Message>...")
// for API-level errors. Auth-related Titles vary across modules but generally
// mention session/login/auth. Fall through to retry on these and surface
// non-auth errors to the caller unchanged.
function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("session") ||
    m.includes("unauthor") ||
    m.includes("not logged in") ||
    m.includes("login") ||
    m.includes("forbidden") ||
    m.includes("401") ||
    m.includes("403")
  );
}

export class AmpClient {
  private readonly cfg: AmpConfig;
  private controllerPromise: Promise<ADS> | null = null;
  private readonly instanceCache = new Map<string, Promise<CommonAPI>>();

  constructor(cfg: AmpConfig) {
    this.cfg = cfg;
  }

  async getController(): Promise<ADS> {
    if (!this.controllerPromise) {
      this.controllerPromise = this.loginController().catch((err) => {
        this.controllerPromise = null;
        throw err;
      });
    }
    return this.controllerPromise;
  }

  /**
   * Run `fn` with a logged-in controller. On an auth-shaped error, evict the
   * cached session and retry once. Other errors propagate immediately.
   */
  async withController<T>(fn: (c: ADS) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.getController());
    } catch (err) {
      if (!isAuthError(err)) throw err;
      this.controllerPromise = null;
      return fn(await this.getController());
    }
  }

  private async loginController(): Promise<ADS> {
    const ads = new ADS(this.cfg.baseUri, this.cfg.username, this.cfg.password);
    const result = (await ads.APILogin()) as LoginResult | undefined;
    if (!result || result.success === false) {
      const reason = result?.resultReason?.trim();
      const code = result?.result;
      const detail =
        reason ||
        (code === 0
          ? "invalid credentials or account not authorized for API access"
          : `result code ${code ?? "unknown"}`);
      throw new Error(`AMP login failed (${detail}). Verify AMP_USERNAME, AMP_PASSWORD, and that the account has the necessary AMP role.`);
    }
    // ampapi's five-minute auto-relogin reuses AMP's nullable remember-me
    // token and can send token=null, which current AMP rejects.  Let the
    // auth-error retry paths above recreate a password-authenticated handle
    // instead.
    ads.relogInterval = Number.MAX_SAFE_INTEGER;
    return ads;
  }

  async listInstances(): Promise<FlatInstance[]> {
    return this.withController(async (controller) => {
      const targets = await controller.ADSModule.GetInstances();
      return targets.flatMap((t: IADSInstance) =>
        t.AvailableInstances.map(
          (inst): FlatInstance => ({
            ...inst,
            TargetFriendlyName: t.FriendlyName,
            TargetId: t.InstanceId,
          }),
        ),
      );
    });
  }

  async getInstance(instanceId: string): Promise<CommonAPI> {
    const cached = this.instanceCache.get(instanceId);
    if (cached) return cached;

    const promise = this.loginInstance(instanceId).catch((err) => {
      this.instanceCache.delete(instanceId);
      throw err;
    });
    this.instanceCache.set(instanceId, promise);
    return promise;
  }

  /**
   * Run `fn` with a logged-in instance handle. On an auth-shaped error,
   * evict that instance's cached session and retry once.
   */
  async withInstance<T>(instanceId: string, fn: (i: CommonAPI) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.getInstance(instanceId));
    } catch (err) {
      if (!isAuthError(err)) throw err;
      this.instanceCache.delete(instanceId);
      return fn(await this.getInstance(instanceId));
    }
  }

  private async loginInstance(instanceId: string): Promise<CommonAPI> {
    const all = await this.listInstances();
    const inst = all.find((i) => i.InstanceID === instanceId);
    if (!inst) {
      throw new Error(`Instance not found: ${instanceId}`);
    }
    const controller = await this.getController();
    const instance = await controller.InstanceLogin<CommonAPI>(instanceId, inst.Module);
    if (!instance) {
      throw new Error(`AMP instance login failed: ${instanceId}`);
    }
    instance.relogInterval = Number.MAX_SAFE_INTEGER;
    return instance;
  }
}
