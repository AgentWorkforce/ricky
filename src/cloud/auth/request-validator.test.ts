import { describe, expect, it } from 'vitest';

import {
  WorkspaceScopingError,
  assertWorkspaceMatch,
  createWorkspaceScopedQuery,
  getProviderConnectGuidance,
  resolveAuthorizedWorkspaceScope,
  scopeToWorkspace,
  validateAuthContext,
  validateCloudRequest,
  validateProviderConnectionState,
  validateRequestMode,
  validateWorkspaceContext,
} from './index.js';
import type { CloudAuthContext, CloudWorkspaceContext, ProviderConnectionState } from './types.js';

describe('validateAuthContext', () => {
  it('rejects undefined auth', () => {
    expect(validateAuthContext(undefined)).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });

  it('rejects empty token', () => {
    expect(validateAuthContext({ token: '' })).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });

  it('rejects a missing API key', () => {
    expect(validateAuthContext({ token: '', tokenType: 'api-key' })).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });

  it('rejects whitespace-only token', () => {
    expect(validateAuthContext({ token: '   ' })).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });

  it('accepts valid bearer token', () => {
    expect(validateAuthContext({ token: 'bearer-token', tokenType: 'bearer' })).toEqual({
      ok: true,
      context: { token: 'bearer-token', tokenType: 'bearer' },
    });
  });

  it('accepts valid api-key token', () => {
    expect(validateAuthContext({ token: 'api-key-token', tokenType: 'api-key' })).toEqual({
      ok: true,
      context: { token: 'api-key-token', tokenType: 'api-key' },
    });
  });

  it('defaults tokenType to bearer when not specified', () => {
    expect(validateAuthContext({ token: 'token' })).toEqual({
      ok: true,
      context: { token: 'token', tokenType: 'bearer' },
    });
  });

  it('rejects invalid tokenType at runtime', () => {
    const auth = { token: 'token', tokenType: 'session' } as unknown as CloudAuthContext;

    expect(validateAuthContext(auth)).toEqual({
      ok: false,
      error: 'Invalid auth token type.',
      status: 400,
    });
  });

  it('returns 401 instead of throwing when token is null', () => {
    const auth = { token: null } as unknown as CloudAuthContext;

    expect(validateAuthContext(auth)).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });

  it('returns 401 instead of throwing when token is a number', () => {
    const auth = { token: 12345 } as unknown as CloudAuthContext;

    expect(validateAuthContext(auth)).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });
});

describe('validateWorkspaceContext', () => {
  it('rejects undefined workspace', () => {
    expect(validateWorkspaceContext(undefined)).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
    });
  });

  it('rejects empty workspaceId', () => {
    expect(validateWorkspaceContext({ workspaceId: '' })).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
    });
  });

  it('accepts valid workspaceId', () => {
    expect(validateWorkspaceContext({ workspaceId: 'ws-001' })).toEqual({
      ok: true,
      workspaceId: 'ws-001',
      projectId: undefined,
      environment: undefined,
    });
  });

  it('passes through optional environment', () => {
    expect(validateWorkspaceContext({ workspaceId: 'ws-001', environment: 'production' })).toEqual({
      ok: true,
      workspaceId: 'ws-001',
      projectId: undefined,
      environment: 'production',
    });
  });

  it('accepts project context when present', () => {
    expect(validateWorkspaceContext({ workspaceId: 'ws-001', projectId: 'proj-001' })).toEqual({
      ok: true,
      workspaceId: 'ws-001',
      projectId: 'proj-001',
      environment: undefined,
    });
  });

  it('rejects empty projectId when project context is present', () => {
    expect(validateWorkspaceContext({ workspaceId: 'ws-001', projectId: ' ' })).toEqual({
      ok: false,
      error: 'Missing or empty project ID.',
      status: 400,
    });
  });

  it('rejects missing projectId when project context is required', () => {
    expect(validateWorkspaceContext({ workspaceId: 'ws-001' }, { requireProject: true })).toEqual({
      ok: false,
      error: 'Missing or empty project ID.',
      status: 400,
    });
  });

  it('returns 400 instead of throwing when workspaceId is null', () => {
    const workspace = { workspaceId: null } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(workspace)).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
    });
  });

  it('returns 400 instead of throwing when workspaceId is a number', () => {
    const workspace = { workspaceId: 42 } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(workspace)).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
    });
  });

  it('returns 400 when projectId is a non-string value', () => {
    const workspace = { workspaceId: 'ws-001', projectId: 123 } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(workspace)).toEqual({
      ok: false,
      error: 'Missing or empty project ID.',
      status: 400,
    });
  });
});

