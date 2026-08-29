import { createHash, createVerify } from 'node:crypto';

/**
 * Minimal SAML 2.0 client — Sprint 5, Gap G-22.
 *
 * Parses IdP metadata XML and verifies a signed SAML response using
 * only `node:crypto`. The shape is narrow on purpose — operators
 * supply an IdP metadata URL, a SP entity id, and the panel
 * constructs the rest. Full XML signature verification (enveloped
 * + detached) is the only thing we need to ship; we do not need
 * the full `xml-crypto` library for that.
 *
 * NOTE: PR #23 ships the wire format and the verifications; the
 * assertion consumer (the `POST /v1/sso/:id/callback` HTTP route
 * that accepts the IdP POST) lives in the next PR. This file only
 * owns the metadata parse + the signature verification primitives.
 */
export interface SamlIdpMetadata {
  entityId: string;
  ssoUrl: string; // SingleSignOnService Location (HTTP-Redirect or HTTP-POST)
  /** PEM-encoded X.509 certificate used to sign the response. */
  signingCert: string;
}

const textDecoder = new TextDecoder();

/** Pull the inner XML out of a CDATA-wrapped block, if any. */
function unwrapCdata(raw: string): string {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw);
  return m ? m[1]! : raw;
}

/** Split top-level XML attributes out of a single opening tag. */
function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][A-Za-z0-9_:.-]*)\s*=\s*"([^"]*)"/g;
  let m = re.exec(tag);
  while (m) {
    attrs[m[1]!] = m[2]!;
    m = re.exec(tag);
  }
  return attrs;
}

function findTag(block: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'g');
  const first = openRe.exec(block);
  if (first === null) return null;
  let m: RegExpExecArray | null = first;
  while (m) {
    const start = m.index;
    const openTag = m[0];
    const selfClose = openTag.endsWith('/>');
    if (selfClose) return openTag;
    const afterOpen = start + openTag.length;
    // Walk forward to find the matching close, allowing nested
    // same-name tags.
    let depth = 1;
    const closeRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g');
    closeRe.lastIndex = afterOpen;
    let cm = closeRe.exec(block);
    while (cm) {
      if (cm[0].startsWith(`</${tag}`)) {
        depth -= 1;
        if (depth === 0) return block.slice(start, cm.index + cm[0].length);
      } else {
        depth += 1;
      }
      cm = closeRe.exec(block);
    }
    return openTag; // unterminated — return what we have
  }
  return null;
}

/**
 * Parse an IdP metadata XML blob (the small surface we need for
 * `samlp`-style federation). We accept the canonical
 * `EntityDescriptor` shape and extract:
 *   - `entityID` (the IdP issuer),
 *   - the `SingleSignOnService` Location URL,
 *   - the first X.509 signing certificate.
 *
 * Anything beyond that is out of scope for PR #23.
 */
export function parseIdpMetadata(xml: string): SamlIdpMetadata {
  const entityDescriptor = findTag(xml, 'EntityDescriptor') ?? findTag(xml, 'md:EntityDescriptor');
  if (!entityDescriptor) throw new Error('SAML metadata: missing EntityDescriptor');
  const edAttrs = parseAttrs(entityDescriptor.match(/<[^>]+>/)![0]!);
  const entityId = edAttrs.entityID;
  if (!entityId) throw new Error('SAML metadata: missing entityID');

  // SingleSignOnService — accept either bare or `md:`-prefixed tag.
  const ssoBlock =
    findTag(entityDescriptor, 'SingleSignOnService') ?? findTag(entityDescriptor, 'md:SingleSignOnService');
  if (!ssoBlock) throw new Error('SAML metadata: missing SingleSignOnService');
  const ssoTag = ssoBlock.match(/<[^>]+>/)![0]!;
  const ssoAttrs = parseAttrs(ssoTag);
  const ssoUrl = ssoAttrs.Location;
  if (!ssoUrl) throw new Error('SAML metadata: SingleSignOnService is missing Location');

  // X.509 signing certificate. The IdP wraps the cert in a
  // `<X509Certificate>` element; the value is base64 (often with
  // whitespace) and optionally CDATA-wrapped.
  const keyDescriptor = findTag(entityDescriptor, 'KeyDescriptor') ?? findTag(entityDescriptor, 'md:KeyDescriptor');
  let signingCert = '';
  if (keyDescriptor) {
    const certBlock = findTag(keyDescriptor, 'X509Certificate') ?? findTag(keyDescriptor, 'ds:X509Certificate');
    if (certBlock) {
      const inner = certBlock.replace(/<\/?[^>]+>/g, '').replace(/\s+/g, '');
      signingCert = unwrapCdata(inner);
    }
  }
  if (!signingCert) throw new Error('SAML metadata: no X509 signing certificate found');

  return { entityId, ssoUrl, signingCert };
}

/** Wrap a base64 X.509 body in a PEM envelope. */
export function wrapPem(b64: string): string {
  const cleaned = b64.replace(/\s+/g, '');
  const lines = cleaned.match(/.{1,64}/g) ?? [cleaned];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

/** Verify a SAML `<Signature>` against the IdP's signing certificate.
 *  PR #23 supports RSA-SHA256 signatures over a canonicalized
 *  `<SignedInfo>` blob. The IdP XMLDSig spec is larger than that, so
 *  the helper takes the pre-extracted `<SignedInfo>` + `<SignatureValue>`
 *  as already-parsed strings — the HTTP module does the canonical
 *  pull. */
export function verifySignedInfo(opts: {
  signedInfo: string;
  signatureB64: string;
  certPem: string;
  /** Algorithm; defaults to RSA-SHA256 (the SAML default). */
  algorithm?: 'RSA-SHA256';
}): boolean {
  const algo = opts.algorithm ?? 'RSA-SHA256';
  if (algo !== 'RSA-SHA256') {
    throw new Error(`SAML signature algorithm "${algo}" is not supported`);
  }
  const signature = Buffer.from(opts.signatureB64, 'base64');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(opts.signedInfo, 'utf8');
  return verifier.verify(opts.certPem, signature);
}

/** Hash the value with the SAML canonicalization (sha256 lowercase
 *  hex). Currently unused by the HTTP layer (PR #23); kept for the
 *  future when we add the digest-comparison path. */
export function canonicalDigest(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Helper: decode a SAML response base64 blob (IdPs POST
 *  base64-encoded SAMLResponse parameter). */
export function decodeSamlResponse(b64: string): string {
  return textDecoder.decode(Buffer.from(b64, 'base64'));
}
