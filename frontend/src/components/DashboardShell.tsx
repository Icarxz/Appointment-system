import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Drawer, DrawerContent, DrawerOverlay, DrawerCloseButton, IconButton, useBreakpointValue, useColorMode, useDisclosure,
} from '@chakra-ui/react';
import { HamburgerIcon } from '@chakra-ui/icons';
import SidebarIdentity from './SidebarIdentity';
import NavIcon from './NavIcon';
import type { IconName } from './NavIcon';
import NotificationBell from './NotificationBell';
import LogoutConfirm from './LogoutConfirm';
import { SIDEBAR_WIDTH, useNavPalette } from '../utils/uiTokens';

export interface NavItem {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Small icon shown before the label. */
  icon?: IconName;
  /** A count shown as a pill (pending requests, ...). Hidden when 0 or missing. */
  badge?: number;
  /** Heading the item is listed under. Items with the same section sit together under one small heading.
   *  The section called "Account" is pinned to the bottom of the sidebar, above Dark Mode and Logout. */
  section?: string;
  /** A collapsible group (Admin's "User Management"). The group opens by itself when a child is active. */
  children?: NavItem[];
}

interface Props {
  /** "Student Portal", "Faculty Portal", ... */
  portalLabel: string;
  userName: string;
  nav: NavItem[];
  /** Students and faculty open My Profile from their name; Admin and Dean show it as plain text. */
  onOpenProfile?: () => void;
  profileActive?: boolean;
  /** Admin has no mailbox. */
  showMailbox?: boolean;
  /** Anything that must exist once per page (for example the first-login ProfileGate). */
  extras?: ReactNode;
  children: ReactNode;
}

