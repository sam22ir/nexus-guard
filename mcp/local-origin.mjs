// DNS-rebinding guard for the local Nexus HTTP server (release plan item 1).
// A web page can make the browser call 127.0.0.1:3939 under a hostname it
// controls. Two checks stop that, and they run before any route:
//   - Host must name this computer (127.0.0.1, localhost, [::1]), with or
//     without a port.
//   - Origin must be absent. Browsers attach it to cross-site requests, and
//     native agents and the app's own probes never send it.
// Pure function: takes a headers object, returns a verdict. No logging.

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

const HOST_REASON = "Nexus only accepts requests addressed to this computer (127.0.0.1).";
const ORIGIN_REASON = "Nexus does not accept requests from web pages.";

/** Strip an optional port and normalise IPv6 brackets. Returns null when the
 *  value is not a plain host[:port] or [v6][:port]. */
function hostnameOf(raw) {
  const value = raw.trim().toLowerCase();
  if (value.startsWith("[")) {
    const match = value.match(/^(\[[^\]]+\])(?::\d{1,5})?$/);
    return match ? match[1] : null;
  }
  // A bare IPv6 literal (more than one colon, no brackets), e.g. "::1".
  if ((value.match(/:/g) ?? []).length > 1) return `[${value}]`;
  const match = value.match(/^([^:]+)(?::\d{1,5})?$/);
  return match ? match[1] : null;
}

/** Decide whether a request may reach Nexus. `headers` is req.headers. */
export function checkLocalRequest(headers = {}) {
  const hostHeader = headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (typeof host !== "string" || host.trim() === "") {
    return { ok: false, reason: HOST_REASON };
  }
  const hostname = hostnameOf(host);
  if (hostname == null || !ALLOWED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: HOST_REASON };
  }
  // Any Origin header, including "null" or an empty value, means a browser
  // page made this request.
  if (headers.origin !== undefined) {
    return { ok: false, reason: ORIGIN_REASON };
  }
  return { ok: true };
}
