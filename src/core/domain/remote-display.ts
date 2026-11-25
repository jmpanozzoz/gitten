const urlCredentials = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#<>"'`]*@/gi;
const queryCredentials = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]*\?[^\s<>"'`]*)/gi;
const sensitiveQuery =
  /([?&](?:access_token|api_key|auth|key|password|sig|signature|token)=)[^&#\s<>"'`]*/gi;

export function redactRemoteCredentials(text: string): string {
  return text
    .replace(urlCredentials, "$1")
    .replace(queryCredentials, (url) => url.replace(sensitiveQuery, "$1[redacted]"));
}
