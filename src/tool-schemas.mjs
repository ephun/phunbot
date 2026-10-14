import {Type} from '@sinclair/typebox';
export const verificationSchema=Type.Object({taskId:Type.String(),answer:Type.Optional(Type.String({maxLength:4000}))},{additionalProperties:false});
export const blockerKinds=['authorization','safety','information','dependency'];
export const blockerKindSchema=Type.Union(blockerKinds.map(x=>Type.Literal(x)));
