import type { IdentityClient } from "./client"
import type { WebAuthnCreationOptionsJSON, WebAuthnRequestOptionsJSON } from "./webauthn"

export interface IdentityUser {
  id: string
  primary_email: string | null
  display_name: string
  full_name: string | null
  phone: string | null
  avatar_url: string | null
  locale: string
  timezone: string
}

export interface SessionItem {
  id: string
  public_id?: string | null
  status: "active" | "revoked" | "expired"
  device_name: string | null
  device_id: string | null
  user_agent: string | null
  ip_address: string | null
  created_at: string
  last_seen_at: string | null
}

export interface LoginMethod {
  id: string
  method_type: string
  provider: string
  email: string | null
  email_verified: boolean
  display_name: string | null
  avatar_url: string | null
  created_at: string
  last_used_at: string | null
}

export interface MfaStatus {
  enabled: boolean
  factors: Array<{
    id: string
    type: "totp"
    status: "pending" | "active" | "disabled"
    verified_at: string | null
  }>
  backup_codes_remaining: number
}

export interface MfaSetup {
  factor_id: string
  secret: string
  otpauth_url: string
}

export interface PasskeyCredential {
  id: string
  name: string | null
  created_at: string | null
  last_used_at: string | null
}

export interface OAuthProvider {
  provider: string
  enabled: boolean
  authorization_url: string | null
}

export type StepUpMethod = "passkey" | "mfa" | "password" | "oauth"

export interface StepUpMethods {
  available_methods: StepUpMethod[]
  recommended_method: StepUpMethod | null
  oauth_providers: string[]
}

export interface StepUpVerifyPayload {
  password?: string
  code?: string
}

