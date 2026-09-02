import * as React from "react";
import { DEMO_EVENTS, type DemoEvent } from "@/lib/demo-events";

/**
 * A demo notification is one of the SHARED demo events, plus read state.
 *
 * It used to be a row from a second mock whose `detail` was a finished Lithuanian sentence. Nothing
 * can translate a sentence, so a visitor who chose Polish read a Polish interface listing
 * Lithuanian alerts — and the bell and the events page described two different fleets.
 */
export type Notification = DemoEvent & { read: boolean };

type Ctx = {
  items: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
};

const NotificationsContext = React.createContext<Ctx | null>(null);
const STORAGE_KEY = "orbetra.admin.notifications.read";
const SEED = DEMO_EVENTS;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [readIds, setReadIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setReadIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = React.useCallback((next: Set<string>) => {
    setReadIds(new Set(next));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const markRead = React.useCallback(
    (id: string) => {
      const next = new Set(readIds);
      next.add(id);
      persist(next);
    },
    [readIds, persist],
  );

  const markAllRead = React.useCallback(() => {
    persist(new Set(SEED.map((e) => e.id)));
  }, [persist]);

  const items: Notification[] = React.useMemo(
    () => SEED.map((e) => ({ ...e, read: readIds.has(e.id) })),
    [readIds],
  );
  const unread = items.filter((i) => !i.read).length;

  const value = React.useMemo(
    () => ({ items, unread, markRead, markAllRead }),
    [items, unread, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationsProvider");
  return ctx;
}
