import { describe, expect, it } from 'vitest';

import {
  WorkspaceScopingError,
  CLOUD_INTEGRATIONS_DASHBOARD_URL,
  GITHUB_CONNECT_INSTRUCTIONS,
  GOOGLE_CONNECT_COMMAND,
  PROVIDER_TYPES,
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
  const missingTokenFailure = {
    ok: false,
    error: 'Missing or empty auth token.',
    status: 401,
    code: 'missing-auth-token',
    path: 'auth.token',
  };

  it('rejects undefined auth', () => {
    expect(validateAuthContext(undefined)).toEqual(missingTokenFailure);
  });

  it('rejects empty token', () => {
    expect(validateAuthContext({ token: '' })).toEqual(missingTokenFailure);
  });

  it('rejects a missing API key', () => {
    expect(validateAuthContext({ token: '', tokenType: 'api-key' })).toEqual(missingTokenFailure);
  });

  it('rejects whitespace-only token', () => {
    expect(validateAuthContext({ token: '   ' })).toEqual(missingTokenFailure);
  });

  it('rejects malformed token strings containing whitespace', () => {
    expect(validateAuthContext({ token: 'bearer token' })).toEqual({
      ok: false,
      error: 'Invalid auth token.',
      status: 401,
      code: 'invalid-auth-token',
      path: 'auth.token',
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
      code: 'invalid-auth-token-type',
      path: 'auth.tokenType',
    });
  });

  it('returns 401 instead of throwing when token is null', () => {
    const auth = { token: null } as unknown as CloudAuthContext;

    expect(validateAuthContext(auth)).toEqual(missingTokenFailure);
  });

  it('returns 401 instead of throwing when token is a number', () => {
    const auth = { token: 12345 } as unknown as CloudAuthContext;

    expect(validateAuthContext(auth)).toEqual(missingTokenFailure);
  });
});

describe('validateWorkspaceContext', () => {
  const missingWorkspaceFailure = {
    ok: false,
    error: 'Missing or empty workspace ID.',
    status: 400,
    code: 'missing-workspace-id',
    path: 'workspace.workspaceId',
  };
  const invalidProjectFailure = {
    ok: false,
    error: 'Missing or empty project ID.',
    status: 400,
    code: 'invalid-project-id',
    path: 'workspace.projectId',
  };
  const invalidEnvironmentFailure = {
    ok: false,
    error: 'Missing or empty environment.',
    status: 400,
    code: 'invalid-environment',
    path: 'workspace.environment',
  };

  it('rejects undefined workspace', () => {
    expect(validateWorkspaceContext(undefined)).toEqual(missingWorkspaceFailure);
  });

  it('rejects empty workspaceId', () => {
    expect(validateWorkspaceContext({ workspaceId: '' })).toEqual(missingWorkspaceFailure);
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
    expect(validateWorkspaceContext({ workspaceId: 'ws-001', projectId: ' ' })).toEqual(
      invalidProjectFailure,
    );
  });

  it('rejects missing projectId when project context is required', () => {
    expect(validateWorkspaceContext({ workspaceId: 'ws-001' }, { requireProject: true })).toEqual(
      invalidProjectFailure,
    );
  });

  it('returns 400 instead of throwing when workspaceId is null', () => {
    const workspace = { workspaceId: null } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(workspace)).toEqual(missingWorkspaceFailure);
  });

  it('returns 400 instead of throwing when workspaceId is a number', () => {
    const workspace = { workspaceId: 42 } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(workspace)).toEqual(missingWorkspaceFailure);
  });

  it('returns 400 when projectId is a non-string value', () => {
    const workspace = { workspaceId: 'ws-001', projectId: 123 } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(workspace)).toEqual(invalidProjectFailure);
  });

  it('returns 400 when environment is empty or non-string', () => {
    const emptyEnvironment = { workspaceId: 'ws-001', environment: ' ' };
    const numericEnvironment = { workspaceId: 'ws-001', environment: 123 } as unknown as CloudWorkspaceContext;

    expect(validateWorkspaceContext(emptyEnvironment)).toEqual(invalidEnvironmentFailure);
    expect(validateWorkspaceContext(numericEnvironment)).toEqual(invalidEnvironmentFailure);
  });
});

