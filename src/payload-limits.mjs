export function limitPayload(payload,maximum,{enableThinking}={}) {
 const responses='input' in payload;
 const field=responses?'max_output_tokens':'max_completion_tokens' in payload?'max_completion_tokens':'max_tokens';
 return {...payload,[field]:Math.min(payload[field]??maximum,maximum),...(!responses&&enableThinking===false?{chat_template_kwargs:{...payload.chat_template_kwargs,enable_thinking:false}}:{})};
}
