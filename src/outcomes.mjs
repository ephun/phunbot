// Conservative admission: uncertain/composite requests retain explicit criteria.
const external =
  /\b(server|service|instance|config\w*|restart\w*|stop|start|delete|remove|backup|file|write|create|generate|upload|download|save|send|email|install|update|research|search|latest|current|today|now|weather|price|cite|sources?|my|our|your|cloud|amp|infrastructure)\b/i;
const assertedEffect =
  /\b(?:I|we)\s+(?:have\s+)?(?:restarted|changed|updated|created|deleted|saved|sent|installed|verified|checked|read|fetched)\b|\b(?:successfully|according to (?:the|my) (?:logs|tool))\b/i;

function arithmetic(text) {
  const input = text
    .trim()
    .replace(/^(?:what is|calculate|compute)\s+/i, "")
    .replace(/[?=]\s*$/, "")
    .trim();
  if (
    !/^[\d\s.+*/()%\-]+$/.test(input) ||
    input.length > 200 ||
    !/[+*/%\-]/.test(input)
  )
    return null;
  const tokens = input.match(/\d+(?:\.\d+)?|[()+*/%\-]/g) || [];
  if (tokens.join("") !== input.replace(/\s/g, "")) return null;
  let i = 0;
  function atom() {
    if (tokens[i] === "-") {
      i++;
      return -atom();
    }
    if (tokens[i] === "+") {
      i++;
      return atom();
    }
    if (tokens[i] === "(") {
      i++;
      const value = sum();
      if (tokens[i++] !== ")") throw Error("Unbalanced");
      return value;
    }
    const token = tokens[i++];
    if (!/^\d/.test(token || "")) throw Error("Number required");
    return Number(token);
  }
  function product() {
    let v = atom();
    while (["*", "/", "%"].includes(tokens[i])) {
      const op = tokens[i++],
        rhs = atom();
      v = op === "*" ? v * rhs : op === "/" ? v / rhs : v % rhs;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++],
        rhs = product();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  try {
    const value = sum();
    return i === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
export function outcomeContract(request, hasImages = false) {
  if (hasImages) return { kind: "visual", verifier: "evidence_review" };
  const expected = arithmetic(request);
  if (expected !== null)
    return { kind: "arithmetic", expected, verifier: "answer_quality" };
  if (
    !external.test(request) &&
    (/^\s*(?:hi|hello|hey|thanks|thank you|ok|okay)[.! ]*$/i.test(request) ||
      (/^\s*(?:what is|what are|explain|define|why does|how does|tell me about)\b/i.test(
        request,
      ) &&
        !/\band\b|[;\n]|\?.+\S|\b(?:then|also|plus)\b/i.test(request)))
  )
    return { kind: "answer", verifier: "answer_quality" };
  return { kind: "explicit", verifier: null };
}
export function checkAnswer(request, answer) {
  const contract = outcomeContract(request);
  if (!["answer", "arithmetic"].includes(contract.kind))
    return {
      pass: false,
      reason: "Explicit evidence-backed criteria required",
    };
  if (
    typeof answer !== "string" ||
    !answer.trim() ||
    answer.length > 100000 ||
    assertedEffect.test(answer) ||
    /^(?:I (?:will|can|need to)|let me|working on|unable|sorry)/i.test(
      answer.trim(),
    )
  )
    return {
      pass: false,
      reason: "No substantive answer, or unsupported external-effect claim",
    };
  if (contract.kind === "arithmetic") {
    const numbers = answer.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    const pass = numbers.length > 0 && numbers.at(-1) === contract.expected;
    return {
      pass,
      reason: pass
        ? "Native answer contains the independently computed arithmetic result"
        : "Answer lacks the independently computed result",
      expected: contract.expected,
    };
  }
  return {
    pass: true,
    reason:
      "Low-risk answer emitted in canonical Pi history; no consequential effect claimed. No independent factual research asserted.",
  };
}
