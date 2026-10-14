import pino, { type Logger } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

// stderr always — stdout is reserved for the MCP JSON-RPC stream when
// MCP_TRANSPORT=stdio. Anything written to stdout will corrupt the
// protocol stream.
const useTransport = process.env.NODE_ENV !== "production" && process.stderr.isTTY;

export const logger = useTransport
  ? pino({
      level,
      base: { name: "amp-mcp-server" },
      timestamp: pino.stdTimeFunctions.isoTime,
      transport: {
        target: "pino-pretty",
        options: {
          destination: 2,
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    })
  : pino(
      {
        level,
        base: { name: "amp-mcp-server" },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination(2),
    );

/**
 * Wrap a tool handler with start/duration/error logging.
 * Uses a child logger bound to { tool: <name> } so the parent's bindings
 * (e.g. reqId) propagate automatically.
 */
export function withTrace<TArgs extends readonly unknown[], TResult>(
  parentLog: Logger,
  toolName: string,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const start = Date.now();
    const toolLog = parentLog.child({ tool: toolName });
    try {
      const result = await fn(...args);
      toolLog.info({ durationMs: Date.now() - start }, "tool ok");
      return result;
    } catch (err) {
      toolLog.error({ err, durationMs: Date.now() - start }, "tool failed");
      throw err;
    }
  };
}

export type { Logger };
