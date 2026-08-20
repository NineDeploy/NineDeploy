/** Extract a bearer token from the WebSocket subprotocol header.
 *
 * Browser WebSocket APIs cannot set Authorization, but subprotocols are sent
 * in headers rather than URLs, keeping credentials out of proxy access logs
 * and request history. Query-token fallback preserves older clients while
 * current clients migrate to the header form.
 */
export function websocketBearerToken(
  headers: Record<string, string | string[] | undefined>,
  query: { token?: string },
): string | undefined {
  const raw = headers['sec-websocket-protocol'];
  const protocols = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((value) => value.trim());
  const bearer = protocols.find((value) => value.startsWith('ninedeploy.bearer.'));
  return bearer?.slice('ninedeploy.bearer.'.length) || query.token;
}
