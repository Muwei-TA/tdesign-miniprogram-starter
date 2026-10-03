const BLACKBOX_THEME_STYLE = [
  '--hg-paper: #ffffff',
  '--hg-paper-deep: #ffffff',
  '--hg-surface: #ffffff',
  '--hg-surface-sunk: #f5f5f5',
  '--hg-surface-soft: #f5f5f5',
  '--hg-ink: #292929',
  '--hg-ink-2: #444444',
  '--hg-ink-3: #737373',
  '--hg-ink-4: #999999',
  '--hg-green: #df6b2f',
  '--hg-green-dark: #cb5a1f',
  '--hg-green-soft: #fff1e9',
  '--hg-green-mist: #fff7f3',
  '--hg-green-line: #efc5b0',
  '--hg-clay: #df6b2f',
  '--hg-clay-soft: #fff1e9',
  '--hg-clay-ink: #bd5d31',
  '--hg-line: #e5e5e5',
  '--hg-line-strong: #d2d2d2',
  '--hg-reading-bg: #292929',
  '--hg-reading-fg: #f2f2f2',
  '--hg-reading-line: #555555',
  '--hg-reading-muted: #b0b0b0',
  '--hg-font-serif: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  '--hg-font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  '--hg-surface-glass: rgba(255, 255, 255, 0.96)',
  '--hg-paper-glass: rgba(255, 255, 255, 0.88)',
  '--hg-img-placeholder: #eeeeee',
  '--hg-skeleton: #f1f1f1',
  '--hg-scrim: rgba(0, 0, 0, 0.72)',
  '--hg-on-scrim: #ffffff',
  '--hg-on-green: #ffffff',
  '--hg-emblem-fg: #ffffff',
  '--hg-tab-inactive: #888888',
  '--hg-green-muted: #bd5d31',
  '--hg-green-muted-2: #8c6a5a',
  '--hg-topic-bg: #fff4ee',
  '--hg-topic-fg: #bd5d31',
  '--hg-empty-icon-bg: #fff1e9',
  '--hg-empty-icon-bg-2: #fff1e9',
  '--hg-empty-icon-fg: #df6b2f',
  '--hg-empty-icon-radius: 8rpx',
  '--hg-empty-icon-shadow: none',
  '--hg-empty-title: #292929',
  '--hg-scope-club-bg: #fff1e9',
  '--hg-scope-club-fg: #bd5d31',
  '--hg-scope-public-bg: #f1f1f1',
  '--hg-scope-public-fg: #666666',
  '--hg-scope-private-bg: #e9e9e9',
  '--hg-scope-private-fg: #666666',
  '--hg-level-1-ink: #555555',
  '--hg-level-1-bg: #f2f2f2',
  '--hg-level-2-ink: #555555',
  '--hg-level-2-bg: #f2f2f2',
  '--hg-level-3-ink: #555555',
  '--hg-level-3-bg: #f2f2f2',
  '--hg-level-4-ink: #555555',
  '--hg-level-4-bg: #f2f2f2',
  '--hg-level-5-ink: #555555',
  '--hg-level-5-bg: #f2f2f2',
  '--hg-level-6-ink: #555555',
  '--hg-level-6-bg: #f2f2f2',
  '--hg-level-7-ink: #555555',
  '--hg-level-7-bg: #f2f2f2',
  '--hg-level-8-ink: #555555',
  '--hg-level-8-bg: #f2f2f2',
  '--hg-green-border-faint: rgba(223, 107, 47, 0.12)',
  '--hg-green-bg-faint: rgba(223, 107, 47, 0.09)',
  '--hg-danger-border-faint: rgba(168, 86, 72, 0.2)',
  '--hg-danger-bg-faint: rgba(168, 86, 72, 0.12)',
  '--hg-ink-scrim: rgba(41, 41, 41, 0.4)',
  '--hg-surface-fade-60: rgba(255, 255, 255, 0.6)',
  '--hg-topic-card-symbol: #df6b2f',
  '--hg-topic-card-warm-bg: #fff1e9',
  '--hg-topic-card-warm-fg: #bd5d31',
  '--hg-topic-card-follow: #bd5d31',
  '--hg-topic-card-banner-desc: #8c6a5a',
  '--hg-book-cover-bg: #292929',
  '--hg-book-cover-fg: #ffffff',
  '--hg-book-spine: rgba(0, 0, 0, 0.22)',
  '--hg-book-cover-ring: rgba(255, 255, 255, 0.35)',
  '--hg-book-cover-cream-bg: #df6b2f',
  '--hg-book-cover-cream-fg: #ffffff',
  '--hg-btn-primary-radius: 10rpx',
  '--hg-btn-primary-shadow: 0 4rpx 12rpx rgba(223, 107, 47, 0.18)',
  '--hg-btn-secondary-radius: 10rpx',
  '--hg-btn-secondary-border: rgba(223, 107, 47, 0.25)',
  '--hg-hover-sink: rgba(223, 107, 47, 0.08)',
  '--hg-avatar-bg: #f0f0f0',
  '--hg-avatar-fg: #555555',
  '--hg-avatar-anon-bg: #eeeeee',
  '--hg-avatar-anon-fg: #777777',
  '--hg-radius-sm: 4rpx',
  '--hg-radius-md: 6rpx',
  '--hg-radius-lg: 8rpx',
  '--hg-radius-xl: 12rpx',
  '--hg-radius-pill: 8rpx',
  '--hg-shadow-card: 0 1rpx 4rpx rgba(41, 41, 41, 0.06)',
  '--hg-shadow-fab: 0 6rpx 16rpx rgba(223, 107, 47, 0.18)',
  '--hg-shadow-book: 2rpx 4rpx 10rpx rgba(41, 41, 41, 0.12)',
  '--hg-shadow-sheet: 0 -4rpx 16rpx rgba(41, 41, 41, 0.12)',
].join(';');