export interface MessageResponse {
  message: string
  debug_token?: string
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

/** Providers Identity can run a step-up with (its provider registry). */
const STEP_UP_OAUTH_PROVIDERS: ReadonlySet<string> = new Set(["google", "microsoft", "apple"])

/**
 * Collapses Identity's raw step-up method identifiers into the four options a
 * portal can offer, de-duplicated and with the OAuth providers pulled out.
 * Identity lists a linked provider by its bare name ("google"); the older
 * "oauth:google" form is still accepted. Unsupported providers are dropped.
 */
export function normalizeStepUpMethods(response: { methods?: string[] }): StepUpMethods {
  const methods = Array.isArray(response.methods) ? response.methods : []
  const availableMethods: StepUpMethod[] = []
  const oauthProviders: string[] = []

  for (const method of methods) {
    if (typeof method !== "string") continue
    let normalized: StepUpMethod | null = null
    if (method === "passkey" || method === "password") normalized = method
    if (method === "totp" || method === "backup_code") normalized = "mfa"
    const provider = method.startsWith("oauth:") ? method.slice("oauth:".length) : method
    if (STEP_UP_OAUTH_PROVIDERS.has(provider)) {
      normalized = "oauth"
      if (!oauthProviders.includes(provider)) oauthProviders.push(provider)
    }

    if (!normalized) continue
    if (!availableMethods.includes(normalized)) availableMethods.push(normalized)
  }

  return {
    available_methods: availableMethods,
    recommended_method: availableMethods[0] ?? null,
    oauth_providers: oauthProviders,
  }
}

export type IdentityEndpoints = ReturnType<typeof createIdentityEndpoints>

/**
 * Shared Identity endpoint functions that are identical across portals: plain
 * requests with no account-selection side effects. A portal spreads these into
 * its own `identityApi` and adds the endpoints tied to its selection context.
 */
export function createIdentityEndpoints(client: IdentityClient) {
  return {
    forgotPassword(email: string) {
      return client.request<MessageResponse>("/api/v1/auth/forgot-password", {
        method: "POST",
        body: { email },
      })
    },

    resetPassword(token: string, newPassword: string) {
      return client.request<void>("/api/v1/auth/reset-password", {
        method: "POST",
        body: { token, new_password: newPassword },
      })
    },

    resendVerification() {
      return client.request<MessageResponse>("/api/v1/auth/email-verification/resend", {
        method: "POST",
        accountScoped: true,
      })
    },

    verifyEmail(token: string) {
      return client.request<void>("/api/v1/auth/email-verification/verify", {
        method: "POST",
        body: { token },
      })
    },

    me() {
      return client.request<IdentityUser>("/api/v1/auth/me", { accountScoped: true })
    },

    sessions() {
      return client.request<SessionItem[]>("/api/v1/auth/sessions", { accountScoped: true })
    },

    logoutOtherDevices() {
      return client.request<void>("/api/v1/auth/logout-other-devices", {
        method: "POST",
        accountScoped: true,
      })
    },

    /** Ends every session of the account on every device, this one included. Needs step-up. */
    signOutEverywhere() {
      return client.request<void>("/api/v1/auth/sessions/sign-out-everywhere", {
        method: "POST",
        accountScoped: true,
      })
    },

    loginMethods() {
      return client.request<LoginMethod[]>("/api/v1/auth/login-methods", { accountScoped: true })
    },

    addPassword(payload: { email: string; password: string }) {
      return client.request<LoginMethod>("/api/v1/auth/login-methods/password", {
        method: "POST",
        body: payload,
        accountScoped: true,
      })
    },

    unlinkLoginMethod(id: string) {
      return client.request<void>(`/api/v1/auth/login-methods/${encodePathSegment(id)}`, {
        method: "DELETE",
        accountScoped: true,
      })
    },

    providers() {
      return client.request<OAuthProvider[]>("/api/v1/auth/providers")
    },

    stepUp(payload: StepUpVerifyPayload) {
      return client.request<void>("/api/v1/auth/step-up/verify", {
        method: "POST",
        body: payload,
        accountScoped: true,
      })
    },

    stepUpMethods() {
      return client
        .request<{ methods?: string[] }>("/api/v1/auth/step-up/methods", { accountScoped: true })
        .then(normalizeStepUpMethods)
    },

    mfaStatus() {
      return client.request<MfaStatus>("/api/v1/auth/mfa/status", { accountScoped: true })
    },

    mfaSetupTotp() {
      return client.request<MfaSetup>("/api/v1/auth/mfa/setup/totp", {
        method: "POST",
        accountScoped: true,
      })
    },

    mfaVerify(code: string) {
      return client.request<void>("/api/v1/auth/mfa/verify", {
        method: "POST",
        body: { code },
        accountScoped: true,
      })
    },

    mfaBackupCodes() {
      return client.request<{ backup_codes: string[] }>("/api/v1/auth/mfa/backup-codes", {
        method: "POST",
        accountScoped: true,
      })
    },

    mfaDisable() {
      return client.request<void>("/api/v1/auth/mfa/disable", {
        method: "POST",
        accountScoped: true,
      })
    },

    passkeys() {
      return client.request<{ passkeys: PasskeyCredential[] }>("/api/v1/auth/passkeys", {
        accountScoped: true,
      })
    },

    passkeyRegisterOptions() {
      return client.request<{ options: WebAuthnCreationOptionsJSON }>(
        "/api/v1/auth/passkeys/register/options",
        { method: "POST", accountScoped: true },
      )
    },

    passkeyRegisterVerify(payload: { credential: unknown; name?: string }) {
      return client.request<PasskeyCredential>("/api/v1/auth/passkeys/register/verify", {
        method: "POST",
        body: payload,
        accountScoped: true,
      })
    },

    passkeyStepUpOptions() {
      return client.request<{ options: WebAuthnRequestOptionsJSON }>(
        "/api/v1/auth/passkeys/step-up/options",
        { method: "POST", accountScoped: true },
      )
    },

    deletePasskey(id: string) {
      return client.request<void>(`/api/v1/auth/passkeys/${encodePathSegment(id)}`, {
        method: "DELETE",
        accountScoped: true,
      })
    },

    passkeyStepUpVerify(credential: unknown) {
      return client.request<void>("/api/v1/auth/passkeys/step-up/verify", {
        method: "POST",
        body: { credential },
        accountScoped: true,
      })
    },
  }
}
