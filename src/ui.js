import { projectConversation, executionLabel } from "./presentation.mjs";
import { PendingRequests } from "./request-identity.mjs";

const $ = (id) => document.getElementById(id);
const welcome = $("welcome");
let token = sessionStorage.getItem("phunbot-token") || "";
let current = null,
  rows = [],
  pendingSubmission = null,
  pendingApproval = null;
let historySignature = "",
  traceSignature = "",
  refreshing = false,
  sending = false;
const messageNodes = new Map();
const folders = new Set(readPreference("phunbot-folders", []));
const folderStates = readPreference("phunbot-folder-state", {});
let attachments = [];

function readPreference(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function notice(error = "") {
  $("notice").textContent = error?.message || String(error);
}
function icon(name) {
  const node = document.createElement("i");
  node.dataset.lucide = name;
  node.setAttribute("aria-hidden", "true");
  return node;
}
function icons() {
  window.lucide.createIcons();
}
function iconButton(name, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(name));
  button.onclick = () => Promise.resolve(action()).catch(notice);
  return button;
}
async function api(url, method = "GET", body) {
  const response = await fetch("/api/" + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Request failed (" + response.status + ")");
  return data;
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  $("sidebar-scrim").classList.add("hidden");
}
function renderHistory(force = false) {
  const query = $("search").value.trim().toLowerCase();
  const showValidation = $("show-validation").checked;
  const signature = JSON.stringify([
    rows,
    current,
    query,
    showValidation,
    [...folders],
  ]);
  if (!force && signature === historySignature) return;
  historySignature = signature;
  const visible = rows.filter(
    (row) =>
      (showValidation || !/^(?:validation|tests?)$/i.test(row.folder || "")) &&
      (!query || (row.title || "").toLowerCase().includes(query)),
  );
  const names = [
    ...new Set([
      "Conversations",
      ...folders,
      ...visible.map((row) => row.folder || "Conversations"),
    ]),
  ].filter((name) => showValidation || !/^(?:validation|tests?)$/i.test(name));
  const fragment = document.createDocumentFragment();
  for (const name of names) {
    const matches = visible.filter(
      (row) => (row.folder || "Conversations") === name,
    );
    if (query && !matches.length) continue;
    const group = document.createElement("details");
    group.className = "folder-group";
    group.open = folderStates[name] !== false;
    const summary = document.createElement("summary");
    summary.append(icon("folder"));
    const title = document.createElement("span");
    title.textContent = name;
    summary.append(title);
    const chevron = icon("chevron-right");
    chevron.classList.add("chevron");
    summary.append(chevron);
    group.append(summary);
    group.addEventListener("toggle", () => {
      folderStates[name] = group.open;
      localStorage.setItem(
        "phunbot-folder-state",
        JSON.stringify(folderStates),
      );
    });
    for (const row of matches.toReversed()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "conversation-row" + (row.id === current ? " active" : "");
      button.setAttribute("aria-label", row.title || "Untitled conversation");
      if (row.id === current) button.setAttribute("aria-current", "page");
      button.append(icon("message-square"));
      const label = document.createElement("span");
      label.className = "row-name";
      label.textContent = row.title || "Untitled conversation";
      button.append(label);
      if (row.busy) {
        const dot = document.createElement("span");
        dot.className = "running-dot";
        button.append(dot);
      }
      button.onclick = () => select(row).catch(notice);
      group.append(button);
    }
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "empty-folder";
      empty.textContent = "No conversations yet";
      group.append(empty);
    }
    fragment.append(group);
  }
  $("history").replaceChildren(fragment);
  icons();
}
async function loadHistory() {
  rows = await api("sessions");
  renderHistory();
}
async function select(row) {
  current = row.id;
  localStorage.setItem("phunbot-current", current);
  $("title").textContent = row.title || "New conversation";
  $("model").value = row.model;
  $("messages").replaceChildren();
  messageNodes.clear();
  traceSignature = "";
  closeSidebar();
  renderHistory(true);
  await loadMessages();
  $("prompt").focus();
}
async function copyText(text, button) {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else {
    const area = document.createElement("textarea");
    area.value = text;
    area.className = "copy-buffer";
    document.body.append(area);
    area.select();
    if (!document.execCommand("copy")) {
      area.remove();
      throw Error("Copy failed. Select the text to copy it.");
    }
    area.remove();
  }
  button.replaceChildren(icon("check"));
  icons();
  setTimeout(() => {
    if (button.isConnected) {
      button.replaceChildren(icon("copy"));
      icons();
    }
  }, 1200);
}
function assistantBody(text) {
  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = window.DOMPurify.sanitize(
    window.marked.parse(text, { gfm: true, breaks: false }),
    {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        "style",
        "form",
        "input",
        "button",
        "iframe",
        "object",
        "embed",
        "audio",
        "video",
      ],
      FORBID_ATTR: ["style", "id"],
    },
  );
  // Do not fetch remote tracking images embedded in model-authored Markdown.
  for (const image of body.querySelectorAll("img")) image.remove();
  for (const link of body.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const pre of body.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const header = document.createElement("div");
    header.className = "code-header";
    const language = document.createElement("span");
    language.textContent =
      code.className.match(/language-([\w+-]+)/)?.[1] || "Code";
    let copy;
    copy = iconButton("copy", "Copy code", () =>
      copyText(code.textContent, copy),
    );
    header.append(language, copy);
    pre.prepend(header);
  }
  return body;
}
function messageNode(message) {
  const article = document.createElement("article");
  article.className = "message " + message.role;
  const body =
    message.role === "assistant"
      ? assistantBody(message.text)
      : document.createElement("div");
  if (message.role === "user") {
    body.className = "message-body";
    body.textContent = message.text;
  }
  article.append(body);
  for (const attachment of message.images) {
    if (
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        attachment.mimeType,
      ) ||
      !/^[A-Za-z0-9+/=]+$/.test(attachment.data || "")
    )
      continue;
    const image = document.createElement("img");
    image.className = "attachment-image";
    image.alt = "Attached image";
    image.src = "data:" + attachment.mimeType + ";base64," + attachment.data;
    article.append(image);
  }
  if (message.role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    let copy;
    copy = iconButton("copy", "Copy message", () =>
      copyText(message.text, copy),
    );
    actions.append(copy);
    article.append(actions);
  }
  return article;
}
function renderMessages(entries) {
  const projection = projectConversation(entries),
    container = $("messages");
  const atBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  if (projection.messages.length) welcome.remove();
  const wanted = new Set();
  for (const message of projection.messages) {
    wanted.add(message.key);
    const signature = JSON.stringify(message);
    const prior = messageNodes.get(message.key);
    if (prior?.signature === signature) continue;
    const node = messageNode(message);
    if (prior) prior.node.replaceWith(node);
    else container.append(node);
    messageNodes.set(message.key, { node, signature });
  }
  for (const [key, value] of messageNodes)
    if (!wanted.has(key)) {
      value.node.remove();
      messageNodes.delete(key);
    }
  if (!projection.messages.length && !welcome.isConnected)
    container.append(welcome);
  const trace = JSON.stringify(projection.traces);
  if (trace !== traceSignature) {
    traceSignature = trace;
    const fragment = document.createDocumentFragment();
    for (const item of projection.traces) {
      const details = document.createElement("details");
      details.className = "trace-item";
      const summary = document.createElement("summary");
      summary.textContent = item.label;
      const text = document.createElement("pre");
      text.textContent = item.text;
      details.append(summary, text);
      fragment.append(details);
    }
    $("traces").replaceChildren(fragment);
    $("trace-count").textContent =
      "Execution details · " + projection.traces.length;
    $("trace-panel").classList.toggle("hidden", !projection.traces.length);
  }
  icons();
  if (atBottom) container.scrollTop = container.scrollHeight;
}
async function loadMessages() {
  if (!current) return;
  const id = current,
    data = await api("sessions/" + id + "/messages");
  if (current !== id) return;
  $("status").textContent = executionLabel(data.execution);
  $("status").dataset.state = data.execution || "idle";
  $("cancel").classList.toggle(
    "hidden",
    !data.busy &&
      !["queued", "yielded", "transient_failure", "waiting_capacity"].includes(
        data.execution,
      ),
  );
  if (data.error) notice(data.error);
  renderMessages(data.messages || []);
}
async function connect(event) {
  event?.preventDefault();
  try {
    token = $("token").value || token;
    await loadHistory();
    const models = await api("models");
    $("model").replaceChildren(
      ...models.map((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.id;
        return option;
      }),
    );
    sessionStorage.setItem("phunbot-token", token);
    $("login").classList.add("hidden");
    const id = localStorage.getItem("phunbot-current");
    const row =
      rows.find((row) => row.id === id) ||
      rows.find((row) => !/^(validation|test)$/i.test(row.folder || ""));
    if (row) await select(row);
    else $("prompt").focus();
  } catch (error) {
    $("loginerror").textContent = error.message;
  }
}
async function newConversation() {
  const row = await api("sessions", "POST", {
    model: $("model").value,
    folder: "",
  });
  await loadHistory();
  await select(row);
}
function renderAttachments() {
  const preview = $("attachment-preview");
  preview.replaceChildren();
  preview.classList.toggle("hidden", !attachments.length);
  attachments.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = file.name;
    chip.append(
      label,
      iconButton("x", "Remove " + file.name, () => {
        attachments.splice(index, 1);
        renderAttachments();
      }),
    );
    preview.append(chip);
  });
  icons();
}
async function send(event) {
  event.preventDefault();
  if (sending || !$("prompt").value.trim()) return;
  sending = true;
  $("send").disabled = true;
  notice("");
  try {
    if (!current) await newConversation();
    const images = await Promise.all(
      attachments.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                type: "image",
                mimeType: file.type,
                data: reader.result.split(",")[1],
              });
            reader.onerror = () => reject(Error("Could not read attachment"));
            reader.readAsDataURL(file);
          }),
      ),
    );
    const input = { text: $("prompt").value, images };
    // Persist only a digest and admission identity, not message or attachment bytes.
    // Direct HTTP LAN origins lack randomUUID/subtle; getRandomValues and the
    // locally served digest library work without weakening request identity.
    const pendingRequests = new PendingRequests(
      localStorage,
      window.sha256(token),
      window.sha256,
    );
    pendingSubmission = pendingRequests.prepare(current, input);
    const accepted = await api("sessions/" + current + "/send", "POST", {
      ...input,
      requestId: pendingSubmission.requestId,
    });
    if (accepted.accepted !== true) throw Error("The request was not accepted");
    pendingRequests.acknowledge(pendingSubmission);
    pendingSubmission = null;
    $("prompt").value = "";
    attachments = [];
    $("image").value = "";
    renderAttachments();
    $("status").textContent = "Queued";
    $("status").dataset.state = "queued";
    await loadHistory();
    await loadMessages();
  } catch (error) {
    notice(error);
  } finally {
    sending = false;
    $("send").disabled = false;
    $("prompt").focus();
  }
}
async function cancelGoal(goalId) {
  await api("sessions/" + current + "/cancel", "POST", { goalId });
  await loadMessages();
  await loadHistory();
}
async function conversationGoals() {
  const all = await api("goals");
  const row = rows.find((row) => row.id === current);
  return {
    all,
    goals: all.filter(
      (goal) =>
        goal.kind === "goal" &&
        (goal.conversationId === current || goal.id === row?.goalId),
    ),
  };
}
async function showProgress() {
  if (!current) return;
  const { all, goals } = await conversationGoals();
  const container = $("progress-detail");
  container.replaceChildren();
  for (const goal of goals) {
    const item = document.createElement("section");
    item.className = "goal-item";
    const title = document.createElement("h3");
    title.textContent = goal.title || goal.request;
    const state = document.createElement("p");
    state.textContent =
      goal.status === "COMPLETED"
        ? "Verified complete"
        : goal.status === "CANCELLED"
          ? "Cancelled"
          : executionLabel(
              goal.blocker ? "blocked" : goal.execution?.state || "queued",
            );
    const identity = document.createElement("code");
    identity.textContent = "Goal " + goal.id;
    item.append(title, state, identity);
    if (goal.blocker) {
      const blocker = document.createElement("p");
      blocker.textContent = goal.blocker.reason;
      item.append(blocker);
    }
    const criteria = document.createElement("ul");
    for (const criterion of all.filter((row) => row.parent === goal.id)) {
      const li = document.createElement("li");
      li.textContent =
        (criterion.verificationAccepted === true ? "✓ " : "○ ") +
        criterion.title;
      criteria.append(li);
    }
    item.append(criteria);
    if (!["COMPLETED", "CANCELLED"].includes(goal.status)) {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.textContent = "Cancel this goal";
      stop.onclick = () => cancelGoal(goal.id).then(showProgress).catch(notice);
      item.append(stop);
    }
    container.append(item);
  }
  if (!goals.length)
    container.textContent = "No goals recorded for this conversation yet.";
  $("progress-dialog").showModal();
}
async function showApprovals() {
  if (!current) return;
  const { goals } = await conversationGoals();
  const detail = $("approvaldetail");
  detail.replaceChildren();
  pendingApproval = null;
  for (const goal of goals)
    for (const item of (goal.authorizations || []).filter(
      (item) => item.state === "pending",
    )) {
      const section = document.createElement("section");
      section.className = "goal-item";
      const title = document.createElement("h3");
      title.textContent = item.tool;
      const args = document.createElement("pre");
      args.textContent = JSON.stringify(item.args, null, 2);
      const command = document.createElement("pre");
      command.textContent =
        "node src/owner-cli.mjs approve " +
        goal.id +
        " " +
        item.id +
        (item.risk === "sensitive" ? " --ack-sensitive" : "");
      section.append(title, args, command);
      detail.append(section);
      if (!pendingApproval) pendingApproval = { ...item, goalId: goal.id };
    }
  if (!pendingApproval)
    detail.textContent = "No operations are awaiting owner authorization.";
  $("denyaction").classList.toggle("hidden", !pendingApproval);
  $("approvaldialog").showModal();
}
$("login-form").onsubmit = connect;
$("new").onclick = () => newConversation().catch(notice);
$("search").oninput = () => renderHistory();
$("show-validation").onchange = () => renderHistory();
$("composer").onsubmit = send;
$("prompt").onkeydown = (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composer").requestSubmit();
  }
};
$("model").onchange = () => {
  if (current)
    api("sessions/" + current, "PATCH", { model: $("model").value })
      .then(loadHistory)
      .catch((error) => {
        $("model").value = rows.find((row) => row.id === current)?.model;
        notice(error);
      });
};
$("attach").onclick = () => $("image").click();
$("image").onchange = () => {
  const files = [...attachments, ...$("image").files];
  if (
    files.length > 8 ||
    files.reduce((sum, file) => sum + file.size, 0) > 5 * 1024 * 1024 ||
    files.some(
      (file) =>
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          file.type,
        ),
    )
  ) {
    notice("Choose up to eight supported images, totaling no more than 5 MiB.");
    return;
  }
  attachments = files;
  notice("");
  renderAttachments();
};
$("cancel").onclick = async () => {
  try {
    const { goals } = await conversationGoals();
    const goal =
      goals.find(
        (goal) =>
          !["COMPLETED", "CANCELLED"].includes(goal.status) &&
          goal.lease?.until > Date.now(),
      ) ||
      goals.find((goal) => !["COMPLETED", "CANCELLED"].includes(goal.status));
    if (goal) await cancelGoal(goal.id);
  } catch (error) {
    notice(error);
  }
};
$("progress").onclick = () => showProgress().catch(notice);
$("approvals").onclick = () => showApprovals().catch(notice);
$("denyaction").onclick = async () => {
  try {
    await api("sessions/" + current + "/authorizations", "POST", {
      goalId: pendingApproval.goalId,
      requestId: pendingApproval.id,
      approve: false,
    });
    $("approvaldialog").close();
    await loadMessages();
  } catch (error) {
    notice(error);
  }
};
$("organize").onclick = () => {
  if (!current) return;
  const row = rows.find((row) => row.id === current);
  $("conversation-title").value = row.title;
  $("conversation-folder").value = row.folder || "";
  $("folder-names").replaceChildren(
    ...[
      ...new Set([
        ...folders,
        ...rows.map((row) => row.folder).filter(Boolean),
      ]),
    ].map((folder) => {
      const option = document.createElement("option");
      option.value = folder;
      return option;
    }),
  );
  $("conversation-dialog").showModal();
};
$("conversation-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const title = $("conversation-title").value.trim(),
      folder = $("conversation-folder").value.trim();
    if (!title) return;
    await api("sessions/" + current, "PATCH", { title, folder });
    if (folder) folders.add(folder);
    localStorage.setItem("phunbot-folders", JSON.stringify([...folders]));
    $("conversation-dialog").close();
    $("title").textContent = title;
    await loadHistory();
  } catch (error) {
    notice(error);
  }
};
$("new-folder").onclick = () => $("folder-dialog").showModal();
$("folder-form").onsubmit = (event) => {
  event.preventDefault();
  const name = $("folder-name").value.trim();
  if (!name) return;
  folders.add(name);
  localStorage.setItem("phunbot-folders", JSON.stringify([...folders]));
  $("folder-dialog").close();
  $("folder-name").value = "";
  renderHistory(true);
};
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => $(button.dataset.close).close();
$("toggle-sidebar").onclick = () => {
  if (matchMedia("(max-width:720px)").matches) {
    document.body.classList.toggle("sidebar-open");
    $("sidebar-scrim").classList.toggle(
      "hidden",
      !document.body.classList.contains("sidebar-open"),
    );
  } else document.body.classList.toggle("sidebar-hidden");
};
$("close-sidebar").onclick = closeSidebar;
$("sidebar-scrim").onclick = closeSidebar;
$("disconnect").onclick = () => {
  token = "";
  sessionStorage.removeItem("phunbot-token");
  $("token").value = "";
  $("login").classList.remove("hidden");
  current = null;
  rows = [];
  $("history").replaceChildren();
  $("messages").replaceChildren(welcome);
  messageNodes.clear();
};
async function refresh() {
  if (
    refreshing ||
    !token ||
    !$("login").classList.contains("hidden") ||
    document.hidden
  )
    return;
  refreshing = true;
  try {
    await loadMessages();
    await loadHistory();
  } catch (error) {
    notice(error);
  } finally {
    refreshing = false;
  }
}
setInterval(refresh, 1500);
icons();
if (token) connect();
