// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversationsPage } from './Conversations';
import { Orders } from './Orders';
import { Navigation } from './Navigation';
import { OrderRail } from './Conversations';
import type { Order } from '../types';
import type { SupportState } from '../hooks/useSupport';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('presents every order in the support rail, including more than six', () => {
  const orders = Array.from({ length: 8 }, (_, index) => ({ orderId: `order-${index}`, orderNumber: 10000 + index, status: 'PROCESSING', currency: 'BRL', totalCents: 1000, createdAt: '2026-10-20T12:00:00Z', items: [{ title: `Produto ${index}` }] }));
  render(<OrderRail support={{ orders } as unknown as SupportState} onOrder={vi.fn()} />);
  expect(document.querySelectorAll('.order-rail .order-summary')).toHaveLength(8);
});
it('busca e filtra conversas pelos estados reais sem oferecer encerramento fictício', () => {
  const support = {
    conversations: [
      { conversationId: 'a', state: 'ACTIVE', createdAt: '2026-10-20T12:00:00Z' },
      { conversationId: 'b', state: 'HUMAN_REQUESTED', createdAt: '2026-10-19T12:00:00Z' },
    ], histories: {}, orders: [], busy: '', create: vi.fn(),
  } as unknown as SupportState;
  const onSelect = vi.fn();
  render(<ConversationsPage support={support} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole('button', { name: 'Encaminhadas' }));
  expect(screen.getAllByText('Encaminhamento simulado').length).toBe(1);
  expect(screen.queryByText('Em aberto')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar nas conversas' }), { target: { value: 'inexistente' } });
  expect(screen.getByText('Nenhuma conversa encontrada')).toBeTruthy();
  expect(screen.queryByText('Encerradas')).toBeNull();
});

it('mantém a seção ativa e o logout acessíveis na navegação compartilhada', () => {
  const navigate = vi.fn(), logout = vi.fn();
  render(<Navigation customer={{ customerId: 'private', name: 'Ana Silva', email: 'ana@example.test' }}
    section="orders" onNavigate={navigate} onLogout={logout} busy={false} />);
  expect(screen.getByRole('button', { name: 'Meus pedidos' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Conversas' }));
  expect(navigate).toHaveBeenCalledWith('conversations');
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
  expect(logout).toHaveBeenCalledTimes(1);
});
it('mantém as abas navegáveis mesmo durante operações em andamento', () => {
  const navigate = vi.fn();
  render(<Navigation customer={{ customerId: 'private', name: 'Ana', email: 'ana@example.test' }}
    section="chat" onNavigate={navigate} onLogout={vi.fn()} busy={true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Meus pedidos' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversas' }));
  expect(navigate.mock.calls.map(([section]) => section)).toEqual(['orders', 'conversations']);
});

it('expande os dados do pedido no mobile e mantém o cancelamento como ação conversacional', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const order: Order = { orderId: 'internal', orderNumber: 10001, status: 'PROCESSING',
    currency: 'BRL', totalCents: 8990, createdAt: '2026-10-20T12:00:00Z',
    updatedAt: '2026-10-20T12:00:00Z', cancelledAt: null,
    items: [{ productId: 2, title: 'Camiseta', quantity: 1, unitPriceCents: 8990 }] };
  const ask = vi.fn();
  render(<Orders orders={[order]} onSelect={vi.fn()} onAsk={ask} busy={false} />);
  expect(screen.getAllByRole('region', { name: 'Detalhes do pedido' })).toHaveLength(1);
  const copy = screen.getByRole('button', { name: 'Copiar número do pedido 10001' });
  expect(copy.title).toBe('Copiar número do pedido');
  expect(copy.closest('.official-status')).toBeTruthy();
  expect(screen.queryByText('Copiar')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Solicitar cancelamento' }));
  expect(ask).toHaveBeenCalledWith(10001, true);
  fireEvent.click(screen.getByRole('button', { name: /Camiseta/ }));
  expect(screen.queryByRole('region', { name: 'Detalhes do pedido' })).toBeNull();
});
