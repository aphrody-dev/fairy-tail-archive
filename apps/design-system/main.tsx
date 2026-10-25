import { createRoot } from "react-dom/client";
import { Experience } from "../../packages/experience/App";
import "../../packages/experience/styles.css";
const root = document.getElementById("root");
if (!root) throw new Error("Experience root missing");
createRoot(root).render(<Experience />);
