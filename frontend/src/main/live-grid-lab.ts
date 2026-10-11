import path from "node:path";
import { canonicalPathInside, sameCanonicalPath } from "../shared/path-identity";

/** Validate before the lab creates any files, including existing symlink aliases. */
export function isolatedLiveGridRoot(root: string, home: string): string {
	const resolved = path.resolve(root);
	const aoRoot = path.join(home, ".ao");
	if (sameCanonicalPath(resolved, aoRoot) || ["data", "electron", "br", "dev"].some((name) =>
		canonicalPathInside(resolved, path.join(aoRoot, name)))) {
		throw new Error("The Live Grid lab requires its own state directory.");
	}
	for (const name of ["data", "electron", "br", "running.json"]) {
		if (!canonicalPathInside(path.join(resolved, name), resolved)) {
			throw new Error("The Live Grid lab state must stay inside its isolated directory.");
		}
	}
	return resolved;
}
