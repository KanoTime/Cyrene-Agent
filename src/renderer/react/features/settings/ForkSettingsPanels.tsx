import { useEffect, useRef } from "react";
import { initializeCharacterPanel } from "../../../settings/character/panel";
import { initializeMobileCallPanel } from "../../../settings/asr/mobile-call-panel";
import { CHARACTER_SETTINGS_MARKUP, MOBILE_SETTINGS_MARKUP } from "./fork-settings-markup";
import "./ForkSettingsPanels.css";

function ForkPanel({ markup, initialize }: { markup: string; initialize: (root: HTMLElement) => () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? initialize(root.current) : undefined, [initialize]);
  return <div className="fork-settings-panel" ref={root} dangerouslySetInnerHTML={{ __html: markup }} />;
}
export function CharacterPackagesPanel() { return <ForkPanel markup={CHARACTER_SETTINGS_MARKUP} initialize={initializeCharacterPanel} />; }
export function MobileCallSettingsPanel() { return <ForkPanel markup={MOBILE_SETTINGS_MARKUP} initialize={initializeMobileCallPanel} />; }
