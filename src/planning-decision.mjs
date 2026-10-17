import {parseObject} from './review-output.mjs';
const string=(max,min=1)=>({type:'string',minLength:min,maxLength:max});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const planningProperties={
 title:string(300),description:string(30000),
 criteria:{type:'array',minItems:1,maxItems:20,items:object({title:string(1000),verifier:object({kind:{type:'string',enum:['file_contains','evidence_review','answer_quality']},path:string(3000,0),text:string(30000,0)})})},
 subgoals:{type:'array',maxItems:50,items:object({id:{...string(80),pattern:'^[a-zA-Z0-9-]{1,80}$'},title:string(1000),parentId:{type:['string','null']}})},
 changes:{type:'array',maxItems:50,items:string(3000,0)},execution:{type:'string',enum:['continue','pause','resume']}
};
export class PlanningDecisionError extends Error {
 constructor(issues,attempts=1){super('The deep planner could not produce a valid plan');this.name='PlanningDecisionError';this.code='invalid_planning_decision';this.diagnostics={attempts,issues:issues.slice(0,30)};}
}
function validate(value,schema,path,issues){
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(!(Array.isArray(schema.type)?schema.type:[schema.type]).includes(type)){issues.push({path,code:'type'});return;}
 if(schema.enum&&!schema.enum.includes(value))issues.push({path,code:'enum'});
 if(type==='object'){
  if(Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k)))issues.push({path,code:'unexpected_field'});
  for(const k of schema.required||[])if(!Object.hasOwn(value,k))issues.push({path:path?path+'.'+k:k,code:'required'});
  for(const [k,s]of Object.entries(schema.properties))if(Object.hasOwn(value,k))validate(value[k],s,path?path+'.'+k:k,issues);
 }
 if(type==='array'){
  if(value.length<(schema.minItems||0)||value.length>(schema.maxItems??1000))issues.push({path,code:'count'});
  value.slice(0,schema.maxItems||1000).forEach((v,i)=>validate(v,schema.items,`${path}[${i}]`,issues));
 }
 if(type==='string'&&(value.length>(schema.maxLength??Infinity)||value.length<(schema.minLength||0)||(schema.minLength&&!value.trim())||(schema.pattern&&!new RegExp(schema.pattern).test(value))))issues.push({path,code:'string_bounds'});
}
export function parsePlanningDecision(result){
 const issues=[];
 if(['length','max_tokens','max_output_tokens','truncated'].includes(String(result?.stopReason??result?.stop_reason??'').toLowerCase()))throw new PlanningDecisionError([{path:'',code:'stop_reason'}]);
 let value;
 try{value=parseObject((result?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join(''));}
 catch(e){throw new PlanningDecisionError([{path:'',code:['empty','length','malformed','type'].includes(e.code)?e.code:'malformed'}]);}
 validate(value,object(planningProperties),'',issues);
 if(issues.length)throw new PlanningDecisionError(issues);
 const ids=new Set();
 for(const [i,s]of value.subgoals.entries()){
  if(ids.has(s.id))issues.push({path:`subgoals[${i}].id`,code:'duplicate'});ids.add(s.id);
 }
 for(const [i,s]of value.subgoals.entries()){
  if(s.parentId!==null&&!ids.has(s.parentId)){issues.push({path:`subgoals[${i}].parentId`,code:'unknown_parent'});continue;}
  const seen=new Set([s.id]);let next=s.parentId;
  while(next!==null){if(seen.has(next)){issues.push({path:`subgoals[${i}].parentId`,code:'cycle'});break;}seen.add(next);next=value.subgoals.find(x=>x.id===next)?.parentId??null;}
 }
 for(const [i,c]of value.criteria.entries()){
  const v=c.verifier;
  if(v.kind==='file_contains'?(!v.path.trim()||!v.text.trim()):(v.path!==''||v.text!==''))issues.push({path:`criteria[${i}].verifier`,code:'verifier_fields'});
 }
 if(issues.length)throw new PlanningDecisionError(issues);
 return value;
}
