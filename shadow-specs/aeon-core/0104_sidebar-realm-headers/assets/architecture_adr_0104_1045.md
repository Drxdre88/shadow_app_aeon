# INFERNO ENGINEER BLUEPRINT
# Sidebar Navigation + Realm Header Upgrade
# ADR Date: 2026-04-01

---

## Mission

Replace the overcrowded top navigation bar (12+ items on one horizontal strip) with a collapsible sidebar. Simultaneously upgrade the thin-line realm headers from form-label aesthetics to glass-panel mini-cards with avatar stacks, glow accents, and collapse behavior. Both changes serve the same goal: give the AEON dashboard visual hierarchy and breathing room.

---

## Current State

### Top Navigation Bar
- **File:** apps/web/src/app/dashboard/DashboardHeader.tsx (217 lines)
- Contains 12+ items crammed horizontally: Logo, New Project, New Realm, Personal/Team segmented control, Grid/Tree/Space view switcher, Wrap/Scroll layout toggle, BetaFeatures, Stats, Help, Settings, user avatar, user name, Logout
- Most items hidden on mobile (hidden sm:flex), leaving mobile users with logo + user section only
- Sticky header at z-40 with bg-[#0a0a0c]/95 backdrop-blur-xl
- Uses framer-motion for micro-interactions, useThemeStore for glow multiplier
- The Personal/Team segmented control and view switcher share the same horizontal space, competing for attention

### Realm Headers (WorkspaceSection)
- **File:** apps/web/src/app/dashboard/WorkspaceDashboard.tsx (172 lines), lines 127-172
- Current rendering: 2.5px color dot + UPPERCASE name (text-xs) + N members (text-[10px]) + N projects (text-[10px]) + hover-only settings gear + flex-1 divider line
- No glass/glow aesthetic, no avatar stack, no collapse behavior
- Personal tab renders flat ProjectViewSwitcher with zero realm header
- Team tab renders WorkspaceSection per realm, each followed by ProjectViewSwitcher