const btnBase: React.CSSProperties = { border: 'none', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.01em' };

// The one sidebar every portal shares. From 768px up it is a fixed column; below that it turns into a
// top bar with a menu button that opens the same content in a drawer, so phones get the full screen width.
export default function DashboardShell({ portalLabel, userName, nav, onOpenProfile, profileActive, showMailbox = true, extras, children }: Props) {
  const C = useNavPalette();
  const { toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false;
  const menu = useDisclosure();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Moving to another page (including through a mailbox link) closes the mobile menu.
  useEffect(() => { menu.onClose(); }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  // Growing the window to desktop width must not leave a drawer open.
  useEffect(() => { if (!isMobile) menu.onClose(); }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  const itemStyle = (active: boolean, sub = false): React.CSSProperties => ({
    ...btnBase, width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
    padding: sub ? '8px 10px' : '9px 10px', minHeight: isMobile ? '44px' : undefined, borderRadius: '8px',
    background: active ? C.navBg : 'transparent', color: active ? C.navActive : C.navText,
    fontWeight: active ? 600 : 500, fontSize: sub ? '12.5px' : '13px', textAlign: 'left',
    boxShadow: sub ? 'none' : (active ? 'inset 3px 0 0 #3b82f6' : 'inset 3px 0 0 transparent'), transition: 'background 0.15s ease, color 0.15s ease',
  });
  const lead = (item: NavItem) => item.icon
    ? <span style={{ display: 'inline-flex', color: item.active ? '#60a5fa' : 'inherit', opacity: item.active ? 1 : 0.85 }}><NavIcon name={item.icon} /></span>
    : <span aria-hidden style={{ width: '5px', height: '5px', borderRadius: '50%', background: item.active ? '#60a5fa' : 'transparent', border: item.active ? 'none' : '1.5px solid #3a5373', flexShrink: 0 }} />;
  const pill = (n?: number) => (n && n > 0)
    ? <span aria-label={`${n} waiting`} style={{ marginLeft: 'auto', minWidth: '20px', padding: '1px 7px', borderRadius: '999px', background: '#2563eb', color: '#fff', fontSize: '11px', fontWeight: 700, textAlign: 'center', lineHeight: '18px' }}>{n > 99 ? '99+' : n}</span>
    : null;

  // The portals switch pages with state, not the URL, so the "close on navigation" effect above never fires for them.
  // Choosing a page must close the phone menu itself, or the drawer keeps covering the page that was just opened.
  const choose = (action: () => void) => { action(); menu.onClose(); };

  const renderItem = (item: NavItem) => {
    if (item.children?.length) {
      const childActive = item.children.some(c => c.active);
      const expanded = openGroups[item.key] || childActive;
      return (
        <div key={item.key}>
          <button onClick={() => setOpenGroups(g => ({ ...g, [item.key]: !expanded }))} aria-expanded={expanded} style={itemStyle(childActive)}>
            {lead({ ...item, active: childActive })}
            <span style={{ flex: 1 }}>{item.label}</span>
            <span aria-hidden style={{ fontSize: '10px', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>▾</span>
          </button>
          {expanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', margin: '3px 0 3px 14px', paddingLeft: '8px', borderLeft: `1px solid ${C.navLine}` }}>
              {item.children.map(c => (
                <button key={c.key} onClick={() => choose(c.onClick)} aria-current={c.active ? 'page' : undefined} style={itemStyle(c.active, true)}>{c.label}{pill(c.badge)}</button>
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <button key={item.key} onClick={() => choose(item.onClick)} aria-current={item.active ? 'page' : undefined} style={itemStyle(item.active)}>
        {lead(item)}
        <span style={{ minWidth: 0 }}>{item.label}</span>
        {pill(item.badge)}
      </button>
    );
  };

  // Group the items under their section headings, keeping the order they were given in.
  // "Account" items are pinned to the bottom instead of following the other sections.
  const mainNav = nav.filter(i => i.section !== 'Account');
  const accountNav = nav.filter(i => i.section === 'Account');
  const sectionLabel = (text: string) => (
    <div key={`h-${text}`} style={{ padding: '16px 10px 6px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5f7a99' }}>{text}</div>
  );
  const renderNav = (items: NavItem[]) => {
    const out: React.ReactNode[] = [];
    let last: string | undefined;
    items.forEach(item => {
      if (item.section && item.section !== last) out.push(sectionLabel(item.section));
      last = item.section;
      out.push(renderItem(item));
    });
    return out;
  };

  const sidebarBody = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '22px 14px', overflowY: 'auto' }}>
      <div style={{ padding: '4px 8px 24px' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.14em', color: '#fff', textTransform: 'uppercase' }}>{portalLabel}</span>
        <div style={{ marginTop: '7px', width: '20px', height: '3px', background: '#2563eb', borderRadius: '2px' }} />
      </div>
      <SidebarIdentity name={userName} onClick={onOpenProfile ? () => choose(onOpenProfile) : undefined} active={profileActive} />
      <nav aria-label={`${portalLabel} menu`} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {renderNav(mainNav)}
      </nav>
      <div style={{ flex: 1, minHeight: '16px' }} />
      {accountNav.length > 0 && (
        <nav aria-label="Account" style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '10px', marginBottom: '10px', borderTop: `1px solid ${C.navLine}` }}>
          {accountNav.map(renderItem)}
        </nav>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={toggleColorMode} aria-label={C.dk ? 'Switch to light mode' : 'Switch to dark mode'} title={C.dk ? 'Light mode' : 'Dark mode'} style={{ ...btnBase, flex: 1, padding: '9px 10px', minHeight: isMobile ? '44px' : undefined, borderRadius: '8px', border: `1px solid ${C.navLine}`, background: 'transparent', color: C.navText, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <span aria-hidden>{C.dk ? '☀' : '☾'}</span> {C.dk ? 'Light' : 'Dark'}
        </button>
        <button onClick={() => setLogoutOpen(true)} style={{ ...btnBase, flex: 1, padding: '9px 10px', minHeight: isMobile ? '44px' : undefined, borderRadius: '8px', border: '1px solid rgba(248,113,113,0.45)', background: 'transparent', color: '#fca5a5', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <NavIcon name="logout" size={14} /> Logout
        </button>
      </div>
    </div>
  );

  return (
    <div id="dashboard-shell" style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100dvh', background: C.pageBg, fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: C.text, overflow: 'hidden' }}>
      {isMobile ? (
        <>
          <header className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: C.sidebar, flexShrink: 0 }}>
            <IconButton aria-label="Open menu" icon={<HamburgerIcon boxSize={5} />} onClick={menu.onOpen} variant="ghost" color="#fff" _hover={{ bg: 'whiteAlpha.200' }} _active={{ bg: 'whiteAlpha.300' }} />
            <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.14em', color: '#fff', textTransform: 'uppercase', flex: 1, minWidth: 0 }}>{portalLabel}</span>
            {showMailbox && <NotificationBell compact navText="#fff" navBg="rgba(255,255,255,0.12)" />}
          </header>
          <Drawer isOpen={menu.isOpen} placement="left" onClose={menu.onClose}>
            <DrawerOverlay />
            <DrawerContent bg={C.sidebar} maxW="min(300px, 86vw)">
              <DrawerCloseButton color="#fff" />
              {sidebarBody}
            </DrawerContent>
          </Drawer>
        </>
      ) : (
        <aside className="no-print" style={{ width: SIDEBAR_WIDTH, flexShrink: 0, background: C.sidebar }}>{sidebarBody}</aside>
      )}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, minHeight: 0, position: 'relative' }}>
        {/* Desktop: the bell sits in the top right corner of the page. On phones it is in the top bar above. */}
        {showMailbox && !isMobile && (
          <div className="no-print" style={{ position: 'absolute', top: 0, right: '14px', zIndex: 20, display: 'flex', alignItems: 'center', height: '64px' }}>
            <NotificationBell compact navText={C.dk ? '#e2e8f0' : '#0f2240'} navBg={C.dk ? 'rgba(255,255,255,0.10)' : '#eef2f7'} />
          </div>
        )}
        {children}
      </main>

      {extras}
      <LogoutConfirm isOpen={logoutOpen} onClose={() => setLogoutOpen(false)} onConfirm={() => { localStorage.clear(); navigate('/'); }} />
    </div>
  );
}
