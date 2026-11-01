// U1: pestañas del editor y C en la UI. model/srcmap/build/clang no usan el DOM (tests);
// editor y debug montan la interfaz.
export { TabsModel, GEN_NAME, TABS_KEY, LEGACY_SOURCE_KEY, kindOf, hasMain, isRunnable, libTabName, type Tab, type TabKind, type Prefs } from "./model";
export { SourceMap, asmLineOwners, type SrcLoc } from "./srcmap";
export { prepare, finish, buildAndRun, buildTapFor, type Build, type TabDiag, type RunResult, type ExportResult } from "./build";
export { cLanguage, cParser } from "./clang";
export { TabsEditor, type TabsEditorOptions } from "./editor";
export { mountTabsDebugger, stepSourceLine, type TabsDebugger } from "./debug";