describe('validateRequestMode', () => {
  it('defaults to cloud mode', () => {
    expect(validateRequestMode(undefined)).toEqual({ ok: true, mode: 'cloud' });
  });

  it('accepts cloud mode', () => {
    expect(validateRequestMode('cloud')).toEqual({ ok: true, mode: 'cloud' });
  });

  it('accepts both mode', () => {
    expect(validateRequestMode('both')).toEqual({ ok: true, mode: 'both' });
  });

  it('rejects invalid request mode', () => {
    expect(validateRequestMode('local')).toEqual({
      ok: false,
      error: 'Invalid request mode.',
      status: 400,
    });
  });
});

describe('validateProviderConnectionState', () => {
  it('rejects missing required provider connection state', () => {
    expect(validateProviderConnectionState(undefined, 'google')).toEqual({
      ok: false,
      error: 'Missing google provider connection state.',
      status: 409,
    });
  });

  it('rejects provider mismatch', () => {
    expect(validateProviderConnectionState({ provider: 'github', connected: true }, 'google')).toEqual({
      ok: false,
      error: 'Provider connection mismatch: expected google.',
      status: 400,
    });
  });

  it('rejects disconnected provider', () => {
    expect(validateProviderConnectionState({ provider: 'github', connected: false }, 'github')).toEqual({
      ok: false,
      error: 'github provider is not connected.',
      status: 409,
    });
  });

  it('accepts connected provider', () => {
    expect(validateProviderConnectionState({ provider: 'github', connected: true }, 'github')).toEqual({
      ok: true,
      connection: { provider: 'github', connected: true },
    });
  });

  it('rejects truthy string "false" as connected state', () => {
    const connection = { provider: 'github', connected: 'false' } as unknown as ProviderConnectionState;

    expect(validateProviderConnectionState(connection, 'github')).toEqual({
      ok: false,
      error: 'github provider is not connected.',
      status: 409,
    });
  });

  it('rejects truthy number 1 as connected state', () => {
    const connection = { provider: 'github', connected: 1 } as unknown as ProviderConnectionState;

    expect(validateProviderConnectionState(connection, 'github')).toEqual({
      ok: false,
      error: 'github provider is not connected.',
      status: 409,
    });
  });
});

describe('validateCloudRequest', () => {
  it('rejects missing auth before checking workspace', () => {
    expect(validateCloudRequest(undefined, undefined)).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
    });
  });

  it('rejects missing workspace when auth is valid', () => {
    expect(validateCloudRequest({ token: 'token' }, undefined)).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
    });
  });

  it('rejects unscoped API-key requests', () => {
    expect(validateCloudRequest({ token: 'api-key-token', tokenType: 'api-key' }, undefined)).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
    });
  });

  it('accepts API-key requests with explicit workspace scope', () => {
    expect(
      validateCloudRequest(
        { token: 'api-key-token', tokenType: 'api-key' },
        { workspaceId: 'ws-001' },
      ),
    ).toEqual({
      ok: true,
      auth: { token: 'api-key-token', tokenType: 'api-key' },
      workspace: { workspaceId: 'ws-001', projectId: undefined, environment: undefined },
      mode: 'cloud',
      providerConnection: undefined,
    });
  });

  it('rejects invalid request mode after auth and workspace pass', () => {
    expect(validateCloudRequest({ token: 'token' }, { workspaceId: 'ws-001' }, { mode: 'local' })).toEqual({
      ok: false,
      error: 'Invalid request mode.',
      status: 400,
    });
  });

  it('rejects missing provider state when a provider is required', () => {
    expect(
      validateCloudRequest({ token: 'token' }, { workspaceId: 'ws-001' }, { requiredProvider: 'google' }),
    ).toEqual({
      ok: false,
      error: 'Missing google provider connection state.',
      status: 409,
    });
  });

  it('accepts fully valid auth, workspace, request mode, and provider state', () => {
    expect(
      validateCloudRequest(
        { token: 'token', tokenType: 'api-key' },
        { workspaceId: 'ws-001', projectId: 'proj-001' },
        {
          mode: 'both',
          requireProject: true,
          requiredProvider: 'github',
          providerConnection: { provider: 'github', connected: true },
        },
      ),
    ).toEqual({
      ok: true,
      auth: { token: 'token', tokenType: 'api-key' },
      workspace: { workspaceId: 'ws-001', projectId: 'proj-001', environment: undefined },
      mode: 'both',
      providerConnection: { provider: 'github', connected: true },
    });
  });
});

describe('scopeToWorkspace', () => {
  it('returns resource when workspace matches', () => {
    const resource = { id: 'resource-001', workspaceId: 'ws-001' };

    expect(scopeToWorkspace(resource, 'ws-001')).toBe(resource);
  });

  it('returns null when workspace does not match', () => {
    const resource = { id: 'resource-001', workspaceId: 'ws-001' };

    expect(scopeToWorkspace(resource, 'ws-002')).toBeNull();
  });

  it('is case-sensitive', () => {
    const resource = { id: 'resource-001', workspaceId: 'ws-prod' };

    expect(scopeToWorkspace(resource, 'WS-PROD')).toBeNull();
  });
});

