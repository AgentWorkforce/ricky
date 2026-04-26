/**
 * Cloud Generate – Request types
 */

export interface CloudAuthContext {
  token: string;
}

export interface CloudWorkspaceContext {
  workspaceId: string;
  environment?: string;
}

export interface CloudGenerateSpecString {
  kind: 'string';
  raw: string;
}

export interface CloudGenerateSpecNaturalLanguage {
  kind: 'nl';
  prompt: string;
}

export interface CloudGenerateSpecStructured {
  kind: 'structured';
  fields: Record<string, unknown>;
}

export type CloudGenerateSpec =
  | CloudGenerateSpecString
  | CloudGenerateSpecNaturalLanguage
  | CloudGenerateSpecStructured;

export interface CloudGenerateBody {
  spec: CloudGenerateSpec;
  dryRun?: boolean;
}

export interface CloudGenerateRequest {
  auth: CloudAuthContext;
  workspace: CloudWorkspaceContext;
  body: CloudGenerateBody;
  requestId?: string;
}
