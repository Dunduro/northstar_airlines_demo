# Runbook: break-glass access

*Design — not coded in the PoC.* Architecture 2.2 and 2.3; the access matrix (architecture 2.2,
`terraform/org/identity-center.tf` for the SSO part).

**Trigger / alert.** Normal access is broken during an incident that needs action in AWS:
Entra ID or IAM Identity Center is unavailable, SCIM or PIM is not working, or a
misconfiguration locks platform engineers out of a Prod or core account. Not for convenience,
not for "faster than PIM".

**Impact.** The use of a credential that sits outside every normal control. Every use is an
event security reviews.

**Who.** Two named break-glass holders (platform lead and a security lead). Two people are
present for every use; one acts, one records.

**Steps.**
1. Open (or confirm) a P1/P2 incident in ServiceNow; note why normal access does not work.
2. Tell security and platform on-call in Teams that break-glass is being used.
3. Take a hardware key from the safe (two people). The break-glass identities live **outside
   SSO**: two IAM users in the management account, each with a FIDO2 hardware key and no access
   keys. From there, assume the emergency role in the affected account. *(Assumption to confirm
   with security: the Control Tower execution role as the emergency path; SCPs do not restrict
   the management account.)*
4. Do the minimum needed to restore normal access or contain the incident. Every action goes
   into the incident ticket as it happens.
5. Sign out. Return the key to the safe.

**Verify.** The use alert fired (CloudTrail sign-in of a break-glass user → EventBridge →
security and platform on-call); if it did not, that is a finding in itself. Normal access works
again (Identity Center sign-in, PIM activation). Security reviews the CloudTrail of the session
within one working day. Credentials are rotated or re-sealed after the review.

**Escalate.** Any break-glass use without an open incident, or an alert without a known holder
behind it: a security incident, straight to the CISO's on-call.

**Prevent.** Break-glass is drilled twice a year (sign-in, alert, rotation), so the first use
is not the first test. Every real use ends with a post-incident review: what made normal access
fail, and how to remove that dependency.
