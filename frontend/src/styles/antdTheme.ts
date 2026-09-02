import type { ThemeConfig } from 'antd';

// Single source of truth for the app's antd design tokens. Setting these here
// (rather than hand-overriding each component's colors in CSS) lets antd's
// own theme engine derive correct hover/focus/disabled shades for every
// component automatically.
const antdTheme: ThemeConfig = {
  token: {
    // Dataflix's own site uses cyan (its --c-400) for active/selected/
    // highlighted state (checked radios/checkboxes, pagination, spinners,
    // links) and reserves solid purple (--p-500) specifically for CTA
    // buttons — which are hard-overridden separately in gradient-theme.css's
    // .ant-btn-primary rule regardless of this token. So colorPrimary here
    // is the cyan accent, not the purple.
    colorPrimary: '#5DD3E8',
    colorLink: '#5DD3E8',
    colorError: '#F47272',
    colorText: '#F4F1F8',
    colorTextSecondary: '#C5C0D6',
    colorBorder: '#2A2740',
    colorBgContainer: '#100D24',
    colorBgElevated: '#16122E',
    colorBgLayout: '#0A0817',
    borderRadius: 8,
    // Without an explicit override, antd derives this as a light-theme
    // rgba(0,0,0,0.25) — nearly invisible against our dark backgrounds
    // (e.g. a filled-in Select's own displayed value text). Same color as
    // colorText, just dimmed via opacity instead of a separate hue.
    colorTextDisabled: 'rgba(244, 241, 248, 0.45)',
    // A Select dims its own displayed value to this color while its
    // dropdown is open (a "you're choosing a new value now" placeholder-like
    // treatment) — same light-theme-default-vs-dark-background mismatch as
    // colorTextDisabled above.
    colorTextPlaceholder: 'rgba(244, 241, 248, 0.45)',
    colorTextQuaternary: 'rgba(244, 241, 248, 0.35)',
  },
  components: {
    // antd auto-derives an option's "currently selected" background as a
    // light tint of colorPrimary, assuming a light page background — on our
    // dark theme that comes out near-white (e.g. a Select dropdown's
    // current-value row), with our light option text on top of it. Pin it
    // to a dark cyan tint instead so the text stays legible.
    Select: {
      optionSelectedBg: 'rgba(93, 211, 232, 0.16)',
      optionActiveBg: 'rgba(93, 211, 232, 0.10)',
    },
  },
};

export default antdTheme;
