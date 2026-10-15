// One effect registry shared by authorization and the actual tool inventory.
// Descriptions classify capabilities; deployment rules and signed owner decisions grant them.
const entries = [
  [
    "amp_list_instances",
    "routine",
    "Enumerate managed instances",
    "controller",
  ],
  ["amp_get_host_status", "routine", "Read controller status", "controller"],
  ["amp_get_instance_status", "routine", "Read instance state"],
  ["amp_get_active_users", "routine", "Read connected users"],
  [
    "amp_get_console_output",
    "routine",
    "Read bounded diagnostic console output",
  ],
  ["amp_get_running_tasks", "routine", "Read instance task progress"],
  ["amp_get_update_info", "routine", "Read available update metadata"],
  ["amp_get_config", "routine", "Read a non-sensitive setting"],
  ["amp_list_backups", "routine", "List existing backup metadata"],
  ["amp_list_files", "routine", "List a confined instance directory"],
  ["amp_read_text_file", "routine", "Read a confined non-sensitive text file"],
  ["amp_file_md5", "routine", "Read server-side file checksum"],
  [
    "amp_send_console_command",
    "consequential",
    "Execute a command classified by its actual potential effects",
  ],
  [
    "amp_start_instance",
    "consequential",
    "Start application and possibly its wrapper",
  ],
  [
    "amp_stop_instance",
    "consequential",
    "Stop instance wrapper and application",
  ],
  [
    "amp_restart_instance",
    "consequential",
    "Restart application, possibly recovering its wrapper",
  ],
  ["amp_sleep_instance", "consequential", "Sleep an instance"],
  ["amp_end_user_session", "consequential", "Disconnect a player or user"],
  ["amp_set_config", "consequential", "Mutate an exact setting"],
  [
    "amp_update_application",
    "consequential",
    "Update server application files",
  ],
  ["amp_rename_file", "consequential", "Rename one confined file"],
  ["amp_copy_file", "consequential", "Copy one confined file"],
  ["amp_create_directory", "consequential", "Create a confined directory"],
  ["amp_create_archive", "consequential", "Create a targeted rollback archive"],
  [
    "amp_upload_file",
    "consequential",
    "Replace exact artifact bytes under a confined destination",
  ],
  ["amp_take_backup", "consequential", "Create an explicitly requested backup"],
  ["amp_trash_file", "sensitive", "Remove an instance file into trash"],
  ["amp_restore_backup", "sensitive", "Overwrite existing data with a backup"],
  [
    "amp_force_restart_wrapper",
    "sensitive",
    "Force a controller-level wrapper restart by exact UUID, resolved to its authoritative AMP name",
  ],
];
export const operationRegistry = Object.freeze(
  Object.fromEntries(
    entries.map(([name, risk, effect, target = "instance"]) => [
      name,
      Object.freeze({ name, risk, effect, target }),
    ]),
  ),
);
const sensitive =
  /pass(word|wd)?|secret|token|credential|auth|private.?key|licen[cs]e|rcon|ssh|network|firewall|session|cookie|certificate|\.env\b|ampconfig/i;
const pathFields = ["path", "remotePath", "targetDirectory"];

export function confinedPath(value, allowRoot = false) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes("%") ||
    /[\x00-\x1f]/.test(value) ||
    value.startsWith("/")
  )
    return null;
  let clean = value;
  while (clean.startsWith("./")) clean = clean.slice(2);
  if (clean.split("/").some((part) => part === "..") || clean.startsWith("/"))
    return null;
  clean = clean.replace(/\/{2,}/g, "/");
  if (!clean || clean === ".") return allowRoot ? "" : null;
  return clean;
}

export function operation(tool, args = {}) {
  const name = tool.startsWith("mcp__amp__")
    ? tool.slice("mcp__amp__".length)
    : tool;
  const definition = operationRegistry[name];
  const deny = (reason) => ({ name, args, risk: "denied", reason });
  if (!definition) return deny("Unknown AMP operation is not executable");
  const result = {
    ...definition,
    args,
    instanceId: args.instanceId,
    paths: [],
  };
  if (
    definition.target === "instance" &&
    (typeof args.instanceId !== "string" || !args.instanceId.trim())
  )
    return deny("An exact instance target is required");
  for (const field of pathFields) {
    if (args[field] === undefined) continue;
    const clean = confinedPath(args[field], name === "amp_list_files");
    if (clean === null)
      return deny("Instance-relative paths must be confined without traversal");
    result.paths.push(clean);
  }
  if (["amp_get_config", "amp_set_config"].includes(name)) {
    if (typeof args.node !== "string" || !args.node)
      return deny("An exact configuration node is required");
    if (sensitive.test(args.node))
      return deny(
        "Credential, authentication and network-security settings require an independent operator, not agent-supplied secrets",
      );
  }
  if (
    name === "amp_rename_file" &&
    (typeof args.newFilename !== "string" ||
      !args.newFilename ||
      [".", ".."].includes(args.newFilename) ||
      /[\\/\x00-\x1f]/.test(args.newFilename))
  )
    return deny("A confined new filename is required");
  if (name === "amp_read_text_file") {
    if (
      !result.paths.length ||
      result.paths.some(
        (p) =>
          sensitive.test(p) ||
          !/\.(?:log|txt|json|ya?ml|properties|cfg|conf|ini)$/i.test(p),
      )
    )
      return deny(
        "Sensitive or unclassified file reads require an independent operator",
      );
  }
  if (
    name === "amp_upload_file" &&
    !/^[a-f0-9]{64}$/i.test(args.expectedSha256 || "")
  )
    return deny(
      "Uploads require the exact artifact SHA256 in the approved operation",
    );
  if (name === "amp_send_console_command") {
    if (typeof args.command !== "string" || !args.command.trim())
      return deny("An exact console command is required");
    if (/^(?:list|version|help|tps|mspt)$/i.test(args.command))
      result.risk = "routine";
    else if (
      /\b(?:op|deop|whitelist|permission\w*|luckperms|lp|delete|remove|rm|fill|clone|kill|execute|eval|shell|auth\w*|password|ban\w*)\b/i.test(
        args.command,
      )
    )
      result.risk = "sensitive";
  }
  return result;
}

export function scopeMatches(scope, op) {
  if (
    !scope ||
    !["routine", "consequential"].includes(op.risk) ||
    scope.instanceId !== op.instanceId ||
    scope.instanceId === "*" ||
    !Array.isArray(scope.operations) ||
    !scope.operations.includes(op.name)
  )
    return false;
  if (
    op.name === "amp_send_console_command" &&
    (!Array.isArray(scope.commands) ||
      !scope.commands.includes(op.args.command))
  )
    return false;
  if (
    op.name === "amp_set_config" &&
    (!Array.isArray(scope.nodes) || !scope.nodes.includes(op.args.node))
  )
    return false;
  if (!op.paths.length) return scope.pathPrefix === undefined;
  const prefix = confinedPath(scope.pathPrefix);
  if (!prefix) return false;
  const directory = prefix.replace(/\/$/, "") + "/";
  return op.paths.every((p) => p.startsWith(directory));
}
export function operationInventory() {
  return Object.values(operationRegistry).map((entry) => ({ ...entry }));
}
