export function Icon({
  name,
  size = 18,
}: {
  name:
    | "headset"
    | "chat"
    | "box"
    | "history"
    | "logout"
    | "plus"
    | "arrow"
    | "search"
    | "shield"
    | "spark"
    | "back"
    | "refresh"
    | "copy"
    | "cancel"
    | "close";
  size?: number;
}) {
  const symbols = {
    headset: 'support_agent', chat: 'chat', box: 'inventory_2', history: 'history',
    logout: 'logout', plus: 'add', arrow: 'arrow_upward', search: 'search',
    shield: 'verified_user', spark: 'auto_awesome', back: 'chevron_left',
    refresh: 'refresh', copy: 'content_copy', cancel: 'block', close: 'close',
  };
  return <span className="material-symbols-rounded icon" style={{ fontSize: size, width: size, height: size }} aria-hidden="true">{symbols[name]}</span>;
}

