import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverBody, Portal,
  Box, Flex, HStack, Text, CloseButton, useColorModeValue, useDisclosure,
} from '@chakra-ui/react';
import { EmailIcon } from '@chakra-ui/icons';
import moment from 'moment';
import { authFetch } from './authFetch';
import { isSafeAppLink, linkMatchesRole } from '../utils/deepLink';

const API = import.meta.env.VITE_API_URL;
const POLL_MS = 10000;

interface AppNotification {
  _id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  link?: string | null; // a path on this app built by the server; checked again here before use
  createdAt: string;
}

// 1-99 shown as-is, 100 or more shown as "99+"
export const formatBadge = (n: number) => (n > 99 ? '99+' : String(n));

interface Props {
  navText: string; // sidebar text color
  navBg: string;   // sidebar hover color
  compact?: boolean; // phone top bar: icon and badge only, and the panel opens below it
}

export default function NotificationBell({ navText, navBg, compact = false }: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const panelBg = useColorModeValue('#ffffff', '#0f1b2d');
  const panelBorder = useColorModeValue('#e2e8f0', '#1e3048');
  const textColor = useColorModeValue('#1a202c', '#e2e8f0');
  const mutedColor = useColorModeValue('#64748b', '#8fa6c4');
  const unreadBg = useColorModeValue('#eff6ff', '#13243d');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/faculty/notifications`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items);
      setUnread(data.unreadCount);
    } catch { /* network hiccup: try again on the next poll */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const markRead = async (n: AppNotification) => {
    if (n.read) return;
    setItems(prev => prev.map(i => (i._id === n._id ? { ...i, read: true } : i)));
    setUnread(u => Math.max(0, u - 1));
    try { await authFetch(`${API}/api/faculty/notifications/${n._id}/read`, { method: 'PATCH' }); }
    catch { load(); }
  };

  // Where a message leads: only a link that passes the allowlist AND belongs to this person's own dashboard.
  const targetOf = (n: AppNotification): string | null => {
    const l = n.link;
    return isSafeAppLink(l) && linkMatchesRole(l, localStorage.getItem('userRole')) ? l : null;
  };

  // Click a message: mark it read, then (when it has a link) close the mailbox and open the page / details drawer.
  const openItem = (n: AppNotification) => {
    markRead(n);
    const to = targetOf(n);
    if (to) { onClose(); navigate(to); }
  };

  const markAllRead = async () => {
    setItems(prev => prev.map(i => ({ ...i, read: true })));
    setUnread(0);
    try { await authFetch(`${API}/api/faculty/notifications/read-all`, { method: 'PATCH' }); }
    catch { load(); }
  };

  // Delete one message. It disappears right away; the list is then refreshed so the next older one can fill the gap.
  const deleteOne = async (n: AppNotification) => {
    setItems(prev => prev.filter(i => i._id !== n._id));
    if (!n.read) setUnread(u => Math.max(0, u - 1));
    try {
      const res = await authFetch(`${API}/api/faculty/notifications/${n._id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
    } catch { /* the reload below puts the message back if the server did not delete it */ }
    load();
  };

  // Delete every message in the mailbox (asks first, because it cannot be undone)
  const clearAll = async () => {
    if (items.length === 0) return;
    if (!window.confirm('Delete all notifications? This cannot be undone.')) return;
    setItems([]);
    setUnread(0);
    try { await authFetch(`${API}/api/faculty/notifications`, { method: 'DELETE' }); } catch { /* reload below shows the truth */ }
    load();
  };

  return (
    <Popover placement={compact ? 'bottom-end' : 'right-start'} isLazy isOpen={isOpen} onOpen={() => { onOpen(); load(); }} onClose={onClose}>
      <PopoverTrigger>
        <button
          aria-label={unread > 0 ? `Mail, ${unread} unread` : 'Mail'}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px', width: compact ? 'auto' : '100%',
            padding: compact ? '0 12px' : '9px 10px', minHeight: compact ? '44px' : undefined,
            marginBottom: compact ? 0 : '14px', borderRadius: '7px',
            background: 'transparent', color: navText, border: 'none',
            cursor: 'pointer', fontSize: '13px', textAlign: 'left',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = navBg)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <EmailIcon boxSize="15px" />
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: '-9px', right: '-13px',
                minWidth: '18px', height: '18px', padding: '0 5px', boxSizing: 'border-box',
                borderRadius: '9px', background: '#ef4444', color: '#fff',
                fontSize: '10px', fontWeight: 700, lineHeight: '18px', textAlign: 'center',
              }}>
                {formatBadge(unread)}
              </span>
            )}
          </span>
          {!compact && <span style={{ marginLeft: '6px' }}>Mail</span>}
        </button>
      </PopoverTrigger>

      <Portal>
        <PopoverContent w="min(340px, calc(100vw - 16px))" bg={panelBg} borderColor={panelBorder} color={textColor} _focus={{ outline: 'none' }}>
          <PopoverHeader borderColor={panelBorder}>
            <Flex justify="space-between" align="center">
              <Text fontWeight="700" fontSize="sm">Mail</Text>
              <HStack spacing={3}>
                <button
                  onClick={markAllRead}
                  disabled={unread === 0}
                  style={{
                    background: 'none', border: 'none', fontSize: '12px', fontWeight: 600,
                    color: unread === 0 ? mutedColor : '#2563eb',
                    cursor: unread === 0 ? 'default' : 'pointer',
                  }}
                >
                  Mark all as read
                </button>
                <button
                  onClick={clearAll}
                  disabled={items.length === 0}
                  style={{
                    background: 'none', border: 'none', fontSize: '12px', fontWeight: 600,
                    color: items.length === 0 ? mutedColor : '#dc2626',
                    cursor: items.length === 0 ? 'default' : 'pointer',
                  }}
                >
                  Clear all
                </button>
              </HStack>
            </Flex>
          </PopoverHeader>
          <PopoverBody p={0} maxH="380px" overflowY="auto">
            {items.length === 0 ? (
              <Text p={5} fontSize="sm" color={mutedColor} textAlign="center">No notifications yet.</Text>
            ) : (
              items.map(n => (
                <Flex
                  key={n._id}
                  align="flex-start"
                  bg={n.read ? 'transparent' : unreadBg}
                  borderBottom="1px solid" borderColor={panelBorder}
                >
                  <Box
                    as="button"
                    onClick={() => openItem(n)}
                    flex="1" minW={0} textAlign="left" pl={4} py={3} pr={1}
                    _hover={{ opacity: 0.85 }}
                  >
                    <Flex gap={2} align="flex-start">
                      <Box mt="6px" w="8px" h="8px" borderRadius="50%" flexShrink={0} bg={n.read ? 'transparent' : '#2563eb'} />
                      <Box minW={0}>
                        <Text fontSize="13px" fontWeight={n.read ? 500 : 700}>{n.title}</Text>
                        <Text fontSize="12px" color={mutedColor} mt="2px">{n.message}</Text>
                        <Text fontSize="11px" color={mutedColor} mt="4px">
                          {moment(n.createdAt).fromNow()}
                          {targetOf(n) && <Text as="span" color="#2563eb" fontWeight={600}> · View details</Text>}
                        </Text>
                      </Box>
                    </Flex>
                  </Box>
                  <CloseButton
                    size="sm" mt={2} mr={2} flexShrink={0} color={mutedColor}
                    aria-label="Delete notification" title="Delete"
                    onClick={() => deleteOne(n)}
                  />
                </Flex>
              ))
            )}
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
}
