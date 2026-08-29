/**
 * alert.js — Push notification alert management
 *
 * Handles:
 *   - Notification permission requests
 *   - Push subscription (VAPID key → pushManager.subscribe → POST to backend)
 *   - Alert CRUD (create, list, delete) via backend API
 *   - Active alert rendering in settings page
 */

const isProd = import.meta.env.PROD;
const BACKEND_BASE = isProd ? "/apps/busgijon/api/" : "/api/";

// Cache the push subscription to avoid re-subscribing on every alert creation
let cachedPushSubscription = null;
let cachedSubscriptionId = null;

/**
 * Request notification permission from the browser.
 * Returns 'granted', 'denied', or 'default'.
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.warn("[Alert] Notifications not supported");
    return "denied";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";

  const result = await Notification.requestPermission();
  return result;
}

/**
 * Subscribe to push notifications using the VAPID public key from the backend.
 * Returns { subscription, subscriptionId } or null on failure.
 */
export async function subscribeToPush() {
  // Return cached subscription if available
  if (cachedPushSubscription && cachedSubscriptionId) {
    return { subscription: cachedPushSubscription, subscriptionId: cachedSubscriptionId };
  }

  // Check if service worker and push manager are available
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("[Alert] Push not supported");
    return null;
  }

  try {
    // Get VAPID public key from backend
    const vapidResp = await fetch(`${BACKEND_BASE}push/vapid-public`);
    if (!vapidResp.ok) {
      throw new Error(`VAPID key fetch failed: ${vapidResp.status}`);
    }
    const { publicKey } = await vapidResp.json();

    if (!publicKey) {
      throw new Error("No VAPID public key configured on backend");
    }

    // Convert VAPID key to Uint8Array for subscribe()
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    // Get the service worker registration
    const reg = await navigator.serviceWorker.ready;

    // Subscribe to push
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Send subscription to backend
    const subResp = await fetch(`${BACKEND_BASE}push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });

    if (!subResp.ok) {
      throw new Error(`Subscribe POST failed: ${subResp.status}`);
    }

    const { id } = await subResp.json();

    // Cache for future use
    cachedPushSubscription = subscription;
    cachedSubscriptionId = id;

    return { subscription, subscriptionId: id };
  } catch (err) {
    console.error("[Alert] Push subscription failed:", err);
    return null;
  }
}

/**
 * Create a new bus alert.
 * Ensures push subscription is active before creating the alert.
 *
 * @param {Object} alert - { lineId, lineName, direction, stopId, stopName, thresholdMinutes }
 * @returns {Object|null} The created alert { id, status } or null on failure
 */
export async function createAlert(alert) {
  // Ensure we have a push subscription
  const sub = await subscribeToPush();
  if (!sub) {
    console.error("[Alert] Cannot create alert without push subscription");
    return null;
  }

  try {
    const resp = await fetch(`${BACKEND_BASE}alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...alert,
        subscriptionId: sub.subscriptionId,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Create alert failed: ${resp.status}`);
    }

    return await resp.json();
  } catch (err) {
    console.error("[Alert] Create alert failed:", err);
    return null;
  }
}

/**
 * Get active alerts for the current subscription.
 *
 * @param {number|null} subscriptionId - Optional filter by subscription
 * @returns {Array} List of alerts
 */
export async function getActiveAlerts(subscriptionId = null) {
  try {
    let url = `${BACKEND_BASE}alerts?status=active`;
    if (subscriptionId) {
      url += `&subscriptionId=${subscriptionId}`;
    }
    const resp = await fetch(url);
    if (!resp.ok) return [];
    return await resp.json();
  } catch (err) {
    console.error("[Alert] Get alerts failed:", err);
    return [];
  }
}

/**
 * Delete an alert by ID.
 *
 * @param {number} alertId - The alert ID to delete
 * @returns {boolean} True on success
 */
export async function deleteAlert(alertId) {
  try {
    const resp = await fetch(`${BACKEND_BASE}alerts/${alertId}`, {
      method: "DELETE",
    });
    return resp.ok || resp.status === 204;
  } catch (err) {
    console.error("[Alert] Delete alert failed:", err);
    return false;
  }
}

/**
 * Get the cached subscription ID (or null if not subscribed).
 */
export function getCachedSubscriptionId() {
  return cachedSubscriptionId;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a base64url string to a Uint8Array (for applicationServerKey).
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
