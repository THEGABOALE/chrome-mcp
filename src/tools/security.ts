/**
 * Shared security policy for the tools. Currently: the domain allow-list,
 * defined once here and used by navigate (target URL) and click/fill (the
 * current page URL) so the policy never drifts between call sites.
 */

import { config } from "../config.js";

/**
 * Returns an actionable error message if the URL's host is not permitted by
 * config.allowedDomains, or null if it is allowed. An empty allow-list permits
 * everything. `action` is a verb phrase used in the message, e.g. "navigate to"
 * or "interact with".
 */
export function checkDomainAllowed(url: string, action: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return `"${url}" is not a valid URL.`;
  }

  if (
    config.allowedDomains.length > 0 &&
    !config.allowedDomains.includes(hostname)
  ) {
    return (
      `Cannot ${action} "${hostname}": it is not in the allowed domains ` +
      `(${config.allowedDomains.join(", ")}). Add it to ALLOWED_DOMAINS to permit it.`
    );
  }
  return null;
}
