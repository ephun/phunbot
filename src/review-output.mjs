export function structuredPayload(payload,properties){if('input'in payload)return {...payload,text:{...payload.text,format:{type:'json_schema',name:'phunbot_review',strict:true,schema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}}};return {...payload,response_format:{type:'json_schema',json_schema:{name:'phunbot_review',strict:true,schema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}}};}
export function planReviewPayload(payload){return structuredPayload(payload,{pass:{type:'boolean'},reason:{type:'string',maxLength:300}});}
export function parseObject(text){
 const final=/<[|｜]channel[|｜]>final(?:\s*<[|｜]constrain[|｜]>json)?(?:\s*<[|｜]message[|｜]>)?/gi;let match,last;while((match=final.exec(text)))last=match;
 if(last)text=text.slice(last.index+last[0].length);
 text=text.trim().replace(/^<[|｜]constrain[|｜]>json(?:\s*<[|｜]message[|｜]>)?\s*/i,'').replace(/^```(?:json)?\s*|\s*```$/g,'').replace(/(?:<\|(?:return|end|im_end|fim_suffix)\|>)+\s*$/g,'').trim();
 return JSON.parse(text);
}
export function parseReview(text){const result=parseObject(text);if(typeof result.pass!=='boolean'||typeof result.reason!=='string'||!result.reason.trim())throw Error('Invalid structured reviewer verdict');return result;}
