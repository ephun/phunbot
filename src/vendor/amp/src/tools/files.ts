import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";
import { withTrace, type Logger } from "../logger.js";
import { jsonContent } from "./shared.js";

function confinedRemote(value: string, allowRoot = false): string {
  if(typeof value !== 'string' || !value || /[\\%\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').includes('..')) throw new Error('A confined instance-relative path is required');
  const clean=value.replace(/^(?:\.\/)+/,'').replace(/\/{2,}/g,'/');
  if(!clean || clean==='.') {if(allowRoot)return './';throw new Error('A non-root confined path is required');}
  return clean;
}
function confinedFilename(value:string):string {
  if(!value || value==='.' || value==='..' || /[\\/\x00-\x1f%]/.test(value))throw new Error('A confined filename is required');return value;
}
const defaultRoots = ["/tmp/amp-dynmap-build", "/tmp/amp-coreprotect-build"];

async function approvedLocalFile(path: string): Promise<string> {
  const actual = await realpath(resolve(path));
  const configured = (process.env.AMP_MCP_UPLOAD_ROOTS ?? defaultRoots.join(","))
    .split(",").map((item) => resolve(item.trim())).filter(Boolean);
  if (!configured.some((root) => actual === root || actual.startsWith(root + sep))) {
    throw new Error(`Local upload path is outside approved roots: ${configured.join(", ")}`);
  }
  return actual;
}

export function registerFileTools(server: McpServer, amp: AmpClient, log: Logger, allowWrites: boolean): void {
  server.registerTool("amp_list_files", {
    title: "List AMP instance files",
    description: "List one directory inside an AMP-managed instance.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().default("./").describe("Instance-relative directory path"),
    },
  }, withTrace(log, "amp_list_files", async ({ instanceId, path }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.GetDirectoryListing(confinedRemote(path,true)))),
  ));

  server.registerTool("amp_read_text_file", {
    title: "Read AMP instance text file",
    description: "Read a small UTF-8 configuration or log file from an AMP-managed instance (maximum 2 MiB).",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Instance-relative text file path"),
      maxBytes: z.number().int().positive().max(2 * 1024 * 1024).default(1024 * 1024),
    },
  }, withTrace(log, "amp_read_text_file", async ({ instanceId, path, maxBytes }) =>
    amp.withInstance(instanceId, async (inst) => {
      const result = await inst.FileManagerPlugin.ReadFileChunk(confinedRemote(path), 0, maxBytes);
      if (!result.Status) throw new Error(`AMP could not read ${path}: ${result.Reason}`);
      const decoded = Buffer.from(result.Result, "base64");
      return { content: [{ type: "text" as const, text: decoded.toString("utf8") }] };
    }),
  ));

  server.registerTool("amp_file_md5", {
    title: "Calculate AMP instance file MD5",
    description: "Calculate a server-side MD5 checksum for an instance file.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Instance-relative file path"),
    },
  }, withTrace(log, "amp_file_md5", async ({ instanceId, path }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.CalculateFileMD5Sum(confinedRemote(path)))),
  ));

  if (!allowWrites) return;

  server.registerTool("amp_rename_file", {
    title: "Rename AMP instance file",
    description: "Rename an instance file, typically to preserve a rollback copy before deployment.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Current instance-relative file path"),
      newFilename: z.string().min(1).refine((value) => !value.includes("/") && !value.includes("\\"), "Must be a filename, not a path"),
    },
  }, withTrace(log, "amp_rename_file", async ({ instanceId, path, newFilename }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.RenameFile(confinedRemote(path), confinedFilename(newFilename)))),
  ));

  server.registerTool("amp_create_directory", {
    title: "Create AMP instance directory",
    description: "Create a directory inside an AMP-managed instance.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Instance-relative directory path"),
    },
  }, withTrace(log, "amp_create_directory", async ({ instanceId, path }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.CreateDirectory(confinedRemote(path)))),
  ));

  server.registerTool("amp_create_archive", {
    title: "Create AMP instance archive",
    description: "Create an archive of one instance-relative file or directory for a targeted rollback copy.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Instance-relative file or directory to archive"),
    },
  }, withTrace(log, "amp_create_archive", async ({ instanceId, path }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.CreateArchive(confinedRemote(path)))),
  ));

  server.registerTool("amp_copy_file", {
    title: "Copy AMP instance file",
    description: "Copy an instance file into another instance directory, preserving its filename.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Source instance-relative file path"),
      targetDirectory: z.string().min(1).describe("Destination instance-relative directory"),
    },
  }, withTrace(log, "amp_copy_file", async ({ instanceId, path, targetDirectory }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.CopyFile(confinedRemote(path), confinedRemote(targetDirectory)))),
  ));

  server.registerTool("amp_trash_file", {
    title: "Move AMP instance file to trash",
    description: "Move an instance file to AMP's trash so it can still be recovered.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      path: z.string().min(1).describe("Instance-relative file path"),
    },
  }, withTrace(log, "amp_trash_file", async ({ instanceId, path }) =>
    amp.withInstance(instanceId, async (inst) => jsonContent(await inst.FileManagerPlugin.TrashFile(confinedRemote(path)))),
  ));

  server.registerTool("amp_upload_file", {
    title: "Upload staged file to AMP instance",
    description: "Upload exact SHA256-approved staged bytes, then read back AMP's server-side MD5 checksum.",
    inputSchema: {
      instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
      localPath: z.string().min(1).describe("Absolute local path under an approved upload root"),
      remotePath: z.string().min(1).describe("Destination instance-relative file path"),
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).describe("Exact owner-approved SHA256 of the staged artifact bytes"),
    },
  }, withTrace(log, "amp_upload_file", async ({ instanceId, localPath, remotePath, expectedSha256 }) => {
    remotePath = confinedRemote(remotePath);
    const actual = await approvedLocalFile(localPath);
    const data = await readFile(actual);
    if(data.length===0)throw new Error('Empty uploads are unsupported; no remote write was performed');
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (sha256 !== expectedSha256?.toLowerCase()) throw new Error("Staged bytes differ from the owner-approved SHA256");
    if (data.length > 64 * 1024 * 1024) throw new Error("Upload exceeds the 64 MiB safety limit");
    return amp.withInstance(instanceId, async (inst) => {
      const chunkSize = 512 * 1024;
      for (let offset = 0; offset < data.length; offset += chunkSize) {
        const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.length));
        const result = await inst.FileManagerPlugin.WriteFileChunk(remotePath, chunk.toString("base64"), offset, offset + chunk.length === data.length);
        if (!result.Status) throw new Error(`AMP rejected upload chunk at offset ${offset}: ${result.Reason}`);
      }
      const localMd5 = createHash("md5").update(data).digest("hex");
      const remote = await inst.FileManagerPlugin.CalculateFileMD5Sum(remotePath);
      const remoteMd5 = String(remote.Result ?? "").toLowerCase();
      if (!remote.Status || remoteMd5 !== localMd5) throw new Error(`Upload checksum mismatch for ${basename(actual)}: local=${localMd5}, remote=${remoteMd5 || "unavailable"}`);
      return jsonContent({ uploaded: true, effectVerified: true, sha256, localPath: actual, remotePath, sizeBytes: data.length, md5: localMd5, verification: { kind: "fresh_server_md5", value: remoteMd5 } });
    });
  }));
}
