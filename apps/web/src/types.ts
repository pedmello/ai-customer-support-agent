export interface Customer {
  customerId: string;
  name: string;
  email: string;
}
export interface Session {
  customer: Customer;
  csrfToken: string;
  session: { expiresAt: string };
}
export type OrderStatus = "PROCESSING" | "SHIPPED" | "CANCELLED";
export interface OrderItem {
  productId: number;
  title: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl?: string | null;
  description?: string | null;
  category?: string | null;
  catalogVersion?: string | null;
}
export interface Order {
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
  currency: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  totalCents: number;
  items: OrderItem[];
}
export interface Confirmation {
  confirmationId: string;
  orderId: string;
  orderNumber?: number | null;
  expiresAt: string;
}
export interface Conversation {
  conversationId: string;
  state: "ACTIVE" | "AWAITING_CONFIRMATION" | "HUMAN_REQUESTED";
  createdAt: string;
  updatedAt: string;
  pendingConfirmation: Confirmation | null;
  pendingHandoff?: { offerId: string; expiresAt: string } | null;
}
export interface Message {
  messageId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
}
export interface Turn {
  turnId: string;
  clientMessageId: string;
  createdAt: string;
  messages: Message[];
}
export interface History extends Conversation {
  turns: Turn[];
}
export interface Page<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
export interface HistoryPage {
  data: History;
  pagination: Page<never>["pagination"];
}
export interface SendMessage {
  clientMessageId: string;
  content: string;
  confirmationId?: string;
  handoffOfferId?: string;
}
export interface ProductResult {
  productId: number;
  status: "AVAILABLE" | "NOT_FOUND" | "UNAVAILABLE";
  product?: {
    title: string;
    description: string;
    category: string;
    image: string;
  };
}
export interface Outcome {
  clientMessageId: string;
  code: string;
  reply: string;
  conversation: Conversation;
  order?: Order;
  products?: ProductResult[];
  collection?: { count: number; totals: Array<{ currency: string; totalCents: number }>; orders: Array<{ orderNumber: number; status: OrderStatus; currency: string; totalCents: number; createdAt: string; items: Order['items'] }> };
  handoff?: { simulated: true };
}
