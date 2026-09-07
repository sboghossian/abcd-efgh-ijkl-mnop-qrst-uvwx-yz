/** Inline stroke icons. No icon library, no emoji as UI. */
const P = ({ d }: { d: string }) => <path d={d} />;

function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      {children}
    </svg>
  );
}

export const IconHome = () => <Svg><P d="M4 10.5 12 4l8 6.5" /><P d="M6 9.5V20h12V9.5" /></Svg>;
export const IconColumns = () => <Svg><P d="M3 4h18v16H3z" /><P d="M9 4v16" /><P d="M15 4v16" /></Svg>;
export const IconBoard = () => <Svg><P d="M3 4h5v12H3z" /><P d="M10 4h5v16h-5z" /><P d="M17 4h4v8h-4z" /></Svg>;
export const IconBrain = () => <Svg><circle cx="7" cy="8" r="3" /><circle cx="17" cy="8" r="3" /><circle cx="12" cy="17" r="3" /><P d="M9.6 9.6 12 14M14.4 9.6 12 14M10 8h4" /></Svg>;
export const IconSystem = () => <Svg><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="2" y="16" width="6" height="5" rx="1" /><rect x="16" y="16" width="6" height="5" rx="1" /><P d="M12 8v4M5 16v-2h14v2" /></Svg>;
export const IconChart = () => <Svg><P d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>;
export const IconGear = () => <Svg><circle cx="12" cy="12" r="3" /><P d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></Svg>;
export const IconBook = () => <Svg><P d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" /><P d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z" /></Svg>;
export const IconPlus = () => <Svg><P d="M12 5v14M5 12h14" /></Svg>;
export const IconSend = () => <Svg><P d="M4 12h15M13 6l6 6-6 6" /></Svg>;
export const IconMic = () => <Svg><rect x="9" y="3" width="6" height="11" rx="3" /><P d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
export const IconPaperclip = () => <Svg><P d="M20 11.5 12.5 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l7-7" /></Svg>;
export const IconClose = () => <Svg size={13}><P d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconMoon = () => <Svg><P d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Svg>;
export const IconPower = () => <Svg><P d="M12 3v9" /><P d="M6.5 7a8 8 0 1 0 11 0" /></Svg>;
export const IconGhost = () => <Svg><P d="M5 20V10a7 7 0 1 1 14 0v10l-2.3-1.8L14.4 20l-2.4-1.8L9.6 20l-2.3-1.8z" /><P d="M9.5 9.5h.01M14.5 9.5h.01" /></Svg>;
export const IconExpand = () => <Svg><P d="M9 3H3v6M15 21h6v-6M3 15v6h6M21 9V3h-6" /></Svg>;
