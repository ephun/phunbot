import fs from "node:fs";
import crypto from "node:crypto";

// phunbot's runtime storage is Linux-hosted. Directory descriptors keep every
// operation anchored even if a pathname is replaced between validation and use.
export function privateDirectory(root, relative, { create = false } = {}) {
  if (process.platform !== "linux")
    throw Error("Descriptor-anchored private storage requires Linux");
  const parts = relative.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.includes("\\"),
    )
  )
    throw Error("Invalid private directory boundary");
  let fd = fs.openSync(
    fs.realpathSync(root),
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    for (const part of parts) {
      const next = "/proc/self/fd/" + fd + "/" + part;
      if (create) {
        try {
          fs.mkdirSync(next, { mode: 0o700 });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
      let child;
      try {
        child = fs.openSync(
          next,
          fs.constants.O_RDONLY |
            fs.constants.O_DIRECTORY |
            fs.constants.O_NOFOLLOW,
        );
      } catch (error) {
        if (["ELOOP", "ENOTDIR"].includes(error.code))
          throw Error(
            "Private directory symlink or invalid boundary is not authorized",
          );
        throw error;
      }
      fs.closeSync(fd);
      fd = child;
    }
    const result = {
      fd,
      path: "/proc/self/fd/" + fd,
      close() {
        if (this.fd !== null) {
          fs.closeSync(this.fd);
          this.fd = null;
        }
      },
    };
    fd = null;
    return result;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
export function privateFile(directory, name, flags = fs.constants.O_RDONLY) {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/]/.test(name)
  )
    throw Error("Invalid private file name");
  try {
    return fs.openSync(
      directory.path + "/" + name,
      flags | fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error.code === "ELOOP")
      throw Error("Private file symlink is not authorized");
    throw error;
  }
}
export function readPrivateText(directory, name) {
  const fd = privateFile(directory, name);
  try {
    if (!fs.fstatSync(fd).isFile())
      throw Error("Private file must be a regular file");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}
export function createPrivateText(directory, name, text) {
  const fd = privateFile(
    directory,
    name,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
  );
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function replacePrivateText(directory, name, text) {
  // Existing symlinks and nonregular destinations are a boundary error, not cache corruption.
  try {
    const fd = privateFile(directory, name);
    try {
      if (!fs.fstatSync(fd).isFile())
        throw Error("Private destination must be a regular file");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = name + ".tmp-" + crypto.randomUUID();
  try {
    createPrivateText(directory, temporary, text);
    fs.renameSync(
      directory.path + "/" + temporary,
      directory.path + "/" + name,
    );
    fs.fsyncSync(directory.fd);
  } finally {
    fs.rmSync(directory.path + "/" + temporary, { force: true });
  }
}
export function acquirePrivateLock(root, name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error("Invalid private lock name");
  const directory = privateDirectory(root, "state"),
    lockPath = directory.path + "/" + name + ".lock";
  let ownerDirectory;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let created = false;
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        created = true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_RDONLY |
          fs.constants.O_DIRECTORY |
          fs.constants.O_NOFOLLOW,
      );
      ownerDirectory = {
        fd,
        path: "/proc/self/fd/" + fd,
        close() {
          fs.closeSync(fd);
        },
      };
      if (created) {
        const identity = fs.fstatSync(fd);
        const token = crypto.randomUUID();
        createPrivateText(
          ownerDirectory,
          "owner.json",
          JSON.stringify({ pid: process.pid, token }),
        );
        return {
          directory,
          release() {
            try {
              const current = fs.lstatSync(lockPath);
              if (
                current.dev === identity.dev &&
                current.ino === identity.ino &&
                JSON.parse(readPrivateText(ownerDirectory, "owner.json"))
                  .token === token
              )
                fs.rmSync(lockPath, { recursive: true });
            } finally {
              ownerDirectory.close();
              directory.close();
            }
          },
        };
      }
      let owner;
      try {
        owner = JSON.parse(readPrivateText(ownerDirectory, "owner.json"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      let stale = false;
      if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") stale = true;
          else if (error.code !== "EPERM") throw error;
        }
      }
      ownerDirectory.close();
      ownerDirectory = null;
      if (stale) {
        fs.rmSync(lockPath, { recursive: true });
        continue;
      }
      directory.close();
      return null;
    }
    directory.close();
    return null;
  } catch (error) {
    if (ownerDirectory) ownerDirectory.close();
    directory.close();
    throw error;
  }
}
