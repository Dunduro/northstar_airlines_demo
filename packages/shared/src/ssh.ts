const SSH_KEY = /^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/]+={0,3}( .*)?$/;

/** Only PUBLIC keys are accepted; anything that looks like a private key is rejected loudly. */
export function validatePublicKey(key: string): { ok: true; fingerprintHint: string } | { ok: false; reason: string } {
  const k = key.trim();
  if (k.includes('PRIVATE KEY')) return { ok: false, reason: 'That is a private key. Never share it — paste the .pub file instead.' };
  if (!SSH_KEY.test(k)) return { ok: false, reason: 'Not an OpenSSH public key (expected e.g. "ssh-ed25519 AAAA… you@laptop").' };
  const [type, body] = k.split(' ');
  return { ok: true, fingerprintHint: `${type} …${body!.slice(-12)}` };
}
