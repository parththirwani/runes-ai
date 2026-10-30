import { describe, expect, it } from 'vitest';
import {
  initialWorkspacePanelState,
  workspacePanelReducer,
  type WorkspacePanelState,
} from '@/src/lib/workspace-panel-state';

function openDraft(name: string): WorkspacePanelState {
  let state = workspacePanelReducer(initialWorkspacePanelState, { type: 'toggle-create' });
  state = workspacePanelReducer(state, { type: 'set-name', value: name });
  return state;
}

describe('workspace panel state', () => {
  it('starts expanded with the create form closed', () => {
    expect(initialWorkspacePanelState).toEqual({ sectionExpanded: true, creating: false, name: '' });
  });

  it('opens the create form and expands the section from the plus button', () => {
    const state = workspacePanelReducer({ ...initialWorkspacePanelState, sectionExpanded: false }, { type: 'toggle-create' });
    expect(state).toEqual({ sectionExpanded: true, creating: true, name: '' });
  });

  it('closes the create form and drops the draft when the workspace section collapses', () => {
    const collapsed = workspacePanelReducer(openDraft('Research notes'), { type: 'toggle-section' });
    expect(collapsed).toEqual({ sectionExpanded: false, creating: false, name: '' });
  });

  it('does not resurrect the create form when the workspace section is reopened', () => {
    const collapsed = workspacePanelReducer(openDraft('Research notes'), { type: 'toggle-section' });
    const reopened = workspacePanelReducer(collapsed, { type: 'toggle-section' });
    expect(reopened).toEqual({ sectionExpanded: true, creating: false, name: '' });
  });

  it('closes the create form and drops the draft after a successful create', () => {
    const state = workspacePanelReducer(openDraft('Research notes'), { type: 'create-succeeded' });
    expect(state).toEqual({ sectionExpanded: true, creating: false, name: '' });
  });

  it('keeps the typed name while the form stays open', () => {
    const state = openDraft('Research notes');
    expect(state.creating).toBe(true);
    expect(state.name).toBe('Research notes');
  });
});
