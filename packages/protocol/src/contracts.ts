// Shared finite browser/workspace vocabulary. The extension build copies this module.
export const PageSource={MANAGED:'managed',EXTERNAL:'external',POPUP:'popup'} as const;
export const WorkspaceStatus={READY:'READY',GROUP_PRESENT:'GROUP_PRESENT',EMPTY:'EMPTY'} as const;
export const LeaseStatus={AVAILABLE:'AVAILABLE',OWNED:'OWNED',UNKNOWN:'UNKNOWN'} as const;