function getAppSafe() {
  try {
    return typeof getApp === 'function' ? getApp() : null;
  } catch (error) {
    return null;
  }
}

function activeClubId() {
  const app = getAppSafe();
  const session = app && app.globalData && app.globalData.session;
  return session && session.club && session.club.id;
}

function themeForClub(clubId) {
  return clubId === 'blackbox-animation' ? 'blackbox' : 'literary';
}

function updateTheme(page) {
  const pinnedClubId = page._themedPagePinnedClubId;
  const clubId = pinnedClubId || activeClubId();
  const clubTheme = themeForClub(clubId);
  const patch = {
    clubTheme,
    clubThemeStyle: clubTheme === 'blackbox' ? BLACKBOX_THEME_STYLE : '',
  };
  const data = page.data || {};
  if (data.clubTheme === patch.clubTheme && data.clubThemeStyle === patch.clubThemeStyle) return;
  if (typeof page.setData === 'function') page.setData(patch);
  else page.data = { ...data, ...patch };
}

function subscribeThemeUpdates(page) {
  if (page._themedPageSubscription) return;
  const app = getAppSafe();
  const bus = app && app.eventBus;
  if (!bus || typeof bus.on !== 'function') return;
  const listener = () => updateTheme(page);
  bus.on('session-changed', listener);
  page._themedPageSubscription = { bus, listener };
}

function unsubscribeThemeUpdates(page) {
  const subscription = page._themedPageSubscription;
  if (!subscription) return;
  page._themedPageSubscription = null;
  if (typeof subscription.bus.off === 'function') {
    subscription.bus.off('session-changed', subscription.listener);
  }
}

function preserveLifecycle(definition, name, before) {
  const original = definition[name];
  return function themedLifecycle(...args) {
    before.call(this, args);
    if (typeof original === 'function') return original.apply(this, args);
    return undefined;
  };
}

export default function themedPage(definition) {
  const initialTheme = themeForClub(activeClubId());
  const page = {
    ...definition,
    data: {
      ...(definition.data || {}),
      clubTheme: initialTheme,
      clubThemeStyle: initialTheme === 'blackbox' ? BLACKBOX_THEME_STYLE : '',
    },
  };

  page.onLoad = preserveLifecycle(definition, 'onLoad', function onLoad(args) {
    const options = args[0] || {};
    this._themedPagePinnedClubId = String(options.historyOnly) === '1' && options.clubId
      ? options.clubId
      : null;
    subscribeThemeUpdates(this);
    updateTheme(this);
  });
  page.onShow = preserveLifecycle(definition, 'onShow', function onShow() {
    subscribeThemeUpdates(this);
    updateTheme(this);
  });
  page.onUnload = preserveLifecycle(definition, 'onUnload', function onUnload() {
    unsubscribeThemeUpdates(this);
  });

  return Page(page);
}
