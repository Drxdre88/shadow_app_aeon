# Trophy Room Redesign

**Date:** 22/03/2026
**Package:** aeon
**Scope:** Frontend only (no backend changes)

## Problem Statement

The Trophy Room currently renders completed tasks as a flat, ungrouped grid of cards with a permanently visible activity timeline consuming 40% of the viewport width. As the vault accumulates tasks, the view becomes an undifferentiated wall of cards with no temporal or categorical anchoring, making it difficult to scan completion history or identify patterns.

The activity timeline, while useful for occasional review, permanently occupies valuable horizontal space that could be used for the trophy cards themselves. Users have no way to switch between different organizational views (by date, priority, or label).

## Solution Approach

- Add a **SegmentedControl** (Timeline | By Priority | By Label) at the top of the toolbar area to toggle between three grouping modes
- **Timeline mode** (default): Group cards into collapsible date-based sections with a secondary Day/Week/Month granularity toggle
- **By Priority mode**: Four vertical swim lanes (Urgent | High | Medium | Low)
- **By Label mode**: Swim lanes per label from labelSnapshot, plus an "Unlabeled" lane
- Move **TrophyTimeline** from permanent 40% side panel into a **slide-out drawer** toggled by a toolbar button, giving trophy cards full container width
- Extract grouping logic into `trophy-utils.ts` and collapsible sections into `TrophySection.tsx` to keep file sizes within 300-400 line limits

## Risk Assessment

- **Layout complexity**: Three view modes increase render logic -- mitigate by extracting TrophySection as a reusable component and keeping grouping logic in a pure utility file
- **Performance with large vaults**: Grouping and rendering hundreds of cards across multiple sections -- mitigate with section collapse (only render expanded sections) and existing AnimatePresence
- **Mobile responsiveness**: Swim lanes don't work well on narrow screens -- swim lanes become vertically stacked sections on mobile
- **Acceptable trade-off**: Timeline drawer requires an explicit click to open, reducing discoverability vs. always-visible panel

## Success Criteria

- [ ] SegmentedControl toggles between Timeline, By Priority, and By Label views
- [ ] Timeline view groups cards by date with collapsible sections (Day/Week/Month granularity)
- [ ] By Priority view shows 4 swim lanes with correct card distribution
- [ ] By Label view groups by labelSnapshot tags with an Unlabeled fallback lane
- [ ] Activity timeline renders in a slide-out drawer instead of permanent side panel
- [ ] Trophy cards use full container width in all views
- [ ] No changes to TrophyCard, TrophyStats, or TrophyTimeline component internals
- [ ] All existing sort/filter functionality preserved
- [ ] No file exceeds 400 lines

## Files Modified

- `src/components/trophy/TrophyRoom.tsx` -- Major rewrite: SegmentedControl, view mode routing, drawer toggle, new layout structure
- `src/components/trophy/TrophySection.tsx` -- **New**: Collapsible section with header (name + count badge) and card grid, framer-motion collapse animation
- `src/components/trophy/trophy-utils.ts` -- **New**: Pure grouping functions (groupByDay, groupByWeek, groupByMonth, groupByPriority, groupByLabel, section label formatting)
