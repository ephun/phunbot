import type { RequestHandler } from "express";

export type AuthMode = "none" | "bearer" | "oauth";

export interface NoneAuthConfig {
  mode: "none";
}

export interface BearerAuthConfig {
  mode: "bearer";
  tokens: string[];
}

export interface OAuthAuthConfig {
  mode: "oauth";
  publicUrl: string;
  issuer: string;
  audience: string;
  jwksUrl: string;
  requiredScopes: string[];
}

export type AuthConfig = NoneAuthConfig | BearerAuthConfig | OAuthAuthConfig;

export type AuthMiddleware = RequestHandler;
