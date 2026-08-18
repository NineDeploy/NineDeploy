# Security & Single Sign-On (SSO)

NineDeploy follows a defense-in-depth security model to protect secrets at rest, API access, user authentication, and system communication.

---

## 🔒 1. Dual-Vault Secret Encryption & Key Rotation

- **AES-256-GCM Envelope Encryption**: Secrets, database passwords, and environment variables are sealed using versioned envelopes: `v<version>:<iv>:<tag>:<ciphertext>`.
- **Key Rotation**: Multiple master keys can be configured simultaneously via `NINEDEPLOY_MASTER_KEYS=0:<key0>,1:<key1>`.
- **Re-encryption**: Existing secrets encrypted with older keys continue to decrypt seamlessly and are migrated to the active key version upon update.

---

## 🌐 2. OpenID Connect (OIDC) Single Sign-On

Integrate enterprise identity providers for unified authentication:
- **Supported Providers**: Google Workspace, GitHub OAuth/Enterprise, Okta, Keycloak, Authentik, Microsoft Entra ID.
- **Automated User Provisioning**: Auto-create user accounts based on verified OIDC claims (`email`, `email_verified`, `name`).
- **Domain Restriction**: Enforce organizational domain matching (e.g. only allow `@company.com`).

```bash
# Example OIDC Configuration in .env
NINEDEPLOY_OIDC_ISSUER="https://auth.company.com/realms/main"
NINEDEPLOY_OIDC_CLIENT_ID="ninedeploy"
NINEDEPLOY_OIDC_CLIENT_SECRET="your-oidc-secret"
```

---

## 🔑 3. Multi-Factor Authentication & Passkeys

- **Passkeys (WebAuthn / FIDO2)**: Passwordless biometric authentication (Touch ID, Face ID, YubiKey) with hardware-backed security.
- **Two-Factor Authentication (TOTP)**: RFC 6238 compliant 6-digit TOTP with QR code setup and ±30s clock-drift tolerance.
- **Argon2id Password Hashing**: State-of-the-art memory-hard password hashing with automatic salt generation.

---

## 🛡️ 4. Brute-Force Lockout & Rate Limiting

- **Per-Account Lockout**: 5 consecutive failed login attempts lock an account for 15 minutes.
- **IP Rate Limiting**: Tiered token bucket rate limits on public endpoints to prevent credential stuffing and DoS attacks.
