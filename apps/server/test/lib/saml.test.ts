import { describe, expect, it } from 'vitest';
import {
  canonicalDigest,
  decodeSamlResponse,
  extractSamlSubject,
  parseIdpMetadata,
  verifySignedInfo,
  wrapPem,
} from '../../src/lib/saml.js';

const base64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('lib/saml', () => {
  describe('parseIdpMetadata', () => {
    it('extracts entityID, sso URL, and X509 cert from a canonical metadata blob', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/idp">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>MIIDazCCAlOgAwIBAgIUJfAK...</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                          Location="https://idp.example.com/sso/post" />
  </IDPSSODescriptor>
</EntityDescriptor>`;
      const meta = parseIdpMetadata(xml);
      expect(meta.entityId).toBe('https://idp.example.com/idp');
      expect(meta.ssoUrl).toBe('https://idp.example.com/sso/post');
      expect(meta.signingCert).toBe('MIIDazCCAlOgAwIBAgIUJfAK...');
    });

    it('throws when EntityDescriptor is missing', () => {
      expect(() => parseIdpMetadata('<Root />')).toThrow(/missing EntityDescriptor/);
    });

    it('throws when entityID is missing', () => {
      const xml = `<EntityDescriptor><IDPSSODescriptor /></EntityDescriptor>`;
      expect(() => parseIdpMetadata(xml)).toThrow(/missing entityID/);
    });

    it('throws when SingleSignOnService is missing', () => {
      const xml = `<EntityDescriptor entityID="x"><IDPSSODescriptor /></EntityDescriptor>`;
      expect(() => parseIdpMetadata(xml)).toThrow(/missing SingleSignOnService/);
    });

    it('throws when no X509 signing certificate is found', () => {
      const xml = `<EntityDescriptor entityID="x">
        <IDPSSODescriptor>
          <SingleSignOnService Location="https://x.example.com/sso" />
        </IDPSSODescriptor>
      </EntityDescriptor>`;
      expect(() => parseIdpMetadata(xml)).toThrow(/no X509 signing certificate/);
    });

    it('strips whitespace from the certificate body', () => {
      const xml = `<EntityDescriptor entityID="x">
        <IDPSSODescriptor>
          <KeyDescriptor use="signing">
            <KeyInfo><X509Data><X509Certificate>
              MIIDazCCAlOgAwIBAgIUJfAK  with  whitespace
            </X509Certificate></X509Data></KeyInfo>
          </KeyDescriptor>
          <SingleSignOnService Location="https://x.example.com/sso" />
        </IDPSSODescriptor>
      </EntityDescriptor>`;
      const meta = parseIdpMetadata(xml);
      // The whitespace inside the value is stripped; the result is
      // a single continuous base64 string.
      expect(meta.signingCert).not.toMatch(/\s/);
      expect(meta.signingCert.length).toBeGreaterThan(0);
    });
  });

  describe('wrapPem', () => {
    it('envelops a base64 body in BEGIN/END CERTIFICATE markers with 64-char lines', () => {
      const body = 'A'.repeat(150);
      const pem = wrapPem(body);
      expect(pem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
      expect(pem.endsWith('-----END CERTIFICATE-----')).toBe(true);
      // The middle block is split at 64 chars per line.
      const lines = pem.split('\n').slice(1, -1);
      expect(lines[0]!.length).toBe(64);
      expect(lines[1]!.length).toBe(64);
      expect(lines[2]!.length).toBe(22); // remainder
    });

    it('strips embedded whitespace before wrapping', () => {
      const pem = wrapPem('A B C D E');
      const lines = pem.split('\n').slice(1, -1);
      expect(lines.join('')).toBe('ABCDE');
    });
  });

  describe('verifySignedInfo', () => {
    it('returns true for a valid RSA-SHA256 signature over the SignedInfo', () => {
      // Generate a key pair, sign a payload, and verify the same
      // payload. We use generateKeyPairSync to stay zero-dep and
      // produce a realistic RSA-SHA256 envelope.
      const { generateKeyPairSync, createSign } = require('node:crypto') as typeof import('node:crypto');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      const signedInfo = '<ds:SignedInfo>payload</ds:SignedInfo>';
      const signer = createSign('RSA-SHA256');
      signer.update(signedInfo, 'utf8');
      signer.end();
      const signature = signer.sign(privateKey);
      expect(verifySignedInfo({ signedInfo, signatureB64: signature.toString('base64'), certPem: pem })).toBe(true);
    });

    it('returns false for a tampered SignedInfo', () => {
      const { generateKeyPairSync, createSign } = require('node:crypto') as typeof import('node:crypto');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      const signer = createSign('RSA-SHA256');
      signer.update('original', 'utf8');
      signer.end();
      const signature = signer.sign(privateKey);
      expect(verifySignedInfo({ signedInfo: 'tampered', signatureB64: signature.toString('base64'), certPem: pem })).toBe(false);
    });

    it('rejects unsupported signature algorithms', () => {
      expect(() =>
        verifySignedInfo({
          // The algorithm narrowing is enforced before any crypto runs.
          signedInfo: 'x',
          signatureB64: 'AAAA',
          certPem: '-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----',
          algorithm: 'RSA-SHA512' as never,
        }),
      ).toThrow(/not supported/);
    });
  });

  describe('canonicalDigest', () => {
    it('produces a 64-char sha256 hex digest of the input', () => {
      const digest = canonicalDigest('hello world');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      // Stable: same input produces same digest.
      expect(canonicalDigest('hello world')).toBe(digest);
    });
  });

  describe('decodeSamlResponse', () => {
    it('decodes a base64-encoded SAML response body', () => {
      const payload = '<?xml version="1.0"?><samlp:Response />';
      const decoded = decodeSamlResponse(base64(payload));
      expect(decoded).toBe(payload);
    });

    it('round-trips multibyte UTF-8 correctly', () => {
      const payload = '<?xml version="1.0"?><AttributeValue>İstanbul</AttributeValue>';
      const decoded = decodeSamlResponse(base64(payload));
      expect(decoded).toContain('İstanbul');
    });
  });

  describe('extractSamlSubject', () => {
    it('returns the NameID and the email attribute when both are present', () => {
      const xml = `<samlp:Response>
        <saml:Assertion>
          <saml:Subject>
            <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@example.com</saml:NameID>
          </saml:Subject>
          <saml:AttributeStatement>
            <saml:Attribute Name="email">
              <saml:AttributeValue>alice@example.com</saml:AttributeValue>
            </saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      </samlp:Response>`;
      const subject = extractSamlSubject(xml);
      expect(subject.nameId).toBe('alice@example.com');
      expect(subject.email).toBe('alice@example.com');
    });

    it('falls back to the `mail` attribute alias when `email` is absent', () => {
      const xml = `<samlp:Response>
        <saml:Assertion>
          <saml:NameID>bob@example.com</saml:NameID>
          <saml:AttributeStatement>
            <saml:Attribute Name="mail">
              <saml:AttributeValue>bob@example.com</saml:AttributeValue>
            </saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      </samlp:Response>`;
      expect(extractSamlSubject(xml).email).toBe('bob@example.com');
    });

    it('returns null email when the Assertion has no AttributeStatement', () => {
      const xml = `<samlp:Response>
        <saml:Assertion>
          <saml:NameID>carol@example.com</saml:NameID>
        </saml:Assertion>
      </samlp:Response>`;
      const subject = extractSamlSubject(xml);
      expect(subject.nameId).toBe('carol@example.com');
      expect(subject.email).toBeNull();
    });

    it('throws when the Assertion element is missing', () => {
      expect(() => extractSamlSubject('<samlp:Response />')).toThrow(/missing <Assertion>/);
    });

    it('throws when the NameID is empty', () => {
      const xml = `<samlp:Response>
        <saml:Assertion><saml:NameID>   </saml:NameID></saml:Assertion>
      </samlp:Response>`;
      expect(() => extractSamlSubject(xml)).toThrow(/empty <NameID>/);
    });
  });
});