describe('createWorkspaceScopedQuery', () => {
  it('returns query object with workspaceId field', () => {
    expect(createWorkspaceScopedQuery('ws-001')).toEqual({ workspaceId: 'ws-001' });
  });

  it('query object workspaceId matches input exactly', () => {
    const query = createWorkspaceScopedQuery(' Ws-Prod ');

    expect(query.workspaceId).toBe(' Ws-Prod ');
  });
});

describe('assertWorkspaceMatch', () => {
  it('does not throw on match', () => {
    expect(() => assertWorkspaceMatch('ws-001', 'ws-001')).not.toThrow();
  });

  it('throws WorkspaceScopingError on mismatch', () => {
    expect(() => assertWorkspaceMatch('ws-001', 'ws-002')).toThrow(WorkspaceScopingError);
  });

  it('error includes both workspace IDs', () => {
    try {
      assertWorkspaceMatch('ws-001', 'ws-002');
      throw new Error('Expected assertWorkspaceMatch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceScopingError);
      expect((error as WorkspaceScopingError).workspaceId).toBe('ws-001');
      expect((error as WorkspaceScopingError).requestedWorkspaceId).toBe('ws-002');
    }
  });
});

describe('resolveAuthorizedWorkspaceScope', () => {
  it('resolves requested workspace scope when workspace matches', () => {
    expect(
      resolveAuthorizedWorkspaceScope(
        { workspaceId: 'ws-001', projectId: 'proj-001', environment: 'production' },
        { workspaceId: 'ws-001' },
      ),
    ).toEqual({
      ok: true,
      scope: {
        workspaceId: 'ws-001',
        projectId: 'proj-001',
        environment: 'production',
      },
    });
  });

  it('rejects cross-environment mismatch inside the same workspace', () => {
    expect(
      resolveAuthorizedWorkspaceScope(
        { workspaceId: 'ws-001', projectId: 'proj-001', environment: 'production' },
        { workspaceId: 'ws-001', projectId: 'proj-001', environment: 'staging' },
      ),
    ).toEqual({
      ok: false,
      error: 'Cross-environment access denied.',
      status: 403,
    });
  });

  it('lets requested environment refine when authorized environment is unset', () => {
    expect(
      resolveAuthorizedWorkspaceScope(
        { workspaceId: 'ws-001', projectId: 'proj-001' },
        { workspaceId: 'ws-001', projectId: 'proj-001', environment: 'staging' },
      ),
    ).toEqual({
      ok: true,
      scope: {
        workspaceId: 'ws-001',
        projectId: 'proj-001',
        environment: 'staging',
      },
    });
  });

  it('rejects cross-workspace mismatch', () => {
    expect(
      resolveAuthorizedWorkspaceScope({ workspaceId: 'ws-001' }, { workspaceId: 'ws-002' }),
    ).toEqual({
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
    });
  });

  it('rejects requests whose workspace differs from the authorized workspace', () => {
    const authorizedScope = { workspaceId: 'authorized-workspace' };
    const requestedScope = { workspaceId: 'untrusted-workspace' };

    expect(resolveAuthorizedWorkspaceScope(authorizedScope, requestedScope)).toEqual({
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
    });
  });

  it('rejects cross-project mismatch inside the same workspace', () => {
    expect(
      resolveAuthorizedWorkspaceScope(
        { workspaceId: 'ws-001', projectId: 'proj-001' },
        { workspaceId: 'ws-001', projectId: 'proj-002' },
      ),
    ).toEqual({
      ok: false,
      error: 'Cross-project access denied.',
      status: 403,
    });
  });
});

describe('getProviderConnectGuidance', () => {
  it('Google guidance includes the exact CLI command', () => {
    const guidance = getProviderConnectGuidance('google');

    expect(guidance.command).toBe('npx agent-relay cloud connect google');
    expect(guidance.instructions.join('\n')).toContain('npx agent-relay cloud connect google');
  });

  it('Google guidance instructions mention OAuth', () => {
    expect(getProviderConnectGuidance('google').instructions.join('\n')).toContain('OAuth');
  });

  it('GitHub guidance includes dashboardUrl and no command field', () => {
    const guidance = getProviderConnectGuidance('github');

    expect(guidance.dashboardUrl).toBe('/dashboard/integrations');
    expect(guidance.command).toBeUndefined();
  });

  it('GitHub guidance mentions Nango and Cloud dashboard', () => {
    const instructions = getProviderConnectGuidance('github').instructions.join('\n');

    expect(instructions).toContain('Nango');
    expect(instructions).toContain('Cloud dashboard');
  });

  it('GitHub guidance does not include a CLI command', () => {
    const guidance = getProviderConnectGuidance('github');

    expect(guidance.instructions.join('\n')).not.toContain('npx agent-relay cloud connect github');
  });
});
