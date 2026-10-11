import { useNavigate } from "@tanstack/react-router";
import { Grid2X2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TopbarButton } from "./TopbarButton";

export function OpenGridButton({ projectId }: { projectId: string }) {
	const navigate = useNavigate();
	const { t } = useTranslation();
	return (
		<TopbarButton
			aria-label={t("grid.open")}
			className="topbar-control--labeled"
			data-priority="secondary"
			variant="feature"
			onClick={() => void navigate({ to: "/projects/$projectId/grid", params: { projectId } })}
		>
			<Grid2X2 className="size-icon-md" aria-hidden="true" />
			<span data-compact-label>{t("grid.open")}</span>
		</TopbarButton>
	);
}
