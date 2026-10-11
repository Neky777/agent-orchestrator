import { createContext, useContext } from "react";

/** Presentation only: opening a viewport never starts or resumes an agent. */
export const SessionViewportContext = createContext({ embedded: false, visible: true });
export const useSessionViewport = () => useContext(SessionViewportContext);
