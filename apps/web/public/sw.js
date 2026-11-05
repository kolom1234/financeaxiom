/* FinanceAxiom service worker: displays Web Push notifications (no caching). */
"use strict";

function safeLink(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.protocol === "https:" || url.origin === self.location.origin ? url.toString() : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "FinanceAxiom alert";
  const body = [data.body, data.attribution_footer].filter((part) => typeof part === "string" && part).join("\n");
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.item_id === "string" ? data.item_id : undefined,
      data: { link: safeLink(data.link || "/") }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(self.clients.openWindow(link));
});
