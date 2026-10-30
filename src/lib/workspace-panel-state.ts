// State for the Workspaces section of the library sidebar. Keeping the section and the inline
// create form in one reducer guarantees that closing the section also dismisses a draft, so
// reopening it never resurrects a half-written workspace name.
export type WorkspacePanelState = {
  sectionExpanded: boolean;
  creating: boolean;
  name: string;
};

export const initialWorkspacePanelState: WorkspacePanelState = {
  sectionExpanded: true,
  creating: false,
  name: "",
};

export type WorkspacePanelAction =
  | { type: "toggle-section" }
  | { type: "toggle-create" }
  | { type: "set-name"; value: string }
  | { type: "create-succeeded" };

export function workspacePanelReducer(state: WorkspacePanelState, action: WorkspacePanelAction): WorkspacePanelState {
  switch (action.type) {
    case "toggle-section":
      if (!state.sectionExpanded) return { ...state, sectionExpanded: true };
      return { ...state, sectionExpanded: false, creating: false, name: "" };
    case "toggle-create":
      if (state.creating) return { ...state, creating: false, name: "" };
      return { ...state, sectionExpanded: true, creating: true, name: "" };
    case "set-name":
      return { ...state, name: action.value };
    case "create-succeeded":
      return { ...state, creating: false, name: "" };
    default:
      return state;
  }
}
