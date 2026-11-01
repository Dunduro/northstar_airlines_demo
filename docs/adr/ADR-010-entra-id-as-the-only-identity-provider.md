# ADR-010: Entra ID as the only identity provider

**Status:** Accepted (2026-10-31)

## Context

Every user of the platform is an employee who already exists in NorthStar's directory
(assumed Microsoft Entra ID, to validate in discovery). AWS, GitHub, VPN and the dashboard
all need authentication, roles and a reliable leaver process. Each extra user store is
another place a leaver can be forgotten.

## Decision

**Entra ID is the only IdP.** It feeds IAM Identity Center (SAML + SCIM), GitHub Enterprise
(SAML), AWS Client VPN (SAML) and the dashboard (OIDC). MFA and Conditional Access are
enforced once, at Entra; phishing-resistant MFA for anything that can touch Prod. Access is
granted to **groups, not people**: SCIM-provisioned groups such as `aws-payments-developer`,
`aws-platform-engineer` and `aws-security-audit` map to permission sets per environment in
`terraform/org`. The dashboard maps group claims to app roles (`viewer`, `operator`,
`admin`). In the PoC, Entra is simulated by a dev login that issues a token with the same
shape (`oid`, `name`, `groups`). No Cognito.

## Alternatives considered

- **Cognito for the dashboard.** A second user store and a second MFA policy for internal
  users; Cognito belongs with customer-facing apps.
- **Identity Center as the IdP.** Works for AWS only; GitHub, VPN and the dashboard would
  still need another identity.
- **Okta.** Equally good; the design uses only SAML, OIDC and SCIM, so it ports.

## Consequences

- Positive: one identity, one MFA policy; joiner, mover and leaver are group changes that
  propagate everywhere.
- Positive: five roles stay five roles however many teams there are (team scoping via groups
  and tags).
- Negative: Entra becomes a hard dependency; break-glass accounts outside SSO are required.
- Negative: SCIM provisioning lag affects JIT access (see ADR-009).
- Negative: the PoC login is a stand-in and must be labelled as such.
