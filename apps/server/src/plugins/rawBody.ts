import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Capture the raw request body for `application/json` so webhook handlers can
 * verify HMAC signatures over the exact bytes the provider sent. The parsed
 * JSON is still exposed on `req.body` as usual.
 */
export default fp(
  async (fastify) => {
    fastify.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req, body, done) => {
        req.rawBody = body as Buffer;
        try {
          done(null, JSON.parse(body.toString()));
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    // Allow binary uploads (e.g. system import tar.gz).
    fastify.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body.toString('binary'));
      },
    );
  },
  { name: 'ninedeploy-rawbody' },
);
