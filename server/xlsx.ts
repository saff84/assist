import { createRequire } from "module";

// The Node CommonJS build registers fs and legacy code pages automatically.
// Keep old Russian XLS imports working as well as modern XLSX workbooks.
const XLSX = createRequire(import.meta.url)("xlsx") as typeof import("xlsx");
export default XLSX;