describe('validateRequestMode', () => {
  const invalidModeFailure = {
    ok: false,
    error: 'Invalid request mode.',
    status: 400,
    code: 'invalid-mode',
    path: 'body.mode',
  };

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
    expect(validateRequestMode('local')).toEqual(invalidModeFailure);
  });

  it('rejects null request mode instead of defaulting it', () => {
    expect(validateRequestMode(null as unknown as string)).toEqual(invalidModeFailure);
  });
});

describe('validateProviderConnectionState', () => {
  it('rejects missing required provider connection state', () => {
    expect(validateProviderConnectionState(undefined, 'google')).toEqual({
      ok: false,
      error: 'Missing google provider connection state.',
      status: 409,
      code: 'missing-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects provider mismatch', () => {
    expect(validateProviderConnectionState({ provider: 'github', connected: true }, 'google')).toEqual({
      ok: false,
      error: 'Provider connection mismatch: expected google.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects disconnected provider', () => {
    expect(validateProviderConnectionState({ provider: 'github', connected: false }, 'github')).toEqual({
      ok: false,
      error: 'github provider is not connected.',
      status: 409,
      code: 'provider-not-connected',
      path: 'providerConnection',
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
      error: 'Invalid provider connection state.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects truthy number 1 as connected state', () => {
    const connection = { provider: 'github', connected: 1 } as unknown as ProviderConnectionState;

    expect(validateProviderConnectionState(connection, 'github')).toEqual({
      ok: false,
      error: 'Invalid provider connection state.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects null provider connection state as malformed', () => {
    expect(validateProviderConnectionState(null, 'github')).toEqual({
      ok: false,
      error: 'Invalid provider connection state.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects primitive provider connection state as malformed', () => {
    const connection = 'github' as unknown as ProviderConnectionState;

    expect(validateProviderConnectionState(connection, 'github')).toEqual({
      ok: false,
      error: 'Invalid provider connection state.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects invalid provider values at runtime', () => {
    const connection = { provider: 'dropbox', connected: true } as unknown as ProviderConnectionState;

    expect(validateProviderConnectionState(connection, 'github')).toEqual({
      ok: false,
      error: 'Invalid provider connection state.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
    });
  });

  it('runtime provider validation accepts every PROVIDER_TYPES entry', () => {
    for (const provider of PROVIDER_TYPES) {
      expect(validateProviderConnectionState({ provider, connected: true }, provider)).toEqual({
        ok: true,
        connection: { provider, connected: true },
      });
    }
  });
});

describe('validateCloudRequest', () => {
  const missingAuthFailure = {
    ok: false,
    error: 'Missing or empty auth token.',
    status: 401,
    code: 'missing-auth-token',
    path: 'auth.token',
  };
  const missingWorkspaceFailure = {
    ok: false,
    error: 'Missing or empty workspace ID.',
    status: 400,
    code: 'missing-workspace-id',
    path: 'workspace.workspaceId',
  };

  it('rejects missing auth before checking workspace', () => {
    expect(validateCloudRequest(undefined, undefined)).toEqual(missingAuthFailure);
  });

  it('rejects missing workspace when auth is valid', () => {
    expect(validateCloudRequest({ token: 'token' }, undefined)).toEqual(missingWorkspaceFailure);
  });

  it('rejects API-key requests that omit workspace context', () => {
    expect(validateCloudRequest({ token: 'api-key-token', tokenType: 'api-key' }, undefined)).toEqual(
      missingWorkspaceFailure,
    );
  });

  it('fails closed when valid auth is not scoped to a workspace', () => {
    expect(validateCloudRequest({ token: 'valid-token', tokenType: 'bearer' }, undefined)).toEqual(
      missingWorkspaceFailure,
    );
  });

  it('accepts valid bearer requests with explicit workspace scope', () => {
    expect(validateCloudRequest({ token: 'bearer-token' }, { workspaceId: 'ws-001' })).toEqual({
      ok: true,
      auth: { token: 'bearer-token', tokenType: 'bearer' },
      workspace: { workspaceId: 'ws-001', projectId: undefined, environment: undefined },
      mode: 'cloud',
      providerConnection: undefined,
    });
  });

  it('accepts API-key requests with explicit workspace scope', () => {
    expect(
      validateCloudRequest(
        { token: 'api-key-token', tokenType: 'api-key' },
        { workspaceId: 'api-key-workspace' },
      ),
    ).toEqual({
      ok: true,
      auth: { token: 'api-key-token', tokenType: 'api-key' },
      workspace: { workspaceId: 'api-key-workspace', projectId: undefined, environment: undefined },
      mode: 'cloud',
      providerConnection: undefined,
    });
  });

  it('rejects invalid request mode after auth and workspace pass', () => {
    expect(validateCloudRequest({ token: 'token' }, { workspaceId: 'ws-001' }, { mode: 'local' })).toEqual({
      ok: false,
      error: 'Invalid request mode.',
      status: 400,
      code: 'invalid-mode',
      path: 'body.mode',
    });
  });

  it('rejects missing provider state when a provider is required', () => {
    expect(
      validateCloudRequest({ token: 'token' }, { workspaceId: 'ws-001' }, { requiredProvider: 'google' }),
    ).toEqual({
      ok: false,
      error: 'Missing google provider connection state.',
      status: 409,
      code: 'missing-provider-connection',
      path: 'providerConnection',
    });
  });

  it('rejects invalid required provider values at runtime', () => {
    expect(
      validateCloudRequest(
        { token: 'token' },
        { workspaceId: 'ws-001' },
        { requiredProvider: 'dropbox' as never },
      ),
    ).toEqual({
      ok: false,
      error: 'Invalid required provider.',
      status: 400,
      code: 'invalid-required-provider',
      path: 'providerConnection',
    });
  });

  it('rejects malformed provider state after auth, workspace, and mode pass', () => {
    expect(
      validateCloudRequest(
        { token: 'token' },
        { workspaceId: 'ws-001' },
        { requiredProvider: 'github', providerConnection: null },
      ),
    ).toEqual({
      ok: false,
      error: 'Invalid provider connection state.',
      status: 400,
      code: 'invalid-provider-connection',
      path: 'providerConnection',
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
      code: 'cross-environment-access',
      path: 'workspace.environment',
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

  it('lets requested project refine when authorized project is unset', () => {
    expect(
      resolveAuthorizedWorkspaceScope(
        { workspaceId: 'ws-001' },
        { workspaceId: 'ws-001', projectId: 'proj-001' },
      ),
    ).toEqual({
      ok: true,
      scope: {
        workspaceId: 'ws-001',
        projectId: 'proj-001',
        environment: undefined,
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
      code: 'cross-workspace-access',
      path: 'workspace.workspaceId',
    });
  });

  it('fails if a request tries to use a workspace outside its authorized scope', () => {
    const authorizedScope = { workspaceId: 'api-key-workspace' };
    const requestWorkspace = { workspaceId: 'unscoped-request-workspace' };

    expect(resolveAuthorizedWorkspaceScope(authorizedScope, requestWorkspace)).toEqual({
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
      code: 'cross-workspace-access',
      path: 'workspace.workspaceId',
    });
  });

  it('rejects requests whose workspace differs from the authorized workspace', () => {
    const authorizedScope = { workspaceId: 'authorized-workspace' };
    const requestedScope = { workspaceId: 'untrusted-workspace' };

    expect(resolveAuthorizedWorkspaceScope(authorizedScope, requestedScope)).toEqual({
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
      code: 'cross-workspace-access',
      path: 'workspace.workspaceId',
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
      code: 'cross-project-access',
      path: 'workspace.projectId',
    });
  });
});

describe('getProviderConnectGuidance', () => {
  it('Google guidance is a CLI variant with the exact command', () => {
    const guidance = getProviderConnectGuidance('google');
    const expectedCommand = 'npx agent-relay cloud connect google';

    expect(guidance.kind).toBe('cli');
    if (guidance.kind !== 'cli') throw new Error('expected CLI guidance');
    expect(GOOGLE_CONNECT_COMMAND).toBe(expectedCommand);
    expect(guidance.command).toBe(expectedCommand);
    expect(guidance.dashboardUrl).toBeUndefined();
    expect(guidance.instructions[0]).toBe(`Run: ${expectedCommand}`);
    expect(guidance.instructions.join('\n')).toContain(expectedCommand);
  });

  it('Google guidance instructions mention OAuth', () => {
    expect(getProviderConnectGuidance('google').instructions.join('\n')).toContain('OAuth');
  });

  it('GitHub guidance is a dashboard variant with no command field', () => {
    const guidance = getProviderConnectGuidance('github');

    expect(guidance.kind).toBe('dashboard');
    if (guidance.kind !== 'dashboard') throw new Error('expected dashboard guidance');
    expect(guidance.dashboardUrl).toBe(CLOUD_INTEGRATIONS_DASHBOARD_URL);
    expect(guidance.command).toBeUndefined();
  });

  it('GitHub guidance mentions Nango and Cloud dashboard', () => {
    const instructions = getProviderConnectGuidance('github').instructions.join('\n');

    expect(getProviderConnectGuidance('github').instructions).toBe(GITHUB_CONNECT_INSTRUCTIONS);
    expect(Object.isFrozen(GITHUB_CONNECT_INSTRUCTIONS)).toBe(true);
    expect(instructions).toContain('Nango');
    expect(instructions).toContain('Cloud dashboard');
    expect(instructions).toContain('GitHub App installation');
  });

  it('GitHub guidance does not include a CLI command', () => {
    const guidance = getProviderConnectGuidance('github');
    const githubCliCommand = ['npx agent-relay cloud connect', 'github'].join(' ');

    expect(guidance.instructions.join('\n')).not.toContain(githubCliCommand);
  });

  it('non-CLI providers default to dashboard-based guidance', () => {
    const guidance = getProviderConnectGuidance('linear');

    expect(guidance.kind).toBe('dashboard');
    if (guidance.kind !== 'dashboard') throw new Error('expected dashboard guidance');
    expect(guidance.dashboardUrl).toBe('/dashboard/integrations/linear');
    expect(guidance.command).toBeUndefined();
    expect(guidance.instructions.join('\n')).toContain('Cloud dashboard');
    expect(guidance.instructions.join('\n')).toContain('Linear workspace');
    expect(guidance.instructions.join('\n')).toContain('Ricky OAuth Actor app');
  });

  it('optional dashboard providers expose hosted guidance without CLI commands', () => {
    for (const provider of ['slack', 'notion'] as const) {
      const guidance = getProviderConnectGuidance(provider);

      expect(guidance.kind).toBe('dashboard');
      if (guidance.kind !== 'dashboard') throw new Error('expected dashboard guidance');
      expect(guidance.dashboardUrl).toBe(CLOUD_INTEGRATIONS_DASHBOARD_URL);
      expect(guidance.command).toBeUndefined();
      expect(guidance.instructions.join('\n')).toContain(`Choose ${provider} from optional integrations.`);
    }
  });

  it('every provider in PROVIDER_TYPES has discriminator-tagged guidance', () => {
    for (const provider of PROVIDER_TYPES) {
      const guidance = getProviderConnectGuidance(provider);
      expect(guidance.provider).toBe(provider);
      expect(guidance.kind === 'cli' || guidance.kind === 'dashboard').toBe(true);
      expect(Object.isFrozen(guidance)).toBe(true);
      expect(Object.isFrozen(guidance.instructions)).toBe(true);
      if (guidance.kind === 'cli') {
        expect(typeof guidance.command).toBe('string');
        expect(guidance.command.length).toBeGreaterThan(0);
        expect(guidance.dashboardUrl).toBeUndefined();
      } else {
        expect(typeof guidance.dashboardUrl).toBe('string');
        expect(guidance.dashboardUrl.length).toBeGreaterThan(0);
        expect(guidance.command).toBeUndefined();
      }
    }
  });
});

describe('Cloud auth module contract', () => {
  it('rejects missing API keys before accepting API-key requests', () => {
    expect(validateCloudRequest({ token: '', tokenType: 'api-key' }, { workspaceId: 'ws-001' })).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
      code: 'missing-auth-token',
      path: 'auth.token',
    });
  });

  it('rejects runtime API-key auth objects that omit the token field', () => {
    const auth = { tokenType: 'api-key' } as unknown as CloudAuthContext;

    expect(validateCloudRequest(auth, { workspaceId: 'ws-001' })).toEqual({
      ok: false,
      error: 'Missing or empty auth token.',
      status: 401,
      code: 'missing-auth-token',
      path: 'auth.token',
    });
  });

  it('rejects otherwise valid auth when workspace context is missing', () => {
    expect(validateCloudRequest({ token: 'cloud-token', tokenType: 'bearer' }, undefined)).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
      code: 'missing-workspace-id',
      path: 'workspace.workspaceId',
    });
  });

  it('does not accept a request whose only successful check is provider connection state', () => {
    const result = validateCloudRequest({ token: 'cloud-token', tokenType: 'bearer' }, undefined, {
      requiredProvider: 'google',
      providerConnection: { provider: 'google', connected: true },
    });

    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
      code: 'missing-workspace-id',
      path: 'workspace.workspaceId',
    });
  });

  it('rejects unscoped provider-backed requests before provider state can authorize them', () => {
    expect(
      validateCloudRequest({ token: 'cloud-token', tokenType: 'bearer' }, undefined, {
        requiredProvider: 'google',
        providerConnection: { provider: 'google', connected: true },
      }),
    ).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
      code: 'missing-workspace-id',
      path: 'workspace.workspaceId',
    });
  });

  it('rejects unscoped API-key requests even when provider state is connected', () => {
    expect(
      validateCloudRequest({ token: 'api-key-token', tokenType: 'api-key' }, undefined, {
        requiredProvider: 'github',
        providerConnection: { provider: 'github', connected: true },
      }),
    ).toEqual({
      ok: false,
      error: 'Missing or empty workspace ID.',
      status: 400,
      code: 'missing-workspace-id',
      path: 'workspace.workspaceId',
    });
  });

  it('accepts valid scoped bearer and API-key requests', () => {
    expect(validateCloudRequest({ token: 'bearer-token' }, { workspaceId: 'ws-bearer' })).toMatchObject({
      ok: true,
      auth: { token: 'bearer-token', tokenType: 'bearer' },
      workspace: { workspaceId: 'ws-bearer' },
      mode: 'cloud',
    });

    expect(
      validateCloudRequest({ token: 'api-key-token', tokenType: 'api-key' }, { workspaceId: 'ws-api-key' }),
    ).toMatchObject({
      ok: true,
      auth: { token: 'api-key-token', tokenType: 'api-key' },
      workspace: { workspaceId: 'ws-api-key' },
      mode: 'cloud',
    });
  });

  it('rejects workspace mismatches instead of accepting unscoped access', () => {
    expect(resolveAuthorizedWorkspaceScope({ workspaceId: 'authorized-ws' }, { workspaceId: 'requested-ws' })).toEqual({
      ok: false,
      error: 'Cross-workspace access denied.',
      status: 403,
      code: 'cross-workspace-access',
      path: 'workspace.workspaceId',
    });
  });

  it('keeps provider connect guidance user-visible and provider-specific', () => {
    const googleGuidance = getProviderConnectGuidance('google');
    expect(googleGuidance.instructions.join('\n')).toContain('npx agent-relay cloud connect google');

    const githubGuidance = getProviderConnectGuidance('github');
    expect(githubGuidance.instructions.join('\n')).toContain('Cloud dashboard');
    expect(githubGuidance.instructions.join('\n')).toContain('Nango');
  });
});
