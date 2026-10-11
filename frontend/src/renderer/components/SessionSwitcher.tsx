import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { aoBridge } from "../lib/bridge";
import {
	buildSessionSwitcherEntries,
	initialSessionSwitcherIndex,
	sessionSwitcherCommitId,
	sessionSwitcherEligibleIds,
	stepSessionSwitcherIndex,
	type SessionSwitcherEntry,
} from "../lib/session-switcher";
import { isSessionSwitcherModifierRelease } from "../../shared/shortcuts";
import { getSessionStatusDotView } from "../lib/session-presentation";
import { cn } from "../lib/utils";
import type { WorkspaceSession } from "../types/workspace";

type OpenSwitcher = {
	entries: SessionSwitcherEntry[];
	index: number;
	cancelled: boolean;
};

/**
 * Project session switcher. The main process owns Control+Option+Tab on macOS
 * and Ctrl+` on Windows and Linux, including while xterm, the chat composer,
 * or the embedded browser is focused. Ctrl+Tab still cycles in-session tabs.
 * This surface does not take DOM focus, so the previous control keeps it when
 * the popup closes.
 */
export function SessionSwitcher({
	projectKey,
	sessions,
	currentSessionId,
	kanban,
	onCommit,
}: {
	projectKey: string | undefined;
	sessions: readonly WorkspaceSession[];
	currentSessionId?: string;
	kanban: boolean;
	onCommit: (sessionId: string) => void;
}) {
	const { t } = useTranslation();
	const listId = useId();
	const [open, setOpen] = useState<OpenSwitcher | null>(null);
	const openRef = useRef<OpenSwitcher | null>(null);
	const projectKeyRef = useRef(projectKey);
	const sessionsRef = useRef(sessions);
	const currentSessionIdRef = useRef(currentSessionId);
	const kanbanRef = useRef(kanban);
	const onCommitRef = useRef(onCommit);
	projectKeyRef.current = projectKey;
	sessionsRef.current = sessions;
	currentSessionIdRef.current = currentSessionId;
	kanbanRef.current = kanban;
	onCommitRef.current = onCommit;
	openRef.current = open;

	useEffect(() => {
		if (!openRef.current) return;
		openRef.current = null;
		setOpen(null);
	}, [projectKey]);

	useEffect(() => {
		const closeWithoutCommit = () => {
			if (!openRef.current) return;
			openRef.current = null;
			setOpen(null);
		};
		const disposeStep = aoBridge.app.onSessionSwitcherStep((direction) => {
			if (!projectKeyRef.current) return;
			const current = openRef.current;
			if (!current) {
				const entries = buildSessionSwitcherEntries(sessionsRef.current, currentSessionIdRef.current);
				if (entries.length === 0) return;
				const next = {
					entries,
					index: initialSessionSwitcherIndex(entries, currentSessionIdRef.current, kanbanRef.current),
					cancelled: false,
				};
				openRef.current = next;
				setOpen(next);
				return;
			}
			if (current.cancelled) return;
			const next = {
				...current,
				index: stepSessionSwitcherIndex(current.index, current.entries.length, direction),
			};
			openRef.current = next;
			setOpen(next);
		});
		const commitOpenSwitcher = () => {
			const current = openRef.current;
			openRef.current = null;
			setOpen(null);
			if (!current) return;
			const selected = current.entries[current.index]?.id;
			const commitId = sessionSwitcherCommitId(
				selected,
				sessionSwitcherEligibleIds(sessionsRef.current),
				currentSessionIdRef.current,
				current.cancelled,
			);
			if (commitId) onCommitRef.current(commitId);
		};
		const disposeRelease = aoBridge.app.onSessionSwitcherRelease(commitOpenSwitcher);
		const disposeCancel = aoBridge.app.onSessionSwitcherCancel(closeWithoutCommit);
		// Ctrl-up in the shell DOM, for the composer, terminal textarea, and
		// sidebar. getModifierState is the "still held" signal. Tab keyup is
		// ignored: its ctrlKey is often false while Ctrl is still down. The
		// embedded browser is a separate webContents; the main process covers it.
		const onKeyboard = (event: KeyboardEvent) => {
			if (!openRef.current) return;
			const ctrlStillDown = event.getModifierState?.("Control") === true || event.ctrlKey;
			if (
				!isSessionSwitcherModifierRelease(
					{
						key: event.key,
						code: event.code,
						alt: event.altKey,
						ctrl: ctrlStillDown,
						type: event.type === "keyup" ? "keyUp" : event.type,
					},
					false,
				)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			commitOpenSwitcher();
		};
		window.addEventListener("keydown", onKeyboard, true);
		window.addEventListener("keyup", onKeyboard, true);
		return () => {
			disposeStep();
			disposeRelease();
			disposeCancel();
			window.removeEventListener("keydown", onKeyboard, true);
			window.removeEventListener("keyup", onKeyboard, true);
		};
	}, []);

	if (!open) return null;
	const selected = open.entries[open.index];
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const selectedTitle = !selected
		? ""
		: selected.role === "orchestrator"
			? t("sessionSwitcher.orchestrator")
			: byId.get(selected.id)?.title ?? selected.id;
	return (
		<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6" data-testid="session-switcher">
			<div
				aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
				aria-label={t("sessionSwitcher.label")}
				className="pointer-events-none w-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
				data-browser-native-overlay="true"
				data-state="open"
				role="listbox"
				tabIndex={-1}
			>
				<div className="max-h-[min(24rem,70vh)] overflow-y-auto p-1">
					{open.entries.map((entry, index) => {
						const session = byId.get(entry.id);
						const title = entry.role === "orchestrator"
							? t("sessionSwitcher.orchestrator")
							: session?.title ?? entry.id;
						const dot = session ? getSessionStatusDotView(session) : undefined;
						const active = index === open.index;
						return (
							<div
								aria-selected={active}
								className={cn(
									"flex h-8 items-center gap-2 rounded-md px-2 text-sm text-white",
									active && "bg-foreground/15",
								)}
								id={`${listId}-${entry.id}`}
								key={entry.id}
								role="option"
							>
								{dot ? (
									<span
										aria-hidden="true"
										className={cn("size-2 shrink-0 rounded-full", dot.className)}
										data-session-status={session?.status}
									/>
								) : (
									<span aria-hidden="true" className="size-2 shrink-0" />
								)}
								<span className="min-w-0 flex-1 truncate text-white">{title}</span>
							</div>
						);
					})}
				</div>
			</div>
			<div aria-live="polite" className="sr-only" role="status">
				{t("sessionSwitcher.selected", {
					title: selectedTitle,
					position: open.index + 1,
					count: open.entries.length,
				})}
			</div>
		</div>
	);
}
