const MAX_OBJECT_BYTES = 100000;
const MAX_REVIEW_BYTES = 12000;
export class ReviewParseError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.name = "ReviewParseError"; this.code = code; }
}
export function structuredPayload(payload, properties) {
  const schema = { type:"object", properties, required:Object.keys(properties), additionalProperties:false };
  if ("input" in payload) return {...payload, text:{...payload.text, format:{type:"json_schema",name:"phunbot_review",strict:true,schema}}};
  return {...payload, response_format:{type:"json_schema",json_schema:{name:"phunbot_review",strict:true,schema}}};
}
export function planReviewPayload(payload) { return structuredPayload(payload, {pass:{type:"boolean"},reason:{type:"string",maxLength:300}}); }
function fail(code, message, cause) { throw new ReviewParseError(code, message, cause); }
export function parseObject(input, {maxBytes = MAX_OBJECT_BYTES} = {}) {
  if (typeof input !== "string") fail("type", "Structured reviewer output must be text");
  if (!input.trim()) fail("empty", "Structured reviewer output was empty");
  if (Buffer.byteLength(input, "utf8") > maxBytes) fail("length", "Structured structured output exceeded its bounded length");
  let text = input;
  const final=/<[|｜]channel[|｜]>final(?:\s*<[|｜]constrain[|｜]>json)?(?:\s*<[|｜]message[|｜]>)?/gi;
  let match,last; while ((match=final.exec(text))) last=match;
  if (last) text=text.slice(last.index+last[0].length);
  text=text.trim().replace(/^<[|｜]constrain[|｜]>json(?:\s*<[|｜]message[|｜]>)?\s*/i,"").replace(/^```(?:json)?\s*|\s*```$/g,"").replace(/(?:<\|(?:return|end|im_end|fim_suffix)\|>)+\s*$/g,"").trim();
  if (!text) fail("empty", "Structured reviewer output contained no JSON");
  try { return JSON.parse(text); } catch (error) { fail("malformed", "Structured reviewer output was not complete JSON", error); }
}
export function parseReview(text) {
  const result=parseObject(text,{maxBytes:MAX_REVIEW_BYTES});
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("schema", "Reviewer verdict must be an object");
  if (typeof result.pass !== "boolean" || typeof result.reason !== "string" || !result.reason.trim()) fail("schema", "Invalid structured reviewer verdict");
  if (result.reason.length > 300) fail("schema", "Reviewer reason exceeded 300 characters");
  if (result.evidenceIds !== undefined && (!Array.isArray(result.evidenceIds) || result.evidenceIds.length > 50 || result.evidenceIds.some(x=>typeof x!=="string" || x.length>200))) fail("schema", "Reviewer evidence references are invalid");
  return result;
}
export function parseReviewerResult(input, stopReason) {
  if (input && typeof input === "object" && !Array.isArray(input)) { stopReason=input.stopReason ?? input.stop_reason; input=input.text ?? input.content ?? ""; }
  if (["length","max_tokens","max_output_tokens","truncated"].includes(String(stopReason || "").toLowerCase())) fail("stop_reason", "Reviewer output ended before a complete verdict (stop reason indicates truncation)");
  return parseReview(input);
}
export function reviewerEvidence(events = [], loadResult) {
  return events.map(e => ({id:e.id,at:e.at,tool:e.tool,error:e.error===true,args:e.args,result:loadResult ? loadResult(e) : e.result}));
}
